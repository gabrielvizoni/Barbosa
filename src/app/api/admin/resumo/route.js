import { exigirSessao } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { agora } from '@/lib/slots';

export const dynamic = 'force-dynamic';

/** Soma (ou subtrai, com delta negativo) meses a 'AAAA-MM'. */
function somarMeses(mes, delta) {
  const [ano, m] = mes.split('-').map(Number);
  const data = new Date(Date.UTC(ano, m - 1 + delta, 1));
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Mês anterior a 'AAAA-MM'. */
function mesAnterior(mes) {
  return somarMeses(mes, -1);
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

/**
 * Início (inclusive) e fim (exclusivo) de um mês 'AAAA-MM', como datas
 * 'AAAA-MM-DD' — permite filtrar com `data >= ? AND data < ?`, que usa o
 * índice da coluna `data` normalmente (diferente de `substr(data,1,7) = ?`,
 * que obriga uma varredura completa da tabela a cada consulta).
 */
function limitesDoMes(mes) {
  const [ano, m] = mes.split('-').map(Number);
  const fim = new Date(Date.UTC(ano, m, 1));
  const fimStr = `${fim.getUTCFullYear()}-${String(fim.getUTCMonth() + 1).padStart(2, '0')}-01`;
  return [`${mes}-01`, fimStr];
}

/**
 * Separa "realizado" (atendimentos com status concluído — dinheiro que já
 * entrou) de "previsto" (pendente + confirmado — ainda vai acontecer).
 * Cancelado não entra em nenhum dos dois.
 */
function totaisDoMes(conn, mes) {
  const [inicio, fim] = limitesDoMes(mes);

  const realizado = conn
    .prepare(
      `SELECT COUNT(*) AS atendimentos, COALESCE(SUM(preco_centavos), 0) AS faturamento
       FROM agendamentos WHERE data >= ? AND data < ? AND status = 'concluido'`
    )
    .get(inicio, fim);

  const previsto = conn
    .prepare(
      `SELECT COUNT(*) AS atendimentos, COALESCE(SUM(preco_centavos), 0) AS faturamento
       FROM agendamentos WHERE data >= ? AND data < ? AND status IN ('pendente', 'confirmado')`
    )
    .get(inicio, fim);

  const cancelados = conn
    .prepare(`SELECT COUNT(*) AS n FROM agendamentos WHERE data >= ? AND data < ? AND status = 'cancelado'`)
    .get(inicio, fim).n;

  return {
    mes,
    realizado: {
      atendimentos: realizado.atendimentos,
      faturamento: realizado.faturamento,
      ticket: realizado.atendimentos ? Math.round(realizado.faturamento / realizado.atendimentos) : 0,
    },
    previsto: {
      atendimentos: previsto.atendimentos,
      faturamento: previsto.faturamento,
      ticket: previsto.atendimentos ? Math.round(previsto.faturamento / previsto.atendimentos) : 0,
    },
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
         COALESCE(SUM(CASE WHEN status = 'concluido' THEN preco_centavos ELSE 0 END), 0) AS realizado,
         COALESCE(SUM(CASE WHEN status IN ('pendente','confirmado') THEN preco_centavos ELSE 0 END), 0) AS previsto,
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
  function totalDoMes(m) {
    const [inicio, fim] = limitesDoMes(m);
    return conn
      .prepare(
        `SELECT COALESCE(SUM(preco_centavos), 0) AS total FROM agendamentos
         WHERE data >= ? AND data < ? AND status <> 'cancelado'`
      )
      .get(inicio, fim).total;
  }

  const serie = ultimosDozeMeses(mes).map((m) => ({ mes: m, total: totalDoMes(m) }));
  // Mesmos 12 meses, um ano antes — dá pra comparar o mesmo período com o ano anterior.
  const serieAnoAnterior = ultimosDozeMeses(somarMeses(mes, -12)).map((m) => ({
    mes: m,
    total: totalDoMes(m),
  }));

  const [inicioMes, fimMes] = limitesDoMes(mes);

  const porServico = conn
    .prepare(
      `SELECT servico_nome AS nome, COUNT(*) AS quantidade,
              COALESCE(SUM(preco_centavos), 0) AS total
       FROM agendamentos
       WHERE status <> 'cancelado' AND data >= ? AND data < ?
       GROUP BY servico_nome ORDER BY quantidade DESC LIMIT 8`
    )
    .all(inicioMes, fimMes);

  const porBarbeiro = conn
    .prepare(
      `SELECT barbeiro_nome AS nome, COUNT(*) AS quantidade,
              COALESCE(SUM(preco_centavos), 0) AS total
       FROM agendamentos
       WHERE status <> 'cancelado' AND data >= ? AND data < ?
       GROUP BY barbeiro_nome ORDER BY total DESC`
    )
    .all(inicioMes, fimMes);

  const geralRealizado = conn
    .prepare(
      `SELECT COUNT(*) AS atendimentos, COALESCE(SUM(preco_centavos), 0) AS faturamento
       FROM agendamentos WHERE status = 'concluido'`
    )
    .get();

  const geralPrevisto = conn
    .prepare(
      `SELECT COUNT(*) AS atendimentos, COALESCE(SUM(preco_centavos), 0) AS faturamento
       FROM agendamentos WHERE status IN ('pendente', 'confirmado')`
    )
    .get();

  return Response.json({
    hoje: {
      data: hoje,
      total: doDia.total || 0,
      realizado: doDia.realizado || 0,
      previsto: doDia.previsto || 0,
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
      serieAnoAnterior,
      porServico,
      porBarbeiro,
      geral: {
        realizado: {
          atendimentos: geralRealizado.atendimentos,
          faturamento: geralRealizado.faturamento,
          ticket: geralRealizado.atendimentos
            ? Math.round(geralRealizado.faturamento / geralRealizado.atendimentos)
            : 0,
        },
        previsto: {
          atendimentos: geralPrevisto.atendimentos,
          faturamento: geralPrevisto.faturamento,
          ticket: geralPrevisto.atendimentos
            ? Math.round(geralPrevisto.faturamento / geralPrevisto.atendimentos)
            : 0,
        },
      },
    },
  });
}
