import { getDb } from './db';

/**
 * Controle de taxa simples baseado no próprio SQLite — sem Redis nem serviço
 * externo. Cada tentativa vira uma linha na tabela `limitador`; a contagem
 * dentro da janela decide se a próxima tentativa passa ou não.
 */

/** Limpa tentativas antigas (mantém a tabela pequena) e conta quantas ainda valem. */
function contarTentativas(chave, janelaMinutos) {
  const conn = getDb();
  // Limpeza leve: nunca guarda mais que um dia de histórico, de qualquer chave.
  conn.prepare("DELETE FROM limitador WHERE criado_em < datetime('now', '-1 day')").run();
  return conn
    .prepare(
      `SELECT COUNT(*) AS n FROM limitador WHERE chave = ? AND criado_em >= datetime('now', ?)`
    )
    .get(chave, `-${janelaMinutos} minutes`).n;
}

/** Registra mais uma tentativa para a chave. */
function registrar(chave) {
  getDb().prepare("INSERT INTO limitador (chave, criado_em) VALUES (?, datetime('now'))").run(chave);
}

/** Apaga as tentativas de uma chave (usado após sucesso, para não deixar "quase bloqueado"). */
export function limparTentativas(chave) {
  getDb().prepare('DELETE FROM limitador WHERE chave = ?').run(chave);
}

/**
 * True se a chave já estourou o limite dentro da janela — a chamada não
 * registra nada sozinha; quem decide se a tentativa "conta" é o chamador
 * (ex.: login só registra falha, não sucesso).
 */
export function limiteAtingido(chave, { janelaMinutos, maximo }) {
  return contarTentativas(chave, janelaMinutos) >= maximo;
}

/** Registra uma tentativa para a chave (chamar depois de checar limiteAtingido). */
export function registrarTentativa(chave) {
  registrar(chave);
}

/** Extrai um identificador best-effort do cliente a partir dos headers da requisição. */
export function obterIp(request) {
  const encaminhado = request.headers.get('x-forwarded-for');
  if (encaminhado) return encaminhado.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'sem-ip';
}
