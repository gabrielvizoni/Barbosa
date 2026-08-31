import { exigirSessao, sessaoAtual, trocarEmailProprio } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { emailValido } from "@/lib/validacao";
import { lerCorpoJson } from "@/lib/requisicao";
import { comLog } from "@/lib/log";
import { registrarAuditoria } from "@/lib/auditoria";

export const dynamic = "force-dynamic";

export const GET = comLog("GET /api/admin/perfil", async (request) => {
  const negado = exigirSessao(request);
  if (negado) return negado;

  const sessao = sessaoAtual();
  if (!sessao || sessao.tipo !== "barbeiro") {
    return Response.json({ erro: "Ação não permitida." }, { status: 403 });
  }

  return Response.json({
    nome: sessao.nome,
    email: sessao.email,
    papel: sessao.papel,
  });
});

export const PATCH = comLog("PATCH /api/admin/perfil", async (request) => {
  const negado = exigirSessao(request);
  if (negado) return negado;

  const sessao = sessaoAtual();
  if (!sessao || sessao.tipo !== "barbeiro") {
    return Response.json({ erro: "Ação não permitida." }, { status: 403 });
  }

  const corpo = await lerCorpoJson(request);
  if (!corpo) {
    return Response.json({ erro: "JSON inválido." }, { status: 400 });
  }

  const { email, senhaAtual } = corpo;
  const erroFormato = emailValido(email);
  if (erroFormato || !String(email ?? "").trim()) {
    return Response.json(
      { erro: erroFormato || "Informe o e-mail." },
      { status: 400 },
    );
  }

  const resultado = await trocarEmailProprio(
    sessao.barbeiroId,
    senhaAtual,
    email,
  );
  if (!resultado.ok) {
    return Response.json({ erro: resultado.erro }, { status: 400 });
  }

  // Nunca o e-mail em si, nos dois lados — só o fato de que ele mudou.
  registrarAuditoria(getDb(), {
    acao: "trocar_email",
    tabela: "barbeiros",
    registroId: sessao.barbeiroId,
  });

  return Response.json({ ok: true });
});
