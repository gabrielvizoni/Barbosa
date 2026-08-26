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

/**
 * Circuito de emergência para o login: se o total de falhas (somando todo
 * mundo) passar do limite dentro da janela, bloqueia QUALQUER tentativa de
 * login pelos próximos `bloqueioSegundos` — rede de segurança contra quem
 * rotaciona IP pra escapar do limite por chave. Só existe um usuário
 * administrativo, então travar o login geral por alguns segundos não afeta
 * ninguém legítimo. Enquanto as falhas continuarem acontecendo dentro da
 * janela, cada uma re-arma outros `bloqueioSegundos` de bloqueio.
 */
export function limiteGlobalAtingido(chave, { janelaMinutos, maximo, bloqueioSegundos }) {
  if (contarTentativas(chave, janelaMinutos) < maximo) return false;
  const recente = getDb()
    .prepare(`SELECT 1 FROM limitador WHERE chave = ? AND criado_em >= datetime('now', ?) LIMIT 1`)
    .get(chave, `-${bloqueioSegundos} seconds`);
  return Boolean(recente);
}

/**
 * Extrai um identificador best-effort do cliente a partir dos headers da
 * requisição. X-Forwarded-For/X-Real-IP são enviados pelo próprio cliente —
 * só podem ser confiados quando existe um proxy reverso na frente
 * reescrevendo esses headers (TRUST_PROXY=1). Sem isso, o Request padrão do
 * Next não expõe o IP real da conexão em self-hosting; nesse caso todo mundo
 * cai na mesma chave, e é o limite global (limiteGlobalAtingido) que segura
 * a rotação de IP no login. Em produção, TRUST_PROXY=1 deve estar configurado
 * junto do proxy que termina o HTTPS.
 */
export function obterIp(request) {
  if (process.env.TRUST_PROXY === '1') {
    const encaminhado = request.headers.get('x-forwarded-for');
    if (encaminhado) return encaminhado.split(',')[0].trim();
    const real = request.headers.get('x-real-ip');
    if (real) return real;
  }
  return 'sem-ip';
}
