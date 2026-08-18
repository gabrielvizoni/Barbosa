import { exigirSessao } from '@/lib/auth';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

const STATUS_VALIDOS = ['pendente', 'confirmado', 'concluido', 'cancelado'];

export async function PATCH(request, { params }) {
  const negado = exigirSessao();
  if (negado) return negado;

  const id = Number(params.id);
  const corpo = await request.json().catch(() => ({}));

  if (!STATUS_VALIDOS.includes(corpo.status)) {
    return Response.json({ erro: 'Status inválido.' }, { status: 400 });
  }

  getDb().prepare('UPDATE agendamentos SET status = ? WHERE id = ?').run(corpo.status, id);
  return Response.json({ ok: true });
}

export async function DELETE(_request, { params }) {
  const negado = exigirSessao();
  if (negado) return negado;

  getDb().prepare('DELETE FROM agendamentos WHERE id = ?').run(Number(params.id));
  return Response.json({ ok: true });
}
