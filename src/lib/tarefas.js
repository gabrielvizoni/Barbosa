// Autenticação das rotinas periódicas (POST /api/tarefas/*). Elas são
// chamadas por um agendador externo (cron do provedor de hospedagem ou
// serviço de terceiros) — não por uma sessão de usuário — e por isso usam um
// segredo compartilhado em header, não cookie (RNF-22, RF-107).
import { iguais } from "./auth.js";

const CABECALHO_SEGREDO = "x-tarefa-segredo";

/**
 * Devolve `null` quando o header `X-Tarefa-Segredo` bate com
 * `process.env.TAREFA_SEGREDO`, ou uma `Response` 401 quando não. Sem
 * `TAREFA_SEGREDO` configurado, toda chamada é recusada — nunca autoriza por
 * acidente com dois valores vazios.
 */
export function exigirSegredoTarefa(request) {
  const esperado = process.env.TAREFA_SEGREDO || "";
  const enviado = request.headers.get(CABECALHO_SEGREDO) || "";
  if (!esperado || !enviado || !iguais(enviado, esperado)) {
    return Response.json({ erro: "Segredo inválido." }, { status: 401 });
  }
  return null;
}
