import { getDb } from '@/lib/db';
import { horariosLivres } from '@/lib/slots';
import { comLog } from '@/lib/log';

export const dynamic = 'force-dynamic';

export const GET = comLog('GET /api/horarios', async (request) => {
  const params = new URL(request.url).searchParams;
  const barbeiroId = Number(params.get('barbeiro'));
  const servicoId = Number(params.get('servico'));
  const data = params.get('data') || '';

  if (!barbeiroId || !servicoId || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return Response.json({ erro: 'Informe barbeiro, serviço e data.' }, { status: 400 });
  }

  const servico = getDb()
    .prepare('SELECT duracao_min FROM servicos WHERE id = ? AND ativo = 1')
    .get(servicoId);

  if (!servico) {
    return Response.json({ erro: 'Serviço indisponível.' }, { status: 404 });
  }

  return Response.json({
    horarios: horariosLivres({ barbeiroId, duracaoMin: servico.duracao_min, data }),
  });
});
