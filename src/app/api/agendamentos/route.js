import { lerConfig } from '@/lib/db';
import { criarAgendamento } from '@/lib/agendamentos';
import { limiteAtingido, obterIp, registrarTentativa } from '@/lib/limitador';

export const dynamic = 'force-dynamic';

// Generoso o bastante para um cliente normal (que no máximo tenta de novo
// depois de um horário ocupado), mas barra um script tentando lotar a agenda.
const JANELA_MINUTOS = 10;
const MAXIMO_TENTATIVAS = 6;

export async function POST(request) {
  const chave = `agendar:${obterIp(request)}`;
  if (limiteAtingido(chave, { janelaMinutos: JANELA_MINUTOS, maximo: MAXIMO_TENTATIVAS })) {
    return Response.json(
      { erro: 'Muitos agendamentos em pouco tempo. Aguarde alguns minutos e tente de novo.' },
      { status: 429 }
    );
  }
  registrarTentativa(chave);

  let corpo;
  try {
    corpo = await request.json();
  } catch {
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

  const config = lerConfig();
  return Response.json({
    agendamento: { ...resultado.agendamento, barbearia: config.nome_barbearia },
    whatsapp_barbearia: config.whatsapp,
  });
}
