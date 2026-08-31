import crypto from "node:crypto";
import { gerarTokenReset } from "@/lib/auth";
import { buscarBarbeiroPorEmail, lerConfig } from "@/lib/db";
import { enviarEmail } from "@/lib/email";
import { limiteAtingido, obterIp, registrarTentativa } from "@/lib/limitador";
import { lerCorpoJson } from "@/lib/requisicao";
import { comLog, registrarErro, registrarInfo } from "@/lib/log";
import { NOME_PADRAO } from "@/lib/format";

export const dynamic = "force-dynamic";

const ROTA = "POST /api/admin/esqueci-senha";

// Duas chaves de limite: por IP, contra quem tenta enumerar e-mails; por
// e-mail (hasheado — nunca guardar o e-mail em texto na tabela de limite),
// contra quem "inunda" a caixa de entrada de um barbeiro específico
// rotacionando IP.
const JANELA_IP_MINUTOS = 15;
const MAXIMO_IP = 5;
const JANELA_EMAIL_MINUTOS = 60;
const MAXIMO_EMAIL = 3;

const MENSAGEM_GENERICA =
  "Se esse e-mail existir e tiver login ativo, enviamos um link para redefinir a senha.";

function hashEmail(email) {
  return crypto.createHash("sha256").update(email).digest("hex");
}

export const POST = comLog(ROTA, async (request) => {
  const corpo = await lerCorpoJson(request);
  if (!corpo) {
    return Response.json({ erro: "JSON inválido." }, { status: 400 });
  }

  const email = String(corpo.email ?? "")
    .trim()
    .toLowerCase();

  const chaveIp = `esqueci-senha:ip:${obterIp(request)}`;
  const chaveEmail = email ? `esqueci-senha:email:${hashEmail(email)}` : null;

  const bloqueado =
    limiteAtingido(chaveIp, {
      janelaMinutos: JANELA_IP_MINUTOS,
      maximo: MAXIMO_IP,
    }) ||
    (chaveEmail &&
      limiteAtingido(chaveEmail, {
        janelaMinutos: JANELA_EMAIL_MINUTOS,
        maximo: MAXIMO_EMAIL,
      }));

  registrarTentativa(chaveIp);
  if (chaveEmail) registrarTentativa(chaveEmail);

  if (bloqueado) {
    return Response.json(
      { erro: "Muitas tentativas. Aguarde um pouco e tente de novo." },
      { status: 429 },
    );
  }

  // A partir daqui, SEMPRE 200 com a mesma mensagem — o resultado da busca
  // abaixo nunca pode virar uma diferença observável na resposta.
  if (email) {
    const barbeiro = buscarBarbeiroPorEmail(email);
    if (barbeiro && barbeiro.login_ativo) {
      const token = gerarTokenReset(barbeiro.id, obterIp(request));
      const link = `${process.env.APP_URL || ""}/admin?token=${token}`;
      const nomeBarbearia = lerConfig().nome_barbearia || NOME_PADRAO;

      try {
        await enviarEmail({
          para: email,
          assunto: `Redefinir sua senha — ${nomeBarbearia}`,
          texto: `Olá, ${barbeiro.nome}!\n\nRecebemos um pedido para redefinir sua senha do painel administrativo (${nomeBarbearia}).\n\nClique no link abaixo para escolher uma senha nova. Ele vale por 30 minutos e só pode ser usado uma vez:\n${link}\n\nSe não foi você quem pediu, ignore este e-mail — sua senha continua a mesma.`,
        });
        registrarInfo(ROTA, "link de redefinição enviado");
      } catch (erro) {
        // Falha no envio nunca vira uma resposta diferente para quem pediu.
        registrarErro(ROTA, "falha ao enviar e-mail de redefinição", erro);
      }
    }
  }

  return Response.json({ ok: true, mensagem: MENSAGEM_GENERICA });
});
