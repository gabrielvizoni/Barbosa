import { exigirSessao } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { horariosLivres, paraHora, paraMinutos } from '@/lib/slots';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const negado = exigirSessao();
  if (negado) return negado;

  const params = new URL(request.url).searchParams;
  const busca = (params.get('busca') || '').trim();
  const status = params.get('status') || '';
  const barbeiro = params.get('barbeiro') || '';
  const data = params.get('data') || '';

  const condicoes = [];
  const valores = [];

  if (busca) {
    condicoes.push('(cliente_nome LIKE ? OR cliente_telefone LIKE ?)');
    valores.push(`%${busca}%`, `%${busca.replace(/\D/g, '')}%`);
  }
  if (status) {
    condicoes.push('status = ?');
    valores.push(status);
  }
  if (barbeiro) {
    condicoes.push('barbeiro_id = ?');
    valores.push(Number(barbeiro));
  }
  if (data) {
    condicoes.push('data = ?');
    valores.push(data);
  }

  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
  const itens = getDb()
    .prepare(`SELECT * FROM agendamentos ${where} ORDER BY data DESC, inicio DESC LIMIT 300`)
    .all(...valores);

  return Response.json({ itens });
}

/** Encaixe manual: o cliente ligou ou apareceu na porta. */
export async function POST(request) {
  const negado = exigirSessao();
  if (negado) return negado;

  const corpo = await request.json().catch(() => ({}));
  const conn = getDb();

  const servico = conn.prepare('SELECT * FROM servicos WHERE id = ?').get(Number(corpo.servico_id));
  const barbeiro = conn.prepare('SELECT * FROM barbeiros WHERE id = ?').get(Number(corpo.barbeiro_id));
  const nome = String(corpo.cliente_nome ?? '').trim().slice(0, 80);
  const telefone = String(corpo.cliente_telefone ?? '').replace(/\D/g, '');
  const data = String(corpo.data ?? '');
  const inicio = String(corpo.inicio ?? '');

  if (!servico || !barbeiro) {
    return Response.json({ erro: 'Escolha o serviço e o profissional.' }, { status: 400 });
  }
  if (nome.length < 2) {
    return Response.json({ erro: 'Escreva o nome do cliente.' }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !/^\d{2}:\d{2}$/.test(inicio)) {
    return Response.json({ erro: 'Informe a data e o horário.' }, { status: 400 });
  }

  // No painel o encaixe fora do expediente é permitido, mas nunca em cima de outro atendimento.
  const fim = paraHora(paraMinutos(inicio) + servico.duracao_min);
  const conflito = conn
    .prepare(
      `SELECT cliente_nome, inicio, fim FROM agendamentos
       WHERE data = ? AND barbeiro_id = ? AND status <> 'cancelado'
         AND inicio < ? AND fim > ?`
    )
    .get(data, barbeiro.id, fim, inicio);

  if (conflito) {
    return Response.json(
      {
        erro: `${barbeiro.nome} já atende ${conflito.cliente_nome} das ${conflito.inicio} às ${conflito.fim}.`,
      },
      { status: 409 }
    );
  }

  const resultado = conn
    .prepare(
      `INSERT INTO agendamentos
        (cliente_nome, cliente_telefone, barbeiro_id, servico_id, barbeiro_nome, servico_nome,
         data, inicio, fim, duracao_min, preco_centavos, observacoes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmado')`
    )
    .run(
      nome,
      telefone,
      barbeiro.id,
      servico.id,
      barbeiro.nome,
      servico.nome,
      data,
      inicio,
      fim,
      servico.duracao_min,
      servico.preco_centavos,
      String(corpo.observacoes ?? '').trim().slice(0, 300)
    );

  return Response.json({ id: Number(resultado.lastInsertRowid) }, { status: 201 });
}

/** Horários livres para o encaixe manual — reaproveita a mesma regra do site. */
export async function PUT(request) {
  const negado = exigirSessao();
  if (negado) return negado;

  const corpo = await request.json().catch(() => ({}));
  const servico = getDb()
    .prepare('SELECT duracao_min FROM servicos WHERE id = ?')
    .get(Number(corpo.servico_id));

  if (!servico) return Response.json({ horarios: [] });

  return Response.json({
    horarios: horariosLivres({
      barbeiroId: Number(corpo.barbeiro_id),
      duracaoMin: servico.duracao_min,
      data: String(corpo.data ?? ''),
    }),
  });
}
