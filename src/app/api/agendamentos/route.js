import { getDb, lerConfig } from '@/lib/db';
import { horariosLivres, paraHora, paraMinutos } from '@/lib/slots';

export const dynamic = 'force-dynamic';

function limpar(texto, limite) {
  return String(texto ?? '').trim().slice(0, limite);
}

export async function POST(request) {
  let corpo;
  try {
    corpo = await request.json();
  } catch {
    return Response.json({ erro: 'Não consegui ler os dados enviados.' }, { status: 400 });
  }

  const nome = limpar(corpo.cliente_nome, 80);
  const telefoneDigitos = String(corpo.cliente_telefone ?? '').replace(/\D/g, '');
  const barbeiroId = Number(corpo.barbeiro_id);
  const servicoId = Number(corpo.servico_id);
  const data = String(corpo.data ?? '');
  const inicio = String(corpo.inicio ?? '');
  const observacoes = limpar(corpo.observacoes, 300);

  if (nome.length < 2) {
    return Response.json({ erro: 'Escreva seu nome completo.' }, { status: 400 });
  }
  if (telefoneDigitos.length < 10 || telefoneDigitos.length > 11) {
    return Response.json({ erro: 'Informe um WhatsApp com DDD.' }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !/^\d{2}:\d{2}$/.test(inicio)) {
    return Response.json({ erro: 'Escolha uma data e um horário.' }, { status: 400 });
  }

  const conn = getDb();
  const servico = conn
    .prepare('SELECT * FROM servicos WHERE id = ? AND ativo = 1')
    .get(servicoId);
  const barbeiro = conn
    .prepare('SELECT * FROM barbeiros WHERE id = ? AND ativo = 1')
    .get(barbeiroId);

  if (!servico || !barbeiro) {
    return Response.json({ erro: 'Serviço ou profissional indisponível.' }, { status: 404 });
  }

  const atende = conn
    .prepare('SELECT 1 FROM servico_barbeiro WHERE servico_id = ? AND barbeiro_id = ?')
    .get(servicoId, barbeiroId);
  if (!atende) {
    return Response.json(
      { erro: `${barbeiro.nome} não atende ${servico.nome}.` },
      { status: 400 }
    );
  }

  // Confere de novo contra o banco: entre a escolha e o envio, alguém pode ter pegado o horário.
  const livres = horariosLivres({ barbeiroId, duracaoMin: servico.duracao_min, data });
  if (!livres.includes(inicio)) {
    return Response.json(
      { erro: 'Esse horário acabou de ser ocupado. Escolha outro, por favor.' },
      { status: 409 }
    );
  }

  const config = lerConfig();
  const fim = paraHora(paraMinutos(inicio) + servico.duracao_min);
  const status = config.confirmacao_automatica === '1' ? 'confirmado' : 'pendente';

  const resultado = conn
    .prepare(
      `INSERT INTO agendamentos
        (cliente_nome, cliente_telefone, barbeiro_id, servico_id, barbeiro_nome, servico_nome,
         data, inicio, fim, duracao_min, preco_centavos, observacoes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      nome,
      telefoneDigitos,
      barbeiroId,
      servicoId,
      barbeiro.nome,
      servico.nome,
      data,
      inicio,
      fim,
      servico.duracao_min,
      servico.preco_centavos,
      observacoes,
      status
    );

  return Response.json({
    agendamento: {
      id: resultado.lastInsertRowid,
      cliente: nome,
      telefone: telefoneDigitos,
      barbeiro: barbeiro.nome,
      servico: servico.nome,
      data,
      inicio,
      fim,
      duracao_min: servico.duracao_min,
      preco_centavos: servico.preco_centavos,
      observacoes,
      status,
      barbearia: config.nome_barbearia,
    },
    whatsapp_barbearia: config.whatsapp,
  });
}
