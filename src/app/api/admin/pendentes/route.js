import { exigirSessao } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { comLog } from "@/lib/log";

export const dynamic = "force-dynamic";

/** Contador do badge de pendentes no menu — uma query só, sem o custo do resumo inteiro. */
export const GET = comLog("GET /api/admin/pendentes", async (request) => {
  const negado = exigirSessao(request);
  if (negado) return negado;

  const total = getDb()
    .prepare(
      "SELECT COUNT(*) AS n FROM agendamentos WHERE status = 'pendente' AND excluido_em IS NULL",
    )
    .get().n;

  return Response.json({ total });
});
