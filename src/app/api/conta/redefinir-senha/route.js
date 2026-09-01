import { consumirTokenResetCliente } from "@/lib/cliente-auth";
import { lerCorpoJson } from "@/lib/requisicao";
import { comLog, registrarInfo } from "@/lib/log";

export const dynamic = "force-dynamic";

const ROTA = "POST /api/conta/redefinir-senha";
const SENHA_MINIMA = 6;

export const POST = comLog(ROTA, async (request) => {
  const corpo = await lerCorpoJson(request);
  if (!corpo) {
    return Response.json({ erro: "JSON inválido." }, { status: 400 });
  }
  const { token, novaSenha, confirmacao } = corpo;

  if (!String(token ?? "").trim()) {
    return Response.json(
      { erro: "Link inválido ou expirado." },
      { status: 400 },
    );
  }

  const nova = String(novaSenha ?? "");
  if (nova.length < SENHA_MINIMA) {
    return Response.json(
      { erro: `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.` },
      { status: 400 },
    );
  }
  if (nova !== String(confirmacao ?? "")) {
    return Response.json(
      { erro: "A confirmação não bate com a senha nova." },
      { status: 400 },
    );
  }

  // Nunca diferenciar, na resposta, entre token inexistente/expirado/já usado.
  const resultado = await consumirTokenResetCliente(token, nova);
  if (!resultado.ok) {
    return Response.json(
      { erro: "Link inválido ou expirado." },
      { status: 400 },
    );
  }

  registrarInfo(ROTA, "senha de cliente redefinida via token");
  return Response.json({ ok: true });
});
