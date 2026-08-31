import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  horariosLivres,
  agora,
  somarDias,
  diaDaSemana,
} from "../src/lib/slots.js";
import { salvarConfig } from "../src/lib/db.js";
import {
  bancoDeTeste,
  limparMovimentacao,
  definirExpediente,
  criarBarbeiro,
  criarAgendamento,
  criarBloqueio,
} from "./ajuda.js";

const SEGUNDA = "2024-01-08"; // Monday, sem relação com "hoje" — evita antecedência.

let conn;
let barbeiro1;
let barbeiro2;

beforeEach(() => {
  conn = bancoDeTeste();
  limparMovimentacao(conn);
  salvarConfig({ intervalo_min: "30", antecedencia_min: "60" });
  // Os barbeiros precisam existir antes: o expediente é individual e o
  // gatilho de migration 7 só semeia expediente_barbeiro no INSERT do barbeiro.
  barbeiro1 = criarBarbeiro("Barbeiro 1", conn);
  barbeiro2 = criarBarbeiro("Barbeiro 2", conn);
  definirExpediente(1, { aberto: 1, abre: "09:00", fecha: "20:00" }, conn); // segunda
});

test("dia sem expediente devolve lista vazia", () => {
  definirExpediente(1, { aberto: 0, abre: "09:00", fecha: "20:00" }, conn);
  const livres = horariosLivres({
    barbeiroId: barbeiro1,
    duracaoMin: 30,
    data: SEGUNDA,
  });
  assert.deepEqual(livres, []);
});

// horariosLivres() ainda tem `if (fecha <= abre) return []` como defesa extra,
// mas desde a Etapa 2 o próprio banco tem CHECK (fecha > abre) em expediente
// — não dá mais para gravar essa linha para testar o caminho pela leitura.
// A rejeição na escrita está coberta em tests/db.test.js.
test("CHECK (fecha > abre) impede gravar um expediente inválido", () => {
  assert.throws(
    () =>
      definirExpediente(1, { aberto: 1, abre: "10:00", fecha: "10:00" }, conn),
    /CHECK constraint failed/,
  );
});

test("dia livre devolve a grade completa conforme intervalo_min", () => {
  definirExpediente(1, { aberto: 1, abre: "09:00", fecha: "10:00" }, conn);
  const livres = horariosLivres({
    barbeiroId: barbeiro1,
    duracaoMin: 30,
    data: SEGUNDA,
  });
  assert.deepEqual(livres, ["09:00", "09:30"]);
});

test("agendamento existente remove os horários que colidem, incluindo colisão parcial", () => {
  definirExpediente(1, { aberto: 1, abre: "09:00", fecha: "10:00" }, conn);
  criarAgendamento(
    { barbeiroId: barbeiro1, data: SEGUNDA, inicio: "09:15", fim: "09:45" },
    conn,
  );
  const livres = horariosLivres({
    barbeiroId: barbeiro1,
    duracaoMin: 30,
    data: SEGUNDA,
  });
  // 09:00-09:30 e 09:30-10:00 colidem parcialmente com 09:15-09:45 — os dois somem.
  assert.deepEqual(livres, []);
});

test("agendamento que termina fora da grade libera o horário logo em seguida", () => {
  definirExpediente(1, { aberto: 1, abre: "09:00", fecha: "10:00" }, conn);
  criarAgendamento(
    { barbeiroId: barbeiro1, data: SEGUNDA, inicio: "09:00", fim: "09:45" },
    conn,
  );
  const livres = horariosLivres({
    barbeiroId: barbeiro1,
    duracaoMin: 15,
    data: SEGUNDA,
  });
  assert.deepEqual(livres, ["09:45"]);
});

test("bloqueio com barbeiro_id nulo afeta todos os profissionais", () => {
  definirExpediente(1, { aberto: 1, abre: "09:00", fecha: "10:00" }, conn);
  criarBloqueio(
    { barbeiroId: null, data: SEGUNDA, inicio: "09:00", fim: "10:00" },
    conn,
  );
  assert.deepEqual(
    horariosLivres({ barbeiroId: barbeiro1, duracaoMin: 30, data: SEGUNDA }),
    [],
  );
  assert.deepEqual(
    horariosLivres({ barbeiroId: barbeiro2, duracaoMin: 30, data: SEGUNDA }),
    [],
  );
});

test("bloqueio com barbeiro_id específico só afeta aquele profissional", () => {
  definirExpediente(1, { aberto: 1, abre: "09:00", fecha: "10:00" }, conn);
  criarBloqueio(
    { barbeiroId: barbeiro1, data: SEGUNDA, inicio: "09:00", fim: "10:00" },
    conn,
  );
  assert.deepEqual(
    horariosLivres({ barbeiroId: barbeiro1, duracaoMin: 30, data: SEGUNDA }),
    [],
  );
  assert.deepEqual(
    horariosLivres({ barbeiroId: barbeiro2, duracaoMin: 30, data: SEGUNDA }),
    ["09:00", "09:30"],
  );
});

test("antecedencia_min corta os horários de hoje que já passaram do limite, mas não os de amanhã", () => {
  const hoje = agora();
  const amanha = somarDias(hoje.data, 1);
  const diaSemanaAmanha = diaDaSemana(amanha);

  definirExpediente(
    hoje.diaSemana,
    { aberto: 1, abre: "00:00", fecha: "23:59" },
    conn,
  );
  definirExpediente(
    diaSemanaAmanha,
    { aberto: 1, abre: "00:00", fecha: "23:59" },
    conn,
  );
  salvarConfig({ antecedencia_min: "100000" }); // maior que qualquer janela do dia

  const livresHoje = horariosLivres({
    barbeiroId: barbeiro1,
    duracaoMin: 30,
    data: hoje.data,
  });
  const livresAmanha = horariosLivres({
    barbeiroId: barbeiro1,
    duracaoMin: 30,
    data: amanha,
  });

  assert.deepEqual(livresHoje, []);
  assert.ok(
    livresAmanha.length > 0,
    "amanhã não deveria sofrer o corte de antecedência de hoje",
  );
});

test("serviço com duração maior que o expediente devolve lista vazia", () => {
  definirExpediente(1, { aberto: 1, abre: "09:00", fecha: "10:00" }, conn);
  const livres = horariosLivres({
    barbeiroId: barbeiro1,
    duracaoMin: 90,
    data: SEGUNDA,
  });
  assert.deepEqual(livres, []);
});
