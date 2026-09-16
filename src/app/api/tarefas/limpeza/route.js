import { exigirSegredoTarefa } from "@/lib/tarefas";
import { comLog } from "@/lib/log";

export const dynamic = "force-dynamic";

// Stub: a limpeza periódica (ex.: tabela `limitador`, tokens de reset
// expirados) ainda não tem uma rotina própria definida em nenhum epic — este
// endpoint só reserva o lugar e a autenticação por segredo.
export const POST = comLog("POST /api/tarefas/limpeza", async (request) => {
  const negado = exigirSegredoTarefa(request);
  if (negado) return negado;

  return Response.json({ ok: true, processados: 0 });
});
