import { test } from "node:test";
import assert from "node:assert/strict";

import {
  validar,
  dataValida,
  horaValida,
  validarExpediente,
  primeiroErro,
} from "../src/lib/validacao.js";

test("rejeita duracao_min = 0 na criação de serviço", () => {
  const { ok, erros } = validar(
    "servicos",
    { nome: "Corte", duracao_min: 0 },
    { criando: true },
  );
  assert.equal(ok, false);
  assert.ok(erros.duracao_min);
});

test("aceita duracao_min dentro da faixa (5 a 480)", () => {
  assert.equal(
    validar("servicos", { nome: "Corte", duracao_min: 5 }, { criando: true })
      .ok,
    true,
  );
  assert.equal(
    validar("servicos", { nome: "Corte", duracao_min: 480 }, { criando: true })
      .ok,
    true,
  );
  assert.equal(
    validar("servicos", { nome: "Corte", duracao_min: 481 }, { criando: true })
      .ok,
    false,
  );
});

test("rejeita preco_centavos negativo e acima do teto de 10.000.000", () => {
  assert.equal(
    validar("servicos", { nome: "x", preco_centavos: -1 }).ok,
    false,
  );
  assert.equal(
    validar("servicos", { nome: "x", preco_centavos: 10_000_001 }).ok,
    false,
  );
  assert.equal(
    validar("servicos", { nome: "x", preco_centavos: 10_000_000 }).ok,
    true,
  );
});

test("rejeita estoque negativo em produtos", () => {
  assert.equal(validar("produtos", { nome: "x", estoque: -1 }).ok, false);
  assert.equal(validar("produtos", { nome: "x", estoque: 0 }).ok, true);
});

test("rejeita ordem fora de 0..9999", () => {
  assert.equal(validar("servicos", { nome: "x", ordem: -1 }).ok, false);
  assert.equal(validar("servicos", { nome: "x", ordem: 10_000 }).ok, false);
});

test("rejeita texto acima do limite de comprimento", () => {
  assert.equal(validar("barbeiros", { nome: "a".repeat(81) }).ok, false);
  assert.equal(validar("barbeiros", { nome: "a".repeat(80) }).ok, true);
});

test("nome é exigido ao criar, mas não numa atualização parcial", () => {
  assert.equal(validar("servicos", {}, { criando: true }).ok, false);
  assert.equal(validar("servicos", { ordem: 3 }, { criando: false }).ok, true);
});

test("bloqueios: exige data/início/fim ao criar, e fim > início", () => {
  assert.equal(validar("bloqueios", {}, { criando: true }).ok, false);

  const fimAntes = validar(
    "bloqueios",
    { data: "2030-01-01", inicio: "10:00", fim: "09:00" },
    { criando: true },
  );
  assert.equal(fimAntes.ok, false);
  assert.ok(fimAntes.erros.fim);

  const valido = validar(
    "bloqueios",
    { data: "2030-01-01", inicio: "10:00", fim: "10:30" },
    { criando: true },
  );
  assert.equal(valido.ok, true);
});

test("bloqueios: PATCH parcial sem inicio/fim não dispara a checagem fim > início", () => {
  assert.equal(validar("bloqueios", { motivo: "Almoço" }).ok, true);
});

test("dataValida rejeita data com formato certo mas inexistente (30 de fevereiro)", () => {
  assert.ok(dataValida("2024-02-30"));
  assert.equal(dataValida("2024-02-29"), null); // 2024 é bissexto
  assert.ok(dataValida("30/01/2030"));
});

test("horaValida rejeita 99:99", () => {
  assert.ok(horaValida("99:99"));
  assert.equal(horaValida("23:59"), null);
});

test("validarExpediente rejeita fecha <= abre", () => {
  const { ok, erros } = validarExpediente([
    { dia: 1, abre: "20:00", fecha: "09:00" },
    { dia: 2, abre: "09:00", fecha: "20:00" },
  ]);
  assert.equal(ok, false);
  assert.equal(erros.length, 1);
  assert.equal(erros[0].dia, 1);
});

test('primeiroErro formata "campo: mensagem", ou null sem erros', () => {
  assert.equal(
    primeiroErro({ nome: "é obrigatório." }),
    "nome: é obrigatório.",
  );
  assert.equal(primeiroErro({}), null);
});
