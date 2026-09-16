import { exigirSegredoTarefa } from "@/lib/tarefas";
import { comLog } from "@/lib/log";

export const dynamic = "force-dynamic";

// Stub: a marcação automática de no-show entra no Epic C, que depende deste
// segredo já estar validado.
export const POST = comLog(
  "POST /api/tarefas/marcar-no-show",
  async (request) => {
    const negado = exigirSegredoTarefa(request);
    if (negado) return negado;

    return Response.json({ ok: true, processados: 0 });
  },
);
