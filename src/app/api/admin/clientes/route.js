import { exigirSessao } from "@/lib/auth";
import { listarClientesAdmin } from "@/lib/db";
import { comLog } from "@/lib/log";

export const dynamic = "force-dynamic";

export const GET = comLog("GET /api/admin/clientes", async (request) => {
  const negado = exigirSessao(request);
  if (negado) return negado;

  const busca = new URL(request.url).searchParams.get("busca") || "";
  return Response.json({ itens: listarClientesAdmin({ busca }) });
});
