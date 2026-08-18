import { encerrarSessao } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST() {
  encerrarSessao();
  return Response.json({ ok: true });
}
