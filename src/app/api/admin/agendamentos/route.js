import { exigirSessao } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { horariosLivres } from '@/lib/slots';
import { criarAgendamento } from '@/lib/agendamentos';
import { lerCorpoJson } from '@/lib/requisicao';
import { comLog, registrarInfo } from '@/lib/log';

export const dynamic = 'force-dynamic';

const TAMANHO_PAGINA = 100;

export const GET = comLog('GET /api/admin/agendamentos', async (request) => {
  const negado = exigirSessao(request);
  if (negado) return negado;

  const params = new URL(request.url).searchParams;
  const busca = (params.get('busca') || '').trim();
  const status = params.get('status') || '';
  const barbeiro = params.get('barbeiro') || '';
  const data = params.get('data') || '';
  const pagina = Math.max(0, Number(params.get('pagina')) || 0);

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
  const conn = getDb();

  const total = conn.prepare(`SELECT COUNT(*) AS n FROM agendamentos ${where}`).get(...valores).n;
  const itens = conn
    .prepare(
      `SELECT * FROM agendamentos ${where} ORDER BY data DESC, inicio DESC LIMIT ? OFFSET ?`
    )
    .all(...valores, TAMANHO_PAGINA, pagina * TAMANHO_PAGINA);

  return Response.json({ itens, total, pagina, tamanhoPagina: TAMANHO_PAGINA });
});

/** Encaixe manual: o cliente ligou ou apareceu na porta. */
export const POST = comLog('POST /api/admin/agendamentos', async (request) => {
  const negado = exigirSessao(request);
  if (negado) return negado;

  const corpo = await lerCorpoJson(request);
  if (!corpo) {
    return Response.json({ erro: 'JSON inválido.' }, { status: 400 });
  }

  const resultado = criarAgendamento({
    origem: 'painel',
    clienteNome: corpo.cliente_nome,
    clienteTelefone: corpo.cliente_telefone,
    barbeiroId: Number(corpo.barbeiro_id),
    servicoId: Number(corpo.servico_id),
    data: String(corpo.data ?? ''),
    inicio: String(corpo.inicio ?? ''),
    observacoes: corpo.observacoes,
  });

  if (!resultado.ok) {
    return Response.json({ erro: resultado.erro }, { status: resultado.status });
  }

  registrarInfo('POST /api/admin/agendamentos', 'agendamento criado (encaixe)', {
    agendamentoId: resultado.id,
  });

  return Response.json({ id: resultado.id }, { status: 201 });
});

/** Horários livres para o encaixe manual — reaproveita a mesma regra do site. */
export const PUT = comLog('PUT /api/admin/agendamentos', async (request) => {
  const negado = exigirSessao(request);
  if (negado) return negado;

  const corpo = await lerCorpoJson(request);
  if (!corpo) {
    return Response.json({ erro: 'JSON inválido.' }, { status: 400 });
  }
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
});
