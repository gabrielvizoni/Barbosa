import {
  atualizarDadosCliente,
  exigirSessaoCliente,
  sessaoClienteAtual,
  trocarEmailCliente,
} from "@/lib/cliente-auth";
import { buscarClientePorId } from "@/lib/db";
import { lerCorpoJson } from "@/lib/requisicao";
import { comLog } from "@/lib/log";

export const dynamic = "force-dynamic";

export const GET = comLog("GET /api/conta/perfil", async (request) => {
  const negado = exigirSessaoCliente(request);
  if (negado) return negado;

  const { clienteId } = sessaoClienteAtual();
  const cliente = buscarClientePorId(clienteId);
  return Response.json({
    nome: cliente.nome,
    telefone: cliente.telefone,
    email: cliente.email,
  });
});

/**
 * Atualiza os dados cadastrais. Nome e telefone entram direto; trocar o
 * e-mail exige a senha atual (uma sessão sequestrada não redireciona a
 * recuperação de senha para um e-mail do atacante). Mudanças de senha vão
 * pelo endpoint próprio (POST /api/conta/perfil/senha).
 */
export const PATCH = comLog("PATCH /api/conta/perfil", async (request) => {
  const negado = exigirSessaoCliente(request);
  if (negado) return negado;

  const { clienteId } = sessaoClienteAtual();
  const corpo = await lerCorpoJson(request);
  if (!corpo) {
    return Response.json({ erro: "JSON inválido." }, { status: 400 });
  }

  const cliente = buscarClientePorId(clienteId);
  const novoEmail = String(corpo.email ?? "")
    .trim()
    .toLowerCase();
  const mudouEmail = novoEmail && novoEmail !== cliente.email.toLowerCase();

  if (mudouEmail) {
    const r = await trocarEmailCliente(clienteId, corpo.senhaAtual, novoEmail);
    if (!r.ok) return Response.json({ erro: r.erro }, { status: 400 });
  }

  if (corpo.nome !== undefined || corpo.telefone !== undefined) {
    const r = atualizarDadosCliente(clienteId, {
      nome: corpo.nome,
      telefone: corpo.telefone,
    });
    if (!r.ok) return Response.json({ erro: r.erro }, { status: 400 });
  }

  const atual = buscarClientePorId(clienteId);
  return Response.json({
    ok: true,
    nome: atual.nome,
    telefone: atual.telefone,
    email: atual.email,
  });
});
