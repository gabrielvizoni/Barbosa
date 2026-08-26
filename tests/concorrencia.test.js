// Teste de atomicidade de verdade: duas threads de SO separadas, cada uma
// com sua própria conexão SQLite, tentando reservar o mesmo horário ao
// mesmo tempo. Sem o BEGIN IMMEDIATE (ver verificarConflito/criarAgendamento
// em src/lib/agendamentos.js), nada impediria as duas de passarem pela
// checagem antes de qualquer uma gravar — a "atomicidade" seria só um
// acidente de runtime do JavaScript de thread única.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

import { diaDaSemana } from '../src/lib/slots.js';
import { salvarConfig } from '../src/lib/db.js';
import { bancoDeTeste, limparMovimentacao, criarBarbeiro, definirExpediente } from './ajuda.js';

const DATA = '2030-01-07';
const CAMINHO_WORKER = fileURLToPath(new URL('./worker-criar-agendamento.mjs', import.meta.url));

let conn;
let barbeiro;
let servico;

beforeEach(() => {
  conn = bancoDeTeste();
  limparMovimentacao(conn);
  conn.exec('DELETE FROM servico_barbeiro; DELETE FROM servicos; DELETE FROM barbeiros;');

  barbeiro = criarBarbeiro('Barbeiro Concorrência', conn);
  servico = Number(
    conn
      .prepare("INSERT INTO servicos (nome, preco_centavos, duracao_min) VALUES ('Corte', 3000, 30)")
      .run().lastInsertRowid
  );
  conn.prepare('INSERT INTO servico_barbeiro (servico_id, barbeiro_id) VALUES (?, ?)').run(servico, barbeiro);

  definirExpediente(diaDaSemana(DATA), { aberto: 1, abre: '09:00', fecha: '20:00' }, conn);
  salvarConfig({ intervalo_min: '30', antecedencia_min: '0', confirmacao_automatica: '1' });
});

function rodarEmWorker(parametros) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(CAMINHO_WORKER, {
      workerData: { databasePath: process.env.DATABASE_PATH, parametros },
    });
    worker.once('message', (resultado) => {
      resolve(resultado);
      worker.terminate();
    });
    worker.once('error', reject);
  });
}

test('dois agendamentos concorrentes no mesmo horário: um vence (201), o outro recebe 409 — nunca os dois', async () => {
  const parametros = {
    origem: 'painel',
    clienteNome: 'Cliente Concorrente',
    clienteTelefone: '',
    barbeiroId: barbeiro,
    servicoId: servico,
    data: DATA,
    inicio: '10:00',
  };

  const [a, b] = await Promise.all([rodarEmWorker(parametros), rodarEmWorker(parametros)]);

  const sucessos = [a, b].filter((r) => r.ok);
  const conflitos = [a, b].filter((r) => !r.ok);

  assert.equal(sucessos.length, 1, 'exatamente um dos dois deveria ter criado o agendamento');
  assert.equal(conflitos.length, 1, 'o outro deveria ter recebido conflito');
  assert.equal(conflitos[0].status, 409);

  const total = conn
    .prepare(
      `SELECT COUNT(*) AS n FROM agendamentos
       WHERE barbeiro_id = ? AND data = ? AND inicio = ? AND status <> 'cancelado'`
    )
    .get(barbeiro, DATA, '10:00').n;
  assert.equal(total, 1, 'não pode existir mais de um agendamento ativo no mesmo horário');
});
