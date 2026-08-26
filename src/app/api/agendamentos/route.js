import { lerConfig } from '@/lib/db';
import { criarAgendamento } from '@/lib/agendamentos';
import { limiteAtingido, obterIp, registrarTentativa } from '@/lib/limitador';
import { lerCorpoJson } from '@/lib/requisicao';
import { comLog, registrarAviso, registrarInfo } from '@/lib/log';

export const dynamic = 'force-dynamic';

const ROTA = 'POST /api/agendamentos';

// Generoso o bastante para um cliente normal (que no máximo tenta de novo
// depois de um horário ocupado), mas barra um script tentando lotar a agenda.
const JANELA_MINUTOS = 10;
const MAXIMO_TENTATIVAS = 6;

export const POST = comLog(ROTA, async (request) => {
  const chave = `agendar:${obterIp(request)}`;
  if (limiteAtingido(chave, { janelaMinutos: JANELA_MINUTOS, maximo: MAXIMO_TENTATIVAS })) {
    registrarAviso(ROTA, 'bloqueado por limite de tentativas');
    return Response.json(
      { erro: 'Muitos agendamentos em pouco tempo. Aguarde alguns minutos e tente de novo.' },
      { status: 429 }
    );
  }
  registrarTentativa(chave);

  const corpo = await lerCorpoJson(request);
  if (!corpo) {
    return Response.json({ erro: 'Não consegui ler os dados enviados.' }, { status: 400 });
  }

  const resultado = criarAgendamento({
    origem: 'publico',
    clienteNome: corpo.cliente_nome,
    clienteTelefone: corpo.cliente_telefone,
    barbeiroId: Number(corpo.barbeiro_id),
    servicoId: Number(corpo.servico_id),
    data: String(corpo.data ?? ''),
    inicio: String(corpo.inicio ?? ''),
  });

  if (!resultado.ok) {
    return Response.json({ erro: resultado.erro }, { status: resultado.status });
  }

  registrarInfo(ROTA, 'agendamento criado', { agendamentoId: resultado.id });

  const config = lerConfig();
  return Response.json({
    agendamento: { ...resultado.agendamento, barbearia: config.nome_barbearia },
    whatsapp_barbearia: config.whatsapp,
  });
});
