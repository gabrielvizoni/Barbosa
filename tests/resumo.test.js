// Cobre os itens 1 e 4 da Etapa 7: agrupamento dos relatórios por id (não
// por nome congelado) e consistência entre a série de 12 meses e os cartões
// de KPI, para a mesma definição (status <> 'cancelado').
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { bancoDeTeste, criarBarbeiro } from "./ajuda.js";
import { getDb, salvarConfig } from "../src/lib/db.js";
import { gerarHash } from "../src/lib/auth.js";
import { construirToken, NOME_COOKIE } from "../src/lib/auth.js";
import { __resetCookies, __setCookie } from "./fake-next-headers.mjs";

let conn;

beforeEach(async () => {
  conn = bancoDeTeste();
  conn.exec(
    "DELETE FROM agendamentos; DELETE FROM barbeiros; DELETE FROM servicos;",
  );
  __resetCookies();
  // Senha própria já cadastrada, para não cair na trava da senha inicial.
  await salvarConfig({
    senha_hash: await gerarHash("senha-de-teste-99"),
    sessao_versao: "1",
  });
  __setCookie(NOME_COOKIE, construirToken("1", Date.now() + 60_000));
});

/** Insere um agendamento com todas as colunas exigidas pelas CHECK constraints. */
function inserirAgendamento({
  barbeiroId,
  barbeiroNome,
  servicoId = null,
  servicoNome = "",
  data,
  inicio,
  fim,
  precoCentavos = 5000,
  status = "confirmado",
}) {
  conn
    .prepare(
      `INSERT INTO agendamentos
        (cliente_nome, cliente_telefone, barbeiro_id, servico_id, barbeiro_nome, servico_nome,
         data, inicio, fim, duracao_min, preco_centavos, status)
       VALUES ('Cliente Teste', '44999999999', ?, ?, ?, ?, ?, ?, ?, 30, ?, ?)`,
    )
    .run(
      barbeiroId,
      servicoId,
      barbeiroNome,
      servicoNome,
      data,
      inicio,
      fim,
      precoCentavos,
      status,
    );
}

test("renomear o profissional entre dois agendamentos não parte o relatório em duas linhas", async () => {
  const { GET } = await import("../src/app/api/admin/resumo/route.js");

  const barbeiroId = criarBarbeiro("Ana", conn);
  inserirAgendamento({
    barbeiroId,
    barbeiroNome: "Ana",
    data: "2025-03-05",
    inicio: "10:00",
    fim: "10:30",
    status: "concluido",
  });

  // Cadastro renomeado depois do primeiro agendamento — o snapshot antigo
  // ('Ana') fica congelado na linha já criada, mas o relatório precisa
  // agrupar pelo id, não pelo nome.
  conn
    .prepare("UPDATE barbeiros SET nome = ? WHERE id = ?")
    .run("Ana Donegá", barbeiroId);

  inserirAgendamento({
    barbeiroId,
    barbeiroNome: "Ana Donegá",
    data: "2025-03-12",
    inicio: "11:00",
    fim: "11:30",
    status: "concluido",
  });

  const resposta = await GET(
    new Request("http://localhost/api/admin/resumo?mes=2025-03", {
      method: "GET",
    }),
  );
  assert.equal(resposta.status, 200);
  const corpo = await resposta.json();

  assert.equal(corpo.financeiro.porBarbeiro.length, 1);
  assert.equal(corpo.financeiro.porBarbeiro[0].nome, "Ana Donegá");
  assert.equal(corpo.financeiro.porBarbeiro[0].quantidade, 2);
});

test("os totais mensais da série batem com a soma dos cartões, para a mesma definição", async () => {
  const { GET } = await import("../src/app/api/admin/resumo/route.js");

  const barbeiroId = criarBarbeiro("Barbeiro Teste", conn);
  // Realizado (concluído) e previsto (confirmado) no mesmo mês.
  inserirAgendamento({
    barbeiroId,
    barbeiroNome: "Barbeiro Teste",
    data: "2025-03-05",
    inicio: "10:00",
    fim: "10:30",
    precoCentavos: 4000,
    status: "concluido",
  });
  inserirAgendamento({
    barbeiroId,
    barbeiroNome: "Barbeiro Teste",
    data: "2025-03-20",
    inicio: "14:00",
    fim: "14:30",
    precoCentavos: 6000,
    status: "confirmado",
  });
  // Cancelado: não deve entrar em nenhuma das duas somas.
  inserirAgendamento({
    barbeiroId,
    barbeiroNome: "Barbeiro Teste",
    data: "2025-03-22",
    inicio: "09:00",
    fim: "09:30",
    precoCentavos: 9999,
    status: "cancelado",
  });

  const resposta = await GET(
    new Request("http://localhost/api/admin/resumo?mes=2025-03", {
      method: "GET",
    }),
  );
  assert.equal(resposta.status, 200);
  const { financeiro } = await resposta.json();

  const pontoDaSerie = financeiro.serie.find((p) => p.mes === "2025-03");
  assert.ok(pontoDaSerie, "a série de 12 meses deveria incluir março/2025");

  const somaDosCartoes =
    financeiro.principal.realizado.faturamento +
    financeiro.principal.previsto.faturamento;
  assert.equal(pontoDaSerie.total, somaDosCartoes);
  assert.equal(pontoDaSerie.total, 10000); // 4000 + 6000, sem o cancelado
});
