import { encerrarSessao } from '@/lib/auth';
import { comLog } from '@/lib/log';

export const dynamic = 'force-dynamic';

export const POST = comLog('POST /api/admin/logout', async () => {
  encerrarSessao();
  return Response.json({ ok: true });
});
