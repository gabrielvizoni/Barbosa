import { exigirSessao, gerarTokenReset, sessaoAtual } from "@/lib/auth";
import { buscarBarbeiroPorId, getDb, lerConfig } from "@/lib/db";
import { enviarEmail } from "@/lib/email";
import { obterIp } from "@/lib/limitador";
import { comLog, registrarErro } from "@/lib/log";
import { registrarAuditoria } from "@/lib/auditoria";
import { NOME_PADRAO } from "@/lib/format";

export const dynamic = "force-dynamic";

const ROTA = "POST /api/admin/barbeiros/[id]/reenviar-convite";

// Quem cadastra o e-mail de outro barbeiro nunca digita a senha dele — só
// dispara este mesmo mecanismo de token que o "esqueci a senha" usa, com o
// texto do e-mail ajustado para "ativar sua conta" em vez de "redefinir".
export const POST = comLog(ROTA, async (request, { params }) => {
  const negado = exigirSessao(request);
  if (negado) return negado;

  const sessao = sessaoAtual();
  if (!sessao || sessao.tipo !== "barbeiro") {
    return Response.json({ erro: "Ação não permitida." }, { status: 403 });
  }

  const id = Number(params.id);
  const barbeiro = buscarBarbeiroPorId(id);
  if (!barbeiro) {
    return Response.json(
      { erro: "Profissional não encontrado." },
      { status: 404 },
    );
  }
  if (!barbeiro.email) {
    return Response.json(
      {
        erro: "Cadastre o e-mail deste profissional antes de enviar o convite.",
      },
      { status: 400 },
    );
  }
  if (!barbeiro.login_ativo) {
    return Response.json(
      { erro: "O login deste profissional está desativado." },
      { status: 400 },
    );
  }

  const token = gerarTokenReset(barbeiro.id, obterIp(request));
  const link = `${process.env.APP_URL || ""}/admin?token=${token}`;
  const nomeBarbearia = lerConfig().nome_barbearia || NOME_PADRAO;

  try {
    await enviarEmail({
      para: barbeiro.email,
      assunto: `Ative sua conta no painel — ${nomeBarbearia}`,
      texto: `Olá, ${barbeiro.nome}!\n\nVocê foi cadastrado no painel administrativo da ${nomeBarbearia}. Clique no link abaixo para escolher sua senha e ativar sua conta. Ele vale por 30 minutos e só pode ser usado uma vez:\n${link}\n\nSe você não esperava este e-mail, pode ignorá-lo.`,
    });
  } catch (erro) {
    registrarErro(ROTA, "falha ao enviar convite", erro);
    return Response.json(
      {
        erro: "Não consegui enviar o e-mail de convite. Tente de novo em instantes.",
      },
      { status: 502 },
    );
  }

  registrarAuditoria(getDb(), {
    acao: "reenviar_convite",
    tabela: "barbeiros",
    registroId: id,
  });

  return Response.json({ ok: true });
});
