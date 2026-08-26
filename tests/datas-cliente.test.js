import { test } from "node:test";
import assert from "node:assert/strict";

import { hojeLocal, mesAtualLocal } from "../src/lib/datas-cliente.js";

// 25/08/2026 21:30 em America/Sao_Paulo (UTC-3) = 26/08/2026 00:30 em UTC —
// exatamente o cenário do bug do audit: já é "amanhã" em UTC, mas ainda é
// "hoje" no fuso da barbearia.
const VIRADA = new Date("2026-08-26T00:30:00.000Z");

test("hojeLocal com fuso UTC pega o dia já virado", () => {
  assert.equal(hojeLocal("UTC", VIRADA), "2026-08-26");
});

test("hojeLocal com fuso America/Sao_Paulo ainda está no dia anterior, no horário de virada", () => {
  assert.equal(hojeLocal("America/Sao_Paulo", VIRADA), "2026-08-25");
});

test("hojeLocal não vira antes da hora em America/Sao_Paulo (23:59 ainda é o mesmo dia)", () => {
  const quaseVirando = new Date("2026-08-26T02:59:00.000Z"); // 25/08 23:59 em UTC-3
  assert.equal(hojeLocal("America/Sao_Paulo", quaseVirando), "2026-08-25");

  const virou = new Date("2026-08-26T03:00:00.000Z"); // 26/08 00:00 em UTC-3
  assert.equal(hojeLocal("America/Sao_Paulo", virou), "2026-08-26");
});

test("mesAtualLocal segue a mesma regra de fuso, na virada do mês", () => {
  const fimDoMes = new Date("2026-09-01T02:30:00.000Z"); // 31/08 23:30 em UTC-3
  assert.equal(mesAtualLocal("UTC", fimDoMes), "2026-09");
  assert.equal(mesAtualLocal("America/Sao_Paulo", fimDoMes), "2026-08");
});

test("hojeLocal sem instante explícito usa o momento atual", () => {
  const hojeReal = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(
    new Date(),
  );
  assert.equal(hojeLocal("UTC"), hojeReal);
});
