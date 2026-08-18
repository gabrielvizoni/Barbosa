import { exigirSessao } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { agora } from '@/lib/slots';

export const dynamic = 'force-dynamic';

/** Mês anterior a 'AAAA-MM'. */
function mesAnterior(mes) {
  const [ano, m] = mes.split('-').map(Number);
  const data = new Date(Date.UTC(ano, m - 2, 1));
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Os últimos 12 meses terminando em 'AAAA-MM'. */
function ultimosDozeMeses(mes) {
  const [ano, m] = mes.split('-').map(Number);
  const lista = [];
  for (let i = 11; i >= 0; i -= 1) {
    const data = new Date(Date.UTC(ano, m - 1 - i, 1));
    lista.push(`${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return lista;
}

function totaisDoMes(conn, mes) {
  const linha = conn
    .prepare(
      `SELECT
         COUNT(*) AS atendimentos,
         COALESCE(SUM(preco_centavos), 0) AS faturamento
       FROM agendamentos
       WHERE substr(data, 1, 7) = ? AND status <> 'cancelado'`
    )
    .get(mes);

  const cancelados = conn
    .prepare(
      `SELECT COUNT(*) AS n FROM agendamentos
       WHERE substr(data, 1, 7) = ? AND status = 'cancelado'`
    )
    .get(mes).n;

  return {
    mes,
    atendimentos: linha.atendimentos,
    faturamento: linha.faturamento,
    ticket: linha.atendimentos ? Math.round(linha.faturamento / linha.atendimentos) : 0,
    cancelados,
  };
}

export async function GET(request) {
  const negado = exigirSessao();
  if (negado) return negado;

  const conn = getDb();
  const params = new URL(request.url).searchParams;
  const hoje = agora().data;
  const mes = /^\d{4}-\d{2}$/.test(params.get('mes') || '') ? params.get('mes') : hoje.slice(0, 7);
  const comparar = /^\d{4}-\d{2}$/.test(params.get('comparar') || '')
    ? params.get('comparar')
    : mesAnterior(mes);

  // --- Visão geral: o dia de hoje ---
  const doDia = conn
    .prepare(
      `SELECT
         COUNT(*) AS total,
         COALESCE(SUM(CASE WHEN status <> 'cancelado' THEN preco_centavos ELSE 0 END), 0) AS faturamento,
         SUM(CASE WHEN status = 'confirmado' THEN 1 ELSE 0 END) AS confirmados,
         SUM(CASE WHEN status = 'pendente' THEN 1 ELSE 0 END) AS pendentes
       FROM agendamentos WHERE data = ?`
    )
    .get(hoje);

  const agendaHoje = conn
    .prepare(
      `SELECT b.id, b.nome, b.foto,
              COUNT(a.id) AS atendimentos,
              MIN(a.inicio) AS primeiro,
              MAX(a.fim) AS ultimo
       FROM barbeiros b
       LEFT JOIN agendamentos a
         ON a.barbeiro_id = b.id AND a.data = ? AND a.status <> 'cancelado'
       WHERE b.ativo = 1
       GROUP BY b.id ORDER BY b.ordem, b.id`
    )
    .all(hoje);

  const recentes = conn
    .prepare('SELECT * FROM agendamentos ORDER BY criado_em DESC, id DESC LIMIT 8')
    .all();

  const pendentesTotal = conn
    .prepare("SELECT COUNT(*) AS n FROM agendamentos WHERE status = 'pendente'")
    .get().n;

  // --- Financeiro ---
  const serie = ultimosDozeMeses(mes).map((m) => {
    const linha = conn
      .prepare(
        `SELECT COALESCE(SUM(preco_centavos), 0) AS total FROM agendamentos
         WHERE substr(data, 1, 7) = ? AND status <> 'cancelado'`
      )
      .get(m);
    return { mes: m, total: linha.total };
  });

  const porServico = conn
    .prepare(
      `SELECT servico_nome AS nome, COUNT(*) AS quantidade,
              COALESCE(SUM(preco_centavos), 0) AS total
       FROM agendamentos
       WHERE status <> 'cancelado' AND substr(data, 1, 7) = ?
       GROUP BY servico_nome ORDER BY quantidade DESC LIMIT 8`
    )
    .all(mes);

  const porBarbeiro = conn
    .prepare(
      `SELECT barbeiro_nome AS nome, COUNT(*) AS quantidade,
              COALESCE(SUM(preco_centavos), 0) AS total
       FROM agendamentos
       WHERE status <> 'cancelado' AND substr(data, 1, 7) = ?
       GROUP BY barbeiro_nome ORDER BY total DESC`
    )
    .all(mes);

  const geral = conn
    .prepare(
      `SELECT COUNT(*) AS atendimentos, COALESCE(SUM(preco_centavos), 0) AS faturamento
       FROM agendamentos WHERE status <> 'cancelado'`
    )
    .get();

  return Response.json({
    hoje: {
      data: hoje,
      total: doDia.total || 0,
      faturamento: doDia.faturamento || 0,
      confirmados: doDia.confirmados || 0,
      pendentes: doDia.pendentes || 0,
      agenda: agendaHoje,
      recentes,
    },
    pendentesTotal,
    financeiro: {
      principal: totaisDoMes(conn, mes),
      comparacao: totaisDoMes(conn, comparar),
      serie,
      porServico,
      porBarbeiro,
      geral: {
        ...geral,
        ticket: geral.atendimentos ? Math.round(geral.faturamento / geral.atendimentos) : 0,
      },
    },
  });
}
