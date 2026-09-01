import { exigirSessao } from "@/lib/auth";
import { fichaClienteAdmin } from "@/lib/db";
import { comLog } from "@/lib/log";

export const dynamic = "force-dynamic";

export const GET = comLog(
  "GET /api/admin/clientes/[id]",
  async (request, { params }) => {
    const negado = exigirSessao(request);
    if (negado) return negado;

    const id = Number(params.id);
    const ficha = id ? fichaClienteAdmin(id) : null;
    if (!ficha) {
      return Response.json(
        { erro: "Cliente não encontrado." },
        { status: 404 },
      );
    }
    return Response.json(ficha);
  },
);
