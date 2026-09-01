// Conta do cliente (migration 8). Espelha tests/auth-barbeiro.test.js:
// cadastro, autenticação, tokens de recuperação, invalidação de sessão por
// sessao_versao e anonimização a pedido do cliente (RF-19 / RN-44).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  cadastrarCliente,
  autenticarCliente,
  construirTokenCliente,
  consumirTokenResetCliente,
  decodificarSessaoCliente,
  gerarTokenResetCliente,
  trocarSenhaCliente,
  NOME_COOKIE,
} from "../src/lib/cliente-auth.js";
import { anonimizarCliente, buscarClientePorId, getDb } from "../src/lib/db.js";
import { __resetCookies, __setCookie } from "./fake-next-headers.mjs";
import { bancoDeTeste } from "./ajuda.js";

beforeEach(() => {
  bancoDeTeste();
  __resetCookies();
  getDb().exec(
    "DELETE FROM cliente_reset_tokens; DELETE FROM agendamentos; DELETE FROM clientes;",
  );
});

/* -------------------- cadastrarCliente -------------------- */

test("cadastrarCliente cria a conta com dados válidos", async () => {
  const r = await cadastrarCliente({
    nome: "Ana Cliente",
    telefone: "(44) 99999-0000",
    email: "Ana@Teste.com",
    senha: "senha-boa-123",
  });
  assert.equal(r.ok, true);
  const cliente = buscarClientePorId(r.clienteId);
  assert.equal(cliente.nome, "Ana Cliente");
  assert.equal(cliente.telefone, "44999990000");
  assert.equal(cliente.email, "ana@teste.com"); // normalizado
});

test("cadastrarCliente exige telefone com 10-11 dígitos", async () => {
  const r = await cadastrarCliente({
    nome: "Ana",
    telefone: "44999",
    email: "a@b.com",
    senha: "senha-boa-123",
  });
  assert.equal(r.ok, false);
});

test("cadastrarCliente exige e-mail e senha mínima", async () => {
  assert.equal(
    (
      await cadastrarCliente({
        nome: "Ana",
        telefone: "44999990000",
        email: "",
        senha: "senha-boa-123",
      })
    ).ok,
    false,
  );
  assert.equal(
    (
      await cadastrarCliente({
        nome: "Ana",
        telefone: "44999990000",
        email: "a@b.com",
        senha: "123",
      })
    ).ok,
    false,
  );
});

test("cadastrarCliente recusa e-mail já cadastrado (case-insensitive)", async () => {
  await cadastrarCliente({
    nome: "Ana",
    telefone: "44999990000",
    email: "dup@teste.com",
    senha: "senha-boa-123",
  });
  const r = await cadastrarCliente({
    nome: "Outra",
    telefone: "44988880000",
    email: "DUP@teste.com",
    senha: "senha-boa-123",
  });
  assert.equal(r.ok, false);
});

/* -------------------- autenticarCliente -------------------- */

async function criar(email = "login@teste.com", senha = "senha-boa-123") {
  const r = await cadastrarCliente({
    nome: "Login",
    telefone: "44999990000",
    email,
    senha,
  });
  return r.clienteId;
}

test("autenticarCliente aceita e-mail e senha corretos, case-insensitive", async () => {
  await criar("MaiUsc@Teste.com", "senha-boa-123");
  const r = await autenticarCliente("maiusc@teste.com", "senha-boa-123");
  assert.equal(r.ok, true);
});

test("autenticarCliente rejeita senha errada e e-mail inexistente", async () => {
  await criar("x@teste.com", "senha-boa-123");
  assert.equal((await autenticarCliente("x@teste.com", "errada")).ok, false);
  assert.equal(
    (await autenticarCliente("ninguem@teste.com", "qualquer")).ok,
    false,
  );
});

test("autenticarCliente rejeita conta anonimizada mesmo com a senha certa", async () => {
  const id = await criar("some@teste.com", "senha-boa-123");
  anonimizarCliente(id);
  const r = await autenticarCliente("some@teste.com", "senha-boa-123");
  assert.equal(r.ok, false);
});

/* -------------------- sessão / token -------------------- */

test("decodificarSessaoCliente valida assinatura, expiração e versão", async () => {
  const id = await criar();
  const bom = construirTokenCliente(id, "1", Date.now() + 60_000);
  assert.equal(decodificarSessaoCliente(bom)?.clienteId, id);

  assert.equal(decodificarSessaoCliente(bom + "x"), null); // assinatura quebrada
  assert.equal(
    decodificarSessaoCliente(construirTokenCliente(id, "1", Date.now() - 1000)),
    null,
  ); // expirado
  assert.equal(
    decodificarSessaoCliente(
      construirTokenCliente(id, "9", Date.now() + 60_000),
    ),
    null,
  ); // versão errada
});

