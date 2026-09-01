// Integração das rotas /api/conta/* e do gate de sessão de cliente no
// POST /api/agendamentos (RN-50).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { __resetCookies, __setCookie, cookies } from "./fake-next-headers.mjs";
import {
  NOME_COOKIE,
  construirTokenCliente,
  decodificarSessaoCliente,
} from "../src/lib/cliente-auth.js";
import {
  bancoDeTeste,
  limparMovimentacao,
  criarBarbeiro,
  criarClienteComLogin,
  definirExpediente,
} from "./ajuda.js";
import { getDb, buscarClientePorId, salvarConfig } from "../src/lib/db.js";
import { diaDaSemana } from "../src/lib/slots.js";

function req(url, { method = "GET", body } = {}) {
  const init = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "content-type": "application/json" };
  }
  return new Request(url, init);
}

beforeEach(() => {
  bancoDeTeste();
  limparMovimentacao(getDb());
  __resetCookies();
  getDb().exec(
    "DELETE FROM cliente_reset_tokens; DELETE FROM agendamentos; DELETE FROM clientes;",
  );
});

/* -------------------- cadastro / login -------------------- */

test("POST /api/conta/cadastro cria a conta e emite o cookie de sessão", async () => {
  const { POST } = await import("../src/app/api/conta/cadastro/route.js");
  const resp = await POST(
    req("http://localhost/api/conta/cadastro", {
      method: "POST",
      body: {
        nome: "Novo Cliente",
        telefone: "44999990000",
        email: "novo@teste.com",
        senha: "senha-boa-123",
      },
    }),
  );
  assert.equal(resp.status, 200);
  const cookie = cookies().get(NOME_COOKIE)?.value;
  assert.ok(cookie, "deveria ter emitido o cookie cliente_sessao");
  assert.ok(decodificarSessaoCliente(cookie));
});

test("POST /api/conta/login: 401 com senha errada, 200 + cookie com a certa", async () => {
  await criarClienteComLogin({ email: "l@teste.com", senha: "certa-123456" });
  const { POST } = await import("../src/app/api/conta/login/route.js");

  const ruim = await POST(
    req("http://localhost/api/conta/login", {
      method: "POST",
      body: { email: "l@teste.com", senha: "errada" },
    }),
  );
  assert.equal(ruim.status, 401);

  const bom = await POST(
    req("http://localhost/api/conta/login", {
      method: "POST",
      body: { email: "l@teste.com", senha: "certa-123456" },
    }),
  );
  assert.equal(bom.status, 200);
  assert.ok(decodificarSessaoCliente(cookies().get(NOME_COOKIE)?.value));
});

test("POST /api/conta/esqueci-senha sempre responde 200 genérico", async () => {
  await criarClienteComLogin({ email: "existe@teste.com" });
  const { POST } = await import("../src/app/api/conta/esqueci-senha/route.js");

  for (const email of ["existe@teste.com", "naoexiste@teste.com"]) {
    const resp = await POST(
      req("http://localhost/api/conta/esqueci-senha", {
        method: "POST",
        body: { email },
      }),
    );
    assert.equal(resp.status, 200);
    const corpo = await resp.json();
    assert.ok(corpo.mensagem);
  }
});

/* -------------------- perfil / exclusão -------------------- */

test("PATCH /api/conta/perfil sem sessão responde 401", async () => {
  const { PATCH } = await import("../src/app/api/conta/perfil/route.js");
  const resp = await PATCH(
    req("http://localhost/api/conta/perfil", {
      method: "PATCH",
      body: { nome: "X" },
    }),
  );
  assert.equal(resp.status, 401);
});

