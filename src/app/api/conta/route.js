import {
  encerrarSessaoCliente,
  exigirSessaoCliente,
  sessaoClienteAtual,
} from "@/lib/cliente-auth";
import { anonimizarCliente } from "@/lib/db";
import { comLog, registrarInfo } from "@/lib/log";

export const dynamic = "force-dynamic";

/**
 * Exclusão da conta a pedido do cliente (RF-19 / RN-44). Anonimiza a conta
 * e o retrato (nome/telefone) nos agendamentos daquele cliente; o histórico
 * financeiro fica preservado. Encerra a sessão.
 */
export const DELETE = comLog("DELETE /api/conta", async (request) => {
  const negado = exigirSessaoCliente(request);
  if (negado) return negado;

  const { clienteId } = sessaoClienteAtual();
  anonimizarCliente(clienteId);
  encerrarSessaoCliente();
  registrarInfo("DELETE /api/conta", "conta de cliente anonimizada");
  return Response.json({ ok: true });
});
