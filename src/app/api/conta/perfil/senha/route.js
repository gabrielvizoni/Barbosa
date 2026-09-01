import {
  exigirSessaoCliente,
  sessaoClienteAtual,
  trocarSenhaCliente,
} from "@/lib/cliente-auth";
import { lerCorpoJson } from "@/lib/requisicao";
import { comLog } from "@/lib/log";

export const dynamic = "force-dynamic";

const MINIMO = 6;

export const POST = comLog("POST /api/conta/perfil/senha", async (request) => {
  const negado = exigirSessaoCliente(request);
  if (negado) return negado;

  const { clienteId } = sessaoClienteAtual();
  const corpo = await lerCorpoJson(request);
  if (!corpo) {
    return Response.json({ erro: "JSON inválido." }, { status: 400 });
  }
  const { senhaAtual, novaSenha, confirmacao } = corpo;

  const nova = String(novaSenha ?? "");
  if (nova.length < MINIMO) {
    return Response.json(
      { erro: `A senha nova precisa ter pelo menos ${MINIMO} caracteres.` },
      { status: 400 },
    );
  }
  if (nova !== String(confirmacao ?? "")) {
    return Response.json(
      { erro: "A confirmação não bate com a senha nova." },
      { status: 400 },
    );
  }
  if (nova === String(senhaAtual ?? "")) {
    return Response.json(
      { erro: "A senha nova é igual à atual." },
      { status: 400 },
    );
  }

  const resultado = await trocarSenhaCliente(clienteId, senhaAtual, nova);
  if (!resultado.ok) {
    return Response.json({ erro: resultado.erro }, { status: 400 });
  }
  return Response.json({ ok: true });
});
