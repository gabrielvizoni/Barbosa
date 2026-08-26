import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { criarAgendamento } from '../src/lib/agendamentos.js';
import { diaDaSemana } from '../src/lib/slots.js';
import { salvarConfig } from '../src/lib/db.js';
import { bancoDeTeste, limparMovimentacao, criarBarbeiro, definirExpediente } from './ajuda.js';

const DATA = '2030-01-07';

let conn;
let barbeiro;
let servico;

beforeEach(() => {
  conn = bancoDeTeste();
  limparMovimentacao(conn);
  conn.exec('DELETE FROM servico_barbeiro; DELETE FROM servicos; DELETE FROM barbeiros;');

  barbeiro = criarBarbeiro('Barbeiro Teste', conn);
  servico = Number(
    conn
      .prepare("INSERT INTO servicos (nome, preco_centavos, duracao_min) VALUES ('Corte', 3000, 30)")
      .run().lastInsertRowid
  );
  conn.prepare('INSERT INTO servico_barbeiro (servico_id, barbeiro_id) VALUES (?, ?)').run(servico, barbeiro);

  definirExpediente(diaDaSemana(DATA), { aberto: 1, abre: '09:00', fecha: '20:00' }, conn);
  salvarConfig({ intervalo_min: '30', antecedencia_min: '0', confirmacao_automatica: '1' });
});

function base(overrides = {}) {
  return {
    origem: 'painel',
    clienteNome: 'Cliente Teste',
    clienteTelefone: '',
    barbeiroId: barbeiro,
    servicoId: servico,
    data: DATA,
    inicio: '10:00',
    ...overrides,
  };
}

test('público: telefone é obrigatório, com 10-11 dígitos', () => {
  const semTelefone = criarAgendamento(base({ origem: 'publico', clienteTelefone: '' }));
  assert.equal(semTelefone.ok, false);
  assert.equal(semTelefone.status, 400);

  const curto = criarAgendamento(base({ origem: 'publico', clienteTelefone: '4499999' }));
  assert.equal(curto.ok, false);

  const valido = criarAgendamento(base({ origem: 'publico', clienteTelefone: '44999998888' }));
  assert.equal(valido.ok, true);
});

test('painel: telefone é opcional, mas validado quando informado', () => {
  const semTelefone = criarAgendamento(base({ clienteTelefone: '' }));
  assert.equal(semTelefone.ok, true);

  const telefoneRuim = criarAgendamento(base({ clienteTelefone: '123', inicio: '11:00' }));
  assert.equal(telefoneRuim.ok, false);
  assert.equal(telefoneRuim.status, 400);
});

test('público: status inicial segue confirmacao_automatica', () => {
  salvarConfig({ confirmacao_automatica: '0' });
  const resultado = criarAgendamento(base({ origem: 'publico', clienteTelefone: '44999998888' }));
  assert.equal(resultado.ok, true);
  assert.equal(resultado.agendamento.status, 'pendente');
});

test('painel: status inicial é sempre confirmado, mesmo com confirmacao_automatica desligada', () => {
  salvarConfig({ confirmacao_automatica: '0' });
  const resultado = criarAgendamento(base());
  assert.equal(resultado.ok, true);
  assert.equal(resultado.agendamento.status, 'confirmado');
});

test('público respeita o expediente — fora do horário aberto é rejeitado', () => {
  const resultado = criarAgendamento(base({ origem: 'publico', clienteTelefone: '44999998888', inicio: '21:00' }));
  assert.equal(resultado.ok, false);
  assert.equal(resultado.status, 409);
});

test('painel permite encaixe fora do expediente', () => {
  const resultado = criarAgendamento(base({ inicio: '21:00' }));
  assert.equal(resultado.ok, true);
});

test('painel nunca encaixa em cima de outro atendimento do mesmo profissional', () => {
  const primeiro = criarAgendamento(base({ clienteNome: 'Primeiro', inicio: '10:00' }));
  assert.equal(primeiro.ok, true);

  const segundo = criarAgendamento(base({ clienteNome: 'Segundo', inicio: '10:15' }));
  assert.equal(segundo.ok, false);
  assert.equal(segundo.status, 409);
});

test('painel nunca encaixa em cima de um bloqueio do profissional', () => {
  conn
    .prepare('INSERT INTO bloqueios (barbeiro_id, data, inicio, fim, motivo) VALUES (?, ?, ?, ?, ?)')
    .run(barbeiro, DATA, '10:00', '11:00', 'Folga');

  const resultado = criarAgendamento(base({ inicio: '10:15' }));
  assert.equal(resultado.ok, false);
  assert.equal(resultado.status, 409);
});

test('rejeita serviço ou barbeiro inexistente (404) e inativo (400)', () => {
  const inexistente = criarAgendamento(base({ barbeiroId: 999_999 }));
  assert.equal(inexistente.ok, false);
  assert.equal(inexistente.status, 404);

  conn.prepare('UPDATE servicos SET ativo = 0 WHERE id = ?').run(servico);
  const inativo = criarAgendamento(base());
  assert.equal(inativo.ok, false);
  assert.equal(inativo.status, 400);
});

test('rejeita quando o profissional não está cadastrado para o serviço', () => {
  conn.exec('DELETE FROM servico_barbeiro');
  const resultado = criarAgendamento(base());
  assert.equal(resultado.ok, false);
  assert.equal(resultado.status, 400);
});

test('rejeita nome de cliente muito curto', () => {
  const resultado = criarAgendamento(base({ clienteNome: 'A' }));
  assert.equal(resultado.ok, false);
  assert.equal(resultado.status, 400);
});

test('agendamento criado tem o snapshot correto de preço e duração do serviço', () => {
  const resultado = criarAgendamento(base());
  assert.equal(resultado.ok, true);
  assert.equal(resultado.agendamento.preco_centavos, 3000);
  assert.equal(resultado.agendamento.duracao_min, 30);
  assert.equal(resultado.agendamento.fim, '10:30');
});
