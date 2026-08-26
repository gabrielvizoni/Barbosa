import { autenticacaoConfiguradaComSeguranca, sessaoValida, usandoSenhaInicial } from '@/lib/auth';
import { comLog } from '@/lib/log';

export const dynamic = 'force-dynamic';

export const GET = comLog('GET /api/admin/sessao', async () => {
  if (!autenticacaoConfiguradaComSeguranca()) {
    return Response.json({ autenticado: false, configuracaoInsegura: true });
  }
  const autenticado = sessaoValida();
  return Response.json({
    autenticado,
    senhaInicial: autenticado ? usandoSenhaInicial() : false,
  });
});
