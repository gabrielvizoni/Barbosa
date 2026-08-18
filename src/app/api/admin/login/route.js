import { criarSessao, senhaConfere } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const { senha } = await request.json().catch(() => ({}));
  if (!senhaConfere(senha)) {
    return Response.json({ erro: 'Senha incorreta.' }, { status: 401 });
  }
  criarSessao();
  return Response.json({ ok: true });
}
