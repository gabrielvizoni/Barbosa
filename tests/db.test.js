import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";
import Database from "better-sqlite3";

import { bancoDeTeste, limparMovimentacao, criarBarbeiro } from "./ajuda.js";
import {
  aplicarMigrations,
  versaoDoBanco,
  versaoEsperada,
} from "../src/lib/migrations.js";

let conn;
let barbeiro;

beforeEach(() => {
  conn = bancoDeTeste();
  limparMovimentacao(conn);
  barbeiro = criarBarbeiro("Barbeiro Constraint", conn);
});

function inserirServico(overrides = {}) {
  const s = {
    nome: "Corte",
    preco_centavos: 3000,
    duracao_min: 30,
    ...overrides,
  };
  return conn
    .prepare(
      "INSERT INTO servicos (nome, preco_centavos, duracao_min) VALUES (?, ?, ?)",
    )
    .run(s.nome, s.preco_centavos, s.duracao_min);
}

function inserirProduto(overrides = {}) {
  const p = { nome: "Pomada", preco_centavos: 2500, estoque: 10, ...overrides };
  return conn
    .prepare(
      "INSERT INTO produtos (nome, preco_centavos, estoque) VALUES (?, ?, ?)",
    )
    .run(p.nome, p.preco_centavos, p.estoque);
}

function inserirAgendamento(overrides = {}) {
  const a = {
    barbeiro_id: barbeiro,
    data: "2030-01-08",
    inicio: "10:00",
    fim: "10:30",
    status: "pendente",
    ...overrides,
  };
  return conn
    .prepare(
      `INSERT INTO agendamentos (cliente_nome, cliente_telefone, barbeiro_id, data, inicio, fim, status)
       VALUES ('Cliente', '44999999999', ?, ?, ?, ?, ?)`,
    )
    .run(a.barbeiro_id, a.data, a.inicio, a.fim, a.status);
}

test("rejeita status inválido em agendamentos", () => {
  assert.throws(
    () => inserirAgendamento({ status: "qualquer_coisa" }),
    /CHECK constraint failed/,
  );
});

test("rejeita duracao_min = 0 em servicos", () => {
  assert.throws(
    () => inserirServico({ duracao_min: 0 }),
    /CHECK constraint failed/,
  );
});

test("rejeita duracao_min fora da faixa (acima de 480) em servicos", () => {
  assert.throws(
    () => inserirServico({ duracao_min: 481 }),
    /CHECK constraint failed/,
  );
});

test("rejeita preco_centavos negativo em servicos e produtos", () => {
  assert.throws(
    () => inserirServico({ preco_centavos: -100 }),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => inserirProduto({ preco_centavos: -1 }),
    /CHECK constraint failed/,
  );
});

test("rejeita estoque negativo em produtos", () => {
  assert.throws(
    () => inserirProduto({ estoque: -1 }),
    /CHECK constraint failed/,
  );
});

test("rejeita data em formato errado em agendamentos", () => {
  assert.throws(
    () => inserirAgendamento({ data: "08/01/2030" }),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => inserirAgendamento({ data: "amanhã" }),
    /CHECK constraint failed/,
  );
});

test("rejeita horário em formato errado em agendamentos", () => {
  assert.throws(
    () => inserirAgendamento({ inicio: "99:99" }),
    /CHECK constraint failed/,
  );
});

test("rejeita fim <= início em agendamentos", () => {
  assert.throws(
    () => inserirAgendamento({ inicio: "10:00", fim: "10:00" }),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => inserirAgendamento({ inicio: "10:30", fim: "10:00" }),
    /CHECK constraint failed/,
  );
});

test("índice único parcial rejeita um segundo agendamento no mesmo barbeiro/data/início", () => {
  inserirAgendamento({ inicio: "11:00", fim: "11:30" });
  assert.throws(
    () => inserirAgendamento({ inicio: "11:00", fim: "11:45" }),
    /UNIQUE constraint failed/,
  );
});

test("agendamento cancelado não conta para o índice único — outro pode ocupar o mesmo horário", () => {
  inserirAgendamento({ inicio: "12:00", fim: "12:30", status: "cancelado" });
  assert.doesNotThrow(() =>
    inserirAgendamento({ inicio: "12:00", fim: "12:30", status: "pendente" }),
  );
});

