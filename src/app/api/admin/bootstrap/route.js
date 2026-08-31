import {
  concluirBootstrap,
  criarSessaoBarbeiro,
  exigirSessao,
  modoBootstrap,
  sessaoAtual,
} from "@/lib/auth";
import { getDb } from "@/lib/db";
import { emailValido } from "@/lib/validacao";
import { lerCorpoJson } from "@/lib/requisicao";
import { comLog } from "@/lib/log";
import { registrarAuditoria } from "@/lib/auditoria";

export const dynamic = "force-dynamic";

const SENHA_MINIMA = 6;

export const POST = comLog("POST /api/admin/bootstrap", async (request) => {
  const negado = exigirSessao(request);
  if (negado) return negado;

  if (!modoBootstrap()) {
    return Response.json(
      { erro: "A configuração inicial já foi concluída." },
      { status: 409 },
    );
  }

  const sessao = sessaoAtual();
  if (!sessao || sessao.tipo !== "bootstrap") {
    return Response.json({ erro: "Ação não permitida." }, { status: 403 });
  }

  const corpo = await lerCorpoJson(request);
  if (!corpo) {
    return Response.json({ erro: "JSON inválido." }, { status: 400 });
  }

  const { barbeiroId, nome, email, senha, confirmacao } = corpo;

  if (!barbeiroId && !String(nome ?? "").trim()) {
    return Response.json(
      { erro: "Escolha um profissional já cadastrado ou informe o nome." },
      { status: 400 },
    );
  }

  const erroEmail = emailValido(email);
  if (erroEmail || !String(email ?? "").trim()) {
    return Response.json(
      { erro: erroEmail ? `e-mail: ${erroEmail}` : "Informe o e-mail." },
      { status: 400 },
    );
  }

  const novaSenha = String(senha ?? "");
  if (novaSenha.length < SENHA_MINIMA) {
    return Response.json(
      { erro: `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.` },
      { status: 400 },
    );
  }
  if (novaSenha !== String(confirmacao ?? "")) {
    return Response.json(
      { erro: "A confirmação não bate com a senha." },
      { status: 400 },
    );
  }

  const resultado = await concluirBootstrap({
    barbeiroId: barbeiroId ? Number(barbeiroId) : null,
    nome,
    email,
    senha: novaSenha,
  });
  if (!resultado.ok) {
    return Response.json({ erro: resultado.erro }, { status: 400 });
  }

  registrarAuditoria(getDb(), {
    acao: "concluir_bootstrap",
    tabela: "barbeiros",
    registroId: resultado.barbeiroId,
  });

  criarSessaoBarbeiro(resultado.barbeiroId);
  return Response.json({ ok: true });
});
