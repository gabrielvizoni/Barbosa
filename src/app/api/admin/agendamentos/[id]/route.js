import { exigirSessao } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { mudarStatusAgendamento, remarcarAgendamento } from '@/lib/agendamentos';

export const dynamic = 'force-dynamic';

/**
 * Um único endereço para as duas mutações que um agendamento aceita depois
 * de criado: mudar de status (envia `status`) ou remarcar (envia `data`,
 * `inicio`, `barbeiro_id` e/ou `servico_id`) — cada uma reaproveita a
 * validação e a transação correspondente em src/lib/agendamentos.js.
 */
export async function PATCH(request, { params }) {
  const negado = exigirSessao(request);
  if (negado) return negado;

  const id = Number(params.id);
  if (!id) {
    return Response.json({ erro: 'Agendamento não encontrado.' }, { status: 404 });
  }

  const corpo = await request.json().catch(() => ({}));

  let resultado;
  if (corpo.status !== undefined) {
    resultado = mudarStatusAgendamento(id, corpo.status);
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
  } else {
    return Response.json({ erro: 'Nada para atualizar.' }, { status: 400 });
  }

  if (!resultado.ok) {
    return Response.json({ erro: resultado.erro }, { status: resultado.status });
  }
  return Response.json({ ok: true });
}

export async function DELETE(request, { params }) {
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

  return Response.json({ ok: true });
}
