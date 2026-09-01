import { encerrarSessaoCliente } from "@/lib/cliente-auth";
import { comLog } from "@/lib/log";

export const dynamic = "force-dynamic";

export const POST = comLog("POST /api/conta/logout", async () => {
  encerrarSessaoCliente();
  return Response.json({ ok: true });
});
