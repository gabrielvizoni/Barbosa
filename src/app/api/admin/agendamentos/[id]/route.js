import { exigirSessao } from '@/lib/auth';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

const STATUS_VALIDOS = ['pendente', 'confirmado', 'concluido', 'cancelado'];

export async function PATCH(request, { params }) {
  const negado = exigirSessao(request);
  if (negado) return negado;

  const id = Number(params.id);
  if (!id) {
    return Response.json({ erro: 'Agendamento não encontrado.' }, { status: 404 });
  }

  const corpo = await request.json().catch(() => ({}));
  if (!STATUS_VALIDOS.includes(corpo.status)) {
    return Response.json({ erro: 'Status inválido.' }, { status: 400 });
  }

  const resultado = getDb().prepare('UPDATE agendamentos SET status = ? WHERE id = ?').run(corpo.status, id);
  if (resultado.changes === 0) {
    return Response.json({ erro: 'Agendamento não encontrado.' }, { status: 404 });
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
