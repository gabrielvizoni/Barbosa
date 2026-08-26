import path from 'node:path';
import { getDb } from '@/lib/db';
import { diretorioGravavel } from '@/lib/config-ambiente';
import { comLog, registrarErro } from '@/lib/log';

export const dynamic = 'force-dynamic';

const ROTA = 'GET /api/health';

// Pública e sem dado sensível de propósito — só o suficiente para um monitor
// externo (UptimeRobot etc.) saber se o site está de pé.
export const GET = comLog(ROTA, async () => {
  const problemas = [];

  try {
    getDb().prepare('SELECT 1').get();
  } catch (erroOriginal) {
    registrarErro(ROTA, 'banco indisponível', erroOriginal);
    problemas.push('banco');
  }

  if (!diretorioGravavel(path.join(process.cwd(), 'public', 'uploads'))) {
    problemas.push('uploads');
  }

  if (problemas.length > 0) {
    return Response.json({ ok: false }, { status: 503 });
  }
  return Response.json({ ok: true });
});
