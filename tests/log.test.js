import { test } from "node:test";
import assert from "node:assert/strict";

import { registrarInfo, registrarErro, comLog } from "../src/lib/log.js";

function capturarStdout(fn) {
  const linhas = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    linhas.push(chunk);
    return true;
  };
  try {
    fn();
  } finally {
    process.stdout.write = original;
  }
  return linhas.map((l) => JSON.parse(l));
}

async function capturarStdoutAsync(fn) {
  const linhas = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    linhas.push(chunk);
    return true;
  };
  let resultado;
  try {
    resultado = await fn();
  } finally {
    process.stdout.write = original;
  }
  return { resultado, linhas: linhas.map((l) => JSON.parse(l)) };
}

test("registrarInfo escreve uma linha NDJSON com ts, nivel, rota e msg", () => {
  const [linha] = capturarStdout(() =>
    registrarInfo("POST /x", "algo aconteceu"),
  );
  assert.equal(linha.nivel, "info");
  assert.equal(linha.rota, "POST /x");
  assert.equal(linha.msg, "algo aconteceu");
  assert.ok(linha.ts);
  assert.ok(!Number.isNaN(Date.parse(linha.ts)));
});

test("registrarInfo aceita contexto extra (ex.: id do agendamento) sem PII", () => {
  const [linha] = capturarStdout(() =>
    registrarInfo(
      "PATCH /api/admin/agendamentos/[id]",
      "agendamento remarcado",
      { agendamentoId: 42 },
    ),
  );
  assert.equal(linha.agendamentoId, 42);
});

test("registrarErro grava só a mensagem do erro, nunca o stack nem o objeto inteiro", () => {
  const [linha] = capturarStdout(() =>
    registrarErro("POST /x", "falhou", new Error("deu ruim")),
  );
  assert.equal(linha.nivel, "erro");
  assert.equal(linha.erro, "deu ruim");
  assert.equal(typeof linha.erro, "string");
});

test("login falho não vaza a senha no log — o contexto nunca inclui o campo", () => {
  const [linha] = capturarStdout(() =>
    registrarInfo("POST /api/admin/login", "login falho"),
  );
  assert.equal(JSON.stringify(linha).toLowerCase().includes("senha"), false);
});

test("comLog deixa passar o resultado normal do handler", async () => {
  const handler = comLog("GET /x", async () => Response.json({ ok: true }));
  const resposta = await handler();
  assert.equal(resposta.status, 200);
});

test("comLog loga o erro real mas devolve mensagem genérica ao cliente (sem vazar detalhe)", async () => {
  const handler = comLog("GET /x", async () => {
    throw new Error("detalhe interno sensível");
  });

  const { resultado, linhas } = await capturarStdoutAsync(() => handler());

  assert.equal(resultado.status, 500);
  const corpo = await resultado.json();
  assert.equal(corpo.erro.includes("detalhe interno sensível"), false);

  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].nivel, "erro");
  assert.equal(linhas[0].erro, "detalhe interno sensível");
});
