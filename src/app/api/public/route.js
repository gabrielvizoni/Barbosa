import { lerConfig, listarBarbeiros, listarServicos } from '@/lib/db';
import { diasDisponiveis, FUSO } from '@/lib/slots';
import { comLog } from '@/lib/log';

export const dynamic = 'force-dynamic';

const ROTA = 'GET /api/public';

/** Tudo que o fluxo de agendamento precisa, em uma requisição só. */
export const GET = comLog(ROTA, async () => {
  const config = lerConfig();
  const barbeiros = listarBarbeiros({ somenteAtivos: true });
  const servicos = listarServicos({ somenteAtivos: true }).filter(
    (s) => s.barbeiros.length > 0
  );

  return Response.json({
    fuso: FUSO,
    barbearia: {
      nome: config.nome_barbearia,
      whatsapp: config.whatsapp,
      endereco: config.endereco,
    },
    servicos: servicos.map((s) => ({
      id: s.id,
      nome: s.nome,
      descricao: s.descricao,
      categoria: s.categoria,
      preco_centavos: s.preco_centavos,
      duracao_min: s.duracao_min,
      barbeiros: s.barbeiros,
    })),
    barbeiros: barbeiros.map((b) => ({
      id: b.id,
      nome: b.nome,
      funcao: b.funcao,
      bio: b.bio,
      foto: b.foto,
    })),
    dias: diasDisponiveis(Number(config.dias_futuros) || 30),
  });
});