test("DELETE /api/conta anonimiza a conta e o retrato nos agendamentos", async () => {
  const id = await criarClienteComLogin({ email: "del@teste.com" });
  __setCookie(NOME_COOKIE, construirTokenCliente(id, "1", Date.now() + 60_000));
  getDb()
    .prepare(
      `INSERT INTO agendamentos
        (cliente_id, cliente_nome, cliente_telefone, data, inicio, fim, preco_centavos, status)
       VALUES (?, 'Del Silva', '44999990000', '2025-02-03', '09:00', '09:30', 4000, 'concluido')`,
    )
    .run(id);

  const { DELETE } = await import("../src/app/api/conta/route.js");
  const resp = await DELETE(
    req("http://localhost/api/conta", { method: "DELETE" }),
  );
  assert.equal(resp.status, 200);

  const cliente = buscarClientePorId(id);
  assert.equal(cliente.email, "");
  assert.ok(cliente.anonimizado_em);
  const ag = getDb()
    .prepare(
      "SELECT cliente_nome, preco_centavos FROM agendamentos WHERE cliente_id = ?",
    )
    .get(id);
  assert.equal(ag.cliente_nome, "Cliente removido");
  assert.equal(ag.preco_centavos, 4000);
});

/* -------------------- gate no POST /api/agendamentos -------------------- */

const DATA = "2030-01-07";

function montarCenario() {
  const conn = getDb();
  conn.exec(
    "DELETE FROM servico_barbeiro; DELETE FROM servicos; DELETE FROM barbeiros;",
  );
  const barbeiro = criarBarbeiro("Barbeiro Conta", conn);
  const servico = Number(
    conn
      .prepare(
        "INSERT INTO servicos (nome, preco_centavos, duracao_min) VALUES ('Corte', 3000, 30)",
      )
      .run().lastInsertRowid,
  );
  conn
    .prepare(
      "INSERT INTO servico_barbeiro (servico_id, barbeiro_id) VALUES (?, ?)",
    )
    .run(servico, barbeiro);
  definirExpediente(
    diaDaSemana(DATA),
    { aberto: 1, abre: "09:00", fecha: "20:00" },
    conn,
  );
  salvarConfig({
    intervalo_min: "30",
    antecedencia_min: "0",
    confirmacao_automatica: "1",
  });
  return { barbeiro, servico };
}

test("POST /api/agendamentos sem sessão de cliente responde 401", async () => {
  const { barbeiro, servico } = montarCenario();
  const { POST } = await import("../src/app/api/agendamentos/route.js");
  const resp = await POST(
    req("http://localhost/api/agendamentos", {
      method: "POST",
      body: {
        barbeiro_id: barbeiro,
        servico_id: servico,
        data: DATA,
        inicio: "10:00",
      },
    }),
  );
  assert.equal(resp.status, 401);
});

test("POST /api/agendamentos com sessão grava cliente_id e nome/telefone da conta", async () => {
  const { barbeiro, servico } = montarCenario();
  const id = await criarClienteComLogin({
    nome: "Carla Conta",
    telefone: "44988887777",
    email: "carla@teste.com",
  });
  __setCookie(NOME_COOKIE, construirTokenCliente(id, "1", Date.now() + 60_000));

  const { POST } = await import("../src/app/api/agendamentos/route.js");
  const resp = await POST(
    req("http://localhost/api/agendamentos", {
      method: "POST",
      body: {
        // nome/telefone no corpo devem ser IGNORADOS — vêm da conta
        cliente_nome: "Nome Falso",
        cliente_telefone: "11111111111",
        barbeiro_id: barbeiro,
        servico_id: servico,
        data: DATA,
        inicio: "10:00",
      },
    }),
  );
  assert.equal(resp.status, 200);

  const ag = getDb()
    .prepare(
      "SELECT cliente_id, cliente_nome, cliente_telefone FROM agendamentos WHERE data = ? AND inicio = '10:00'",
    )
    .get(DATA);
  assert.equal(ag.cliente_id, id);
  assert.equal(ag.cliente_nome, "Carla Conta");
  assert.equal(ag.cliente_telefone, "44988887777");
});
