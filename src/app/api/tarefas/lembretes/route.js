import { exigirSegredoTarefa } from "@/lib/tarefas";
import { comLog } from "@/lib/log";

export const dynamic = "force-dynamic";

// Stub: a varredura de agendamentos confirmados dentro da janela de
// antecedência entra no Epic I (lembretes), que depende deste segredo já
// estar validado.
export const POST = comLog("POST /api/tarefas/lembretes", async (request) => {
  const negado = exigirSegredoTarefa(request);
  if (negado) return negado;

  return Response.json({ ok: true, processados: 0 });
});
