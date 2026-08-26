import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  criarAgendamento,
  mudarStatusAgendamento,
  remarcarAgendamento,
} from "../src/lib/agendamentos.js";
import { agora, diaDaSemana } from "../src/lib/slots.js";
import { salvarConfig } from "../src/lib/db.js";
import {
  bancoDeTeste,
  limparMovimentacao,
  criarBarbeiro,
  definirExpediente,
} from "./ajuda.js";

const DATA_FUTURA = "2030-01-07";

let conn;
let barbeiro;
let servico;

beforeEach(() => {
  conn = bancoDeTeste();
  limparMovimentacao(conn);
  conn.exec(
    "DELETE FROM servico_barbeiro; DELETE FROM servicos; DELETE FROM barbeiros;",
  );

  barbeiro = criarBarbeiro("Barbeiro Estado", conn);
  servico = Number(
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
    diaDaSemana(DATA_FUTURA),
    { aberto: 1, abre: "09:00", fecha: "20:00" },
    conn,
  );
  salvarConfig({
    intervalo_min: "30",
    antecedencia_min: "0",
    confirmacao_automatica: "1",
  });
});

/** Cria um agendamento pelo painel (nasce 'confirmado') e devolve o id. */
function criar(overrides = {}) {
  const r = criarAgendamento({
    origem: "painel",
    clienteNome: "Cliente",
    clienteTelefone: "",
    barbeiroId: barbeiro,
    servicoId: servico,
    data: DATA_FUTURA,
    inicio: "10:00",
    ...overrides,
  });
  assert.equal(
    r.ok,
    true,
    `fixture deveria ter criado com sucesso: ${JSON.stringify(r)}`,
  );
  return r.id;
}

test("transições legais de status são aceitas: confirmado→cancelado→pendente→confirmado", () => {
  const id = criar();
  assert.equal(mudarStatusAgendamento(id, "cancelado").ok, true);
  assert.equal(mudarStatusAgendamento(id, "pendente").ok, true);
  assert.equal(mudarStatusAgendamento(id, "confirmado").ok, true);
});

test("transição concluido→pendente é rejeitada", () => {
  const id = criar({ inicio: "11:00" });
  // Concluir exige data não-futura — ajusta só para chegar no estado do teste.
  conn
    .prepare(
      "UPDATE agendamentos SET status = 'concluido', data = ? WHERE id = ?",
    )
    .run(agora().data, id);

  const resultado = mudarStatusAgendamento(id, "pendente");
  assert.equal(resultado.ok, false);
  assert.equal(resultado.status, 400);
});

test("não é possível concluir um agendamento com data futura", () => {
  const id = criar({ inicio: "12:00" }); // já nasce 'confirmado' (origem painel)
  const resultado = mudarStatusAgendamento(id, "concluido");
  assert.equal(resultado.ok, false);
  assert.equal(resultado.status, 400);
});

test("reabertura de cancelado é rejeitada quando o horário já foi ocupado por outro agendamento", () => {
  const id = criar({ inicio: "13:00" });
  assert.equal(mudarStatusAgendamento(id, "cancelado").ok, true);

  // Outro cliente pega o mesmo horário enquanto o primeiro estava cancelado.
  criar({ clienteNome: "Outro Cliente", inicio: "13:00" });

  const reabertura = mudarStatusAgendamento(id, "pendente");
  assert.equal(reabertura.ok, false);
  assert.equal(reabertura.status, 409);

  // E o agendamento cancelado continua cancelado — a tentativa não mudou nada.
  const linha = conn
    .prepare("SELECT status FROM agendamentos WHERE id = ?")
    .get(id);
  assert.equal(linha.status, "cancelado");
});

test("reabertura de cancelado funciona quando o horário continua livre", () => {
  const id = criar({ inicio: "14:00" });
  assert.equal(mudarStatusAgendamento(id, "cancelado").ok, true);
  assert.equal(mudarStatusAgendamento(id, "pendente").ok, true);
});

test("status inválido é rejeitado", () => {
  const id = criar({ inicio: "15:00" });
  const resultado = mudarStatusAgendamento(id, "qualquer_coisa");
  assert.equal(resultado.ok, false);
  assert.equal(resultado.status, 400);
});

test("mudar status de agendamento inexistente devolve 404", () => {
  const resultado = mudarStatusAgendamento(999_999, "confirmado");
  assert.equal(resultado.ok, false);
  assert.equal(resultado.status, 404);
});

test("remarcação para horário ocupado é rejeitada", () => {
  const idAlvo = criar({ clienteNome: "Alvo", inicio: "16:00" });
  criar({ clienteNome: "Ocupante", inicio: "17:00" });

  const resultado = remarcarAgendamento(idAlvo, { inicio: "17:15" }); // 17:15–17:45 colide com 17:00–17:30
  assert.equal(resultado.ok, false);
  assert.equal(resultado.status, 409);

  const linha = conn
    .prepare("SELECT inicio FROM agendamentos WHERE id = ?")
    .get(idAlvo);
  assert.equal(
    linha.inicio,
    "16:00",
    "remarcação rejeitada não deveria ter mudado nada",
  );
});

test("remarcação para horário livre funciona e atualiza os campos derivados", () => {
  const id = criar({ inicio: "09:00" });
  const resultado = remarcarAgendamento(id, { inicio: "09:30" });
  assert.equal(resultado.ok, true);

  const linha = conn.prepare("SELECT * FROM agendamentos WHERE id = ?").get(id);
  assert.equal(linha.inicio, "09:30");
  assert.equal(linha.fim, "10:00");
});

test("remarcação não esbarra no próprio horário atual (ignora a si mesma no conflito)", () => {
  const id = criar({ inicio: "10:00" });
  const resultado = remarcarAgendamento(id, { inicio: "10:00" });
  assert.equal(resultado.ok, true);
});

test("remarcação de agendamento concluído ou cancelado é rejeitada", () => {
  const id = criar({ inicio: "18:00" });
  conn
    .prepare("UPDATE agendamentos SET status = 'cancelado' WHERE id = ?")
    .run(id);

  const resultado = remarcarAgendamento(id, { inicio: "18:30" });
  assert.equal(resultado.ok, false);
  assert.equal(resultado.status, 400);
});

test("remarcação de agendamento inexistente devolve 404", () => {
  const resultado = remarcarAgendamento(999_999, { inicio: "09:00" });
  assert.equal(resultado.ok, false);
  assert.equal(resultado.status, 404);
});