test("trocarSenhaCliente sobe sessao_versao e derruba um cookie antigo", async () => {
  const id = await criar("versao@teste.com", "senha-antiga-123");
  const tokenAntigo = construirTokenCliente(id, "1", Date.now() + 60_000);
  __setCookie(NOME_COOKIE, tokenAntigo);
  assert.ok(decodificarSessaoCliente(tokenAntigo));

  const r = await trocarSenhaCliente(id, "senha-antiga-123", "senha-nova-456");
  assert.equal(r.ok, true);
  assert.equal(decodificarSessaoCliente(tokenAntigo), null);
  assert.equal(
    (await autenticarCliente("versao@teste.com", "senha-nova-456")).ok,
    true,
  );
});

test("trocarSenhaCliente rejeita a senha atual errada", async () => {
  const id = await criar();
  const r = await trocarSenhaCliente(id, "errada", "senha-nova-456");
  assert.equal(r.ok, false);
});

/* -------------------- token de recuperação -------------------- */

test("consumirTokenResetCliente aceita um token recém-gerado e grava a senha", async () => {
  const id = await criar("reset@teste.com", "senha-antiga-123");
  const token = gerarTokenResetCliente(id, "1.2.3.4");
  const r = await consumirTokenResetCliente(token, "senha-nova-123");
  assert.equal(r.ok, true);
  assert.equal(
    (await autenticarCliente("reset@teste.com", "senha-nova-123")).ok,
    true,
  );
});

test("consumirTokenResetCliente rejeita inexistente, expirado e já usado", async () => {
  assert.equal(
    (await consumirTokenResetCliente("nunca-existiu", "senha-nova-123")).ok,
    false,
  );

  const id = await criar("r2@teste.com");
  const token = gerarTokenResetCliente(id, "1.2.3.4");
  getDb()
    .prepare(
      "UPDATE cliente_reset_tokens SET expira_em = datetime('now', '-1 minute')",
    )
    .run();
  assert.equal(
    (await consumirTokenResetCliente(token, "senha-nova-123")).ok,
    false,
  );

  const id2 = await criar("r3@teste.com");
  const t2 = gerarTokenResetCliente(id2, "1.2.3.4");
  assert.equal(
    (await consumirTokenResetCliente(t2, "senha-nova-123")).ok,
    true,
  );
  assert.equal(
    (await consumirTokenResetCliente(t2, "outra-senha-456")).ok,
    false,
  );
});

test("consumirTokenResetCliente invalida os outros tokens pendentes do mesmo cliente", async () => {
  const id = await criar("r4@teste.com");
  const primeiro = gerarTokenResetCliente(id, "1.2.3.4");
  const segundo = gerarTokenResetCliente(id, "1.2.3.4");
  await consumirTokenResetCliente(segundo, "senha-nova-123");
  assert.equal(
    (await consumirTokenResetCliente(primeiro, "outra-456")).ok,
    false,
  );
});

/* -------------------- anonimização -------------------- */

test("anonimizarCliente zera a conta e o retrato nos agendamentos, e sobe a versão", async () => {
  const id = await criar("apagar@teste.com", "senha-boa-123");
  const versaoAntes = buscarClientePorId(id).sessao_versao;
  getDb()
    .prepare(
      `INSERT INTO agendamentos
        (cliente_id, cliente_nome, cliente_telefone, data, inicio, fim, preco_centavos, status)
       VALUES (?, 'Apagar Silva', '44999990000', '2025-01-08', '10:00', '10:30', 5000, 'concluido')`,
    )
    .run(id);

  anonimizarCliente(id);

  const cliente = buscarClientePorId(id);
  assert.equal(cliente.nome, "");
  assert.equal(cliente.email, "");
  assert.equal(cliente.senha_hash, "");
  assert.ok(cliente.anonimizado_em);
  assert.equal(cliente.sessao_versao, versaoAntes + 1);

  const ag = getDb()
    .prepare(
      "SELECT cliente_nome, cliente_telefone, preco_centavos, status FROM agendamentos WHERE cliente_id = ?",
    )
    .get(id);
  assert.equal(ag.cliente_nome, "Cliente removido");
  assert.equal(ag.cliente_telefone, "");
  assert.equal(ag.preco_centavos, 5000); // financeiro preservado
  assert.equal(ag.status, "concluido");
});
