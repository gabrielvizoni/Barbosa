// Criação de agendamento, unificada entre os dois fluxos que existiam
// duplicados com regras divergentes: público (cliente marcando pelo site) e
// painel (barbeiro encaixando na régua). As diferenças legítimas entre eles
// viram parâmetros (origem), não código separado.
import { getDb, lerConfig } from './db.js';
import { horariosLivres, paraHora, paraMinutos } from './slots.js';
import { somenteDigitos, telefoneValido } from './format.js';
import { validar } from './validacao.js';

function erro(status, mensagem) {
  return { ok: false, status, erro: mensagem };
}

/**
 * Cria um agendamento. Devolve `{ ok: true, id, agendamento }` ou
 * `{ ok: false, status, erro }` — quem chama decide como isso vira Response.
 *
 * origem: 'publico' | 'painel'
 *   - publico: respeita expediente e antecedência mínima (via horariosLivres);
 *     telefone obrigatório (10–11 dígitos); status inicial segue
 *     confirmacao_automatica.
 *   - painel: permite encaixe fora do expediente, mas nunca sobre outro
 *     atendimento ou bloqueio do mesmo profissional; telefone opcional, mas
 *     validado quando informado; entra sempre como 'confirmado'.
 */
export function criarAgendamento({
  origem,
  clienteNome,
  clienteTelefone,
  barbeiroId,
  servicoId,
  data,
  inicio,
  observacoes = '',
}) {
  const conn = getDb();

  const servico = conn.prepare('SELECT * FROM servicos WHERE id = ?').get(servicoId);
  const barbeiro = conn.prepare('SELECT * FROM barbeiros WHERE id = ?').get(barbeiroId);
  if (!servico || !barbeiro) {
    return erro(404, 'Serviço ou profissional não encontrado.');
  }
  if (!servico.ativo) return erro(400, 'Esse serviço está desativado.');
  if (!barbeiro.ativo) return erro(400, 'Esse profissional está desativado.');

  const atende = conn
    .prepare('SELECT 1 FROM servico_barbeiro WHERE servico_id = ? AND barbeiro_id = ?')
    .get(servico.id, barbeiro.id);
  if (!atende) {
    return erro(400, `${barbeiro.nome} não atende ${servico.nome}.`);
  }

  const nome = String(clienteNome ?? '').trim().slice(0, 80);
  if (nome.length < 2) return erro(400, 'Escreva o nome do cliente.');

  const telefone = somenteDigitos(clienteTelefone);
  if (origem === 'publico' && !telefoneValido(telefone)) {
    return erro(400, 'Informe um WhatsApp com DDD.');
  }
  if (origem === 'painel' && telefone && !telefoneValido(telefone)) {
    return erro(400, 'Telefone inválido — informe DDD + número, ou deixe em branco.');
  }

  const { ok: dataHoraOk } = validar('agendamentos', { data, inicio });
  if (!dataHoraOk) return erro(400, 'Informe a data e o horário.');

  const fim = paraHora(paraMinutos(inicio) + servico.duracao_min);

  if (origem === 'publico') {
    const livres = horariosLivres({ barbeiroId: barbeiro.id, duracaoMin: servico.duracao_min, data });
    if (!livres.includes(inicio)) {
      return erro(409, 'Esse horário acabou de ser ocupado. Escolha outro, por favor.');
    }
  } else {
    // No painel o encaixe fora do expediente é permitido, mas nunca em cima
    // de outro atendimento ou de um bloqueio (folga/ausência) do profissional.
    const conflitoAgendamento = conn
      .prepare(
        `SELECT cliente_nome, inicio, fim FROM agendamentos
         WHERE data = ? AND barbeiro_id = ? AND status <> 'cancelado'
           AND inicio < ? AND fim > ?`
      )
      .get(data, barbeiro.id, fim, inicio);
    if (conflitoAgendamento) {
      return erro(
        409,
        `${barbeiro.nome} já atende ${conflitoAgendamento.cliente_nome} das ${conflitoAgendamento.inicio} às ${conflitoAgendamento.fim}.`
      );
    }

    const conflitoBloqueio = conn
      .prepare(
        `SELECT motivo, inicio, fim FROM bloqueios
         WHERE data = ? AND (barbeiro_id IS NULL OR barbeiro_id = ?)
           AND inicio < ? AND fim > ?`
      )
      .get(data, barbeiro.id, fim, inicio);
    if (conflitoBloqueio) {
      return erro(
        409,
        `${barbeiro.nome} está bloqueado (${conflitoBloqueio.motivo || 'ausência'}) das ${conflitoBloqueio.inicio} às ${conflitoBloqueio.fim}.`
      );
    }
  }

  const status =
    origem === 'publico' ? (lerConfig().confirmacao_automatica === '1' ? 'confirmado' : 'pendente') : 'confirmado';

  const observacoesLimpas = String(observacoes ?? '').trim().slice(0, 300);

  const resultado = conn
    .prepare(
      `INSERT INTO agendamentos
        (cliente_nome, cliente_telefone, barbeiro_id, servico_id, barbeiro_nome, servico_nome,
         data, inicio, fim, duracao_min, preco_centavos, observacoes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      nome,
      telefone,
      barbeiro.id,
      servico.id,
      barbeiro.nome,
      servico.nome,
      data,
      inicio,
      fim,
      servico.duracao_min,
      servico.preco_centavos,
      observacoesLimpas,
      status
    );

  const id = Number(resultado.lastInsertRowid);
  return {
    ok: true,
    id,
    agendamento: {
      id,
      cliente: nome,
      telefone,
      barbeiro: barbeiro.nome,
      servico: servico.nome,
      data,
      inicio,
      fim,
      duracao_min: servico.duracao_min,
      preco_centavos: servico.preco_centavos,
      observacoes: observacoesLimpas,
      status,
    },
  };
}
