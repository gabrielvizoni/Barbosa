import { sessaoConfiguradaComSeguranca, sessaoValida, usandoSenhaInicial } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!sessaoConfiguradaComSeguranca()) {
    return Response.json({ autenticado: false, configuracaoInsegura: true });
  }
  const autenticado = sessaoValida();
  return Response.json({
    autenticado,
    senhaInicial: autenticado ? usandoSenhaInicial() : false,
  });
}
