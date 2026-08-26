import { exigirSessao } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { mudarStatusAgendamento, remarcarAgendamento } from '@/lib/agendamentos';
import { lerCorpoJson } from '@/lib/requisicao';
import { comLog, registrarInfo } from '@/lib/log';

export const dynamic = 'force-dynamic';

const ROTA_PATCH = 'PATCH /api/admin/agendamentos/[id]';

/**
 * Um único endereço para as duas mutações que um agendamento aceita depois
 * de criado: mudar de status (envia `status`) ou remarcar (envia `data`,
 * `inicio`, `barbeiro_id` e/ou `servico_id`) — cada uma reaproveita a
 * validação e a transação correspondente em src/lib/agendamentos.js.
 */
export const PATCH = comLog(ROTA_PATCH, async (request, { params }) => {
  const negado = exigirSessao(request);
  if (negado) return negado;

  const id = Number(params.id);
  if (!id) {
    return Response.json({ erro: 'Agendamento não encontrado.' }, { status: 404 });
  }

  const corpo = await lerCorpoJson(request);
  if (!corpo) {
    return Response.json({ erro: 'JSON inválido.' }, { status: 400 });
  }

  let resultado;
  let msgLog;
  if (corpo.status !== undefined) {
    resultado = mudarStatusAgendamento(id, corpo.status);
    msgLog = `status do agendamento mudou para "${corpo.status}"`;
  } else if (
    corpo.data !== undefined ||
    corpo.inicio !== undefined ||
    corpo.barbeiro_id !== undefined ||
    corpo.servico_id !== undefined
  ) {
    resultado = remarcarAgendamento(id, {
      data: corpo.data,
      inicio: corpo.inicio,
      barbeiroId: corpo.barbeiro_id,
      servicoId: corpo.servico_id,
    });
    msgLog = 'agendamento remarcado';
  } else {
    return Response.json({ erro: 'Nada para atualizar.' }, { status: 400 });
  }

  if (!resultado.ok) {
    return Response.json({ erro: resultado.erro }, { status: resultado.status });
  }

  registrarInfo(ROTA_PATCH, msgLog, { agendamentoId: id });
  return Response.json({ ok: true });
});

export const DELETE = comLog('DELETE /api/admin/agendamentos/[id]', async (request, { params }) => {
  const negado = exigirSessao(request);
  if (negado) return negado;

  const id = Number(params.id);
  if (!id) {
    return Response.json({ erro: 'Agendamento não encontrado.' }, { status: 404 });
  }

  const resultado = getDb().prepare('DELETE FROM agendamentos WHERE id = ?').run(id);
  if (resultado.changes === 0) {
    return Response.json({ erro: 'Agendamento não encontrado.' }, { status: 404 });
  }

  registrarInfo('DELETE /api/admin/agendamentos/[id]', 'agendamento excluído', {
    agendamentoId: id,
  });
  return Response.json({ ok: true });
});
