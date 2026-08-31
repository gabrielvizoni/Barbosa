import { consumirTokenReset } from "@/lib/auth";
import { lerCorpoJson } from "@/lib/requisicao";
import { comLog, registrarInfo } from "@/lib/log";

export const dynamic = "force-dynamic";

const ROTA = "POST /api/admin/redefinir-senha";
const SENHA_MINIMA = 6;

// Único endpoint que toca o token — de propósito não existe um endpoint
// separado de "validar token" antes do submit, que viraria um oráculo para
// testar validade de token sem precisar escolher senha nenhuma.
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
  const resultado = await consumirTokenReset(token, nova);
  if (!resultado.ok) {
    return Response.json(
      { erro: "Link inválido ou expirado." },
      { status: 400 },
    );
  }

  registrarInfo(ROTA, "senha redefinida via token");
  return Response.json({ ok: true });
});