test("rejeita expediente do profissional com fecha <= abre", () => {
  assert.throws(
    () =>
      conn
        .prepare(
          "UPDATE expediente_barbeiro SET abre = ?, fecha = ? WHERE barbeiro_id = ? AND dia = 1",
        )
        .run("10:00", "10:00", barbeiro),
    /CHECK constraint failed/,
  );
  assert.throws(
    () =>
      conn
        .prepare(
          "UPDATE expediente_barbeiro SET abre = ?, fecha = ? WHERE barbeiro_id = ? AND dia = 1",
        )
        .run("10:30", "10:00", barbeiro),
    /CHECK constraint failed/,
  );
});

test("rejeita expediente do profissional com dia fora de 0..6 e horário em formato errado", () => {
  assert.throws(
    () =>
      conn
        .prepare(
          "INSERT INTO expediente_barbeiro (barbeiro_id, dia, abre, fecha) VALUES (?, 7, ?, ?)",
        )
        .run(barbeiro, "09:00", "18:00"),
    /CHECK constraint failed/,
  );
  assert.throws(
    () =>
      conn
        .prepare(
          "UPDATE expediente_barbeiro SET abre = ? WHERE barbeiro_id = ? AND dia = 1",
        )
        .run("9:00", barbeiro),
    /CHECK constraint failed/,
  );
});

test("expediente_barbeiro nasce semeado com o padrão ao criar o profissional", () => {
  const linhas = conn
    .prepare(
      "SELECT dia, aberto, abre, fecha FROM expediente_barbeiro WHERE barbeiro_id = ? ORDER BY dia",
    )
    .all(barbeiro);
  assert.equal(linhas.length, 7);
  assert.deepEqual(linhas[0], {
    dia: 0,
    aberto: 0,
    abre: "09:00",
    fecha: "18:00",
  });
  assert.deepEqual(linhas[1], {
    dia: 1,
    aberto: 1,
    abre: "09:00",
    fecha: "20:00",
  });
  assert.deepEqual(linhas[6], {
    dia: 6,
    aberto: 1,
    abre: "08:00",
    fecha: "18:00",
  });
});

test("apagar o profissional leva junto o expediente e as folgas recorrentes (ON DELETE CASCADE)", () => {
  conn
    .prepare(
      "INSERT INTO folgas_recorrentes (barbeiro_id, dia_semana) VALUES (?, 1)",
    )
    .run(barbeiro);
  conn.prepare("DELETE FROM barbeiros WHERE id = ?").run(barbeiro);
  assert.equal(
    conn
      .prepare(
        "SELECT COUNT(*) AS n FROM expediente_barbeiro WHERE barbeiro_id = ?",
      )
      .get(barbeiro).n,
    0,
  );
  assert.equal(
    conn
      .prepare(
        "SELECT COUNT(*) AS n FROM folgas_recorrentes WHERE barbeiro_id = ?",
      )
      .get(barbeiro).n,
    0,
  );
});

test("runner de migrations: aplicarMigrations é idempotente", () => {
  assert.equal(versaoDoBanco(conn), versaoEsperada());
  const aplicadas = aplicarMigrations(conn);
  assert.deepEqual(aplicadas, []);
});

test("um banco novo não vem com nenhum barbeiro, serviço ou produto cadastrado", () => {
  const caminho = path.join(
    os.tmpdir(),
    `barbosa-fresco-${crypto.randomBytes(4).toString("hex")}.db`,
  );
  const fresco = new Database(caminho);
  fresco.pragma("foreign_keys = ON");
  aplicarMigrations(fresco);

  const contar = (tabela) =>
    fresco.prepare(`SELECT COUNT(*) AS n FROM ${tabela}`).get().n;
  assert.equal(contar("barbeiros"), 0);
  assert.equal(contar("servicos"), 0);
  assert.equal(contar("produtos"), 0);

  fresco.close();
  for (const sufixo of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(caminho + sufixo);
    } catch {
      // sem problema
    }
  }
});
