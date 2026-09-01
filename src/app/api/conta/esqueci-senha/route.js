import crypto from "node:crypto";
import { gerarTokenResetCliente } from "@/lib/cliente-auth";
import { buscarClientePorEmail, lerConfig } from "@/lib/db";
import { enviarEmail } from "@/lib/email";
import { limiteAtingido, obterIp, registrarTentativa } from "@/lib/limitador";
import { lerCorpoJson } from "@/lib/requisicao";
import { comLog, registrarErro, registrarInfo } from "@/lib/log";
import { NOME_PADRAO } from "@/lib/format";

export const dynamic = "force-dynamic";

const ROTA = "POST /api/conta/esqueci-senha";

const JANELA_IP_MINUTOS = 15;
const MAXIMO_IP = 5;
const JANELA_EMAIL_MINUTOS = 60;
const MAXIMO_EMAIL = 3;

const MENSAGEM_GENERICA =
  "Se esse e-mail tiver uma conta, enviamos um link para redefinir a senha.";

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

  const chaveIp = `conta-esqueci:ip:${obterIp(request)}`;
  const chaveEmail = email ? `conta-esqueci:email:${hashEmail(email)}` : null;

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

  // A partir daqui, SEMPRE 200 com a mesma mensagem.
  if (email) {
    const cliente = buscarClientePorEmail(email);
    if (cliente) {
      const token = gerarTokenResetCliente(cliente.id, obterIp(request));
      const link = `${process.env.APP_URL || ""}/conta?token=${token}`;
      const nomeBarbearia = lerConfig().nome_barbearia || NOME_PADRAO;
      try {
        await enviarEmail({
          para: email,
          assunto: `Redefinir sua senha — ${nomeBarbearia}`,
          texto: `Olá, ${cliente.nome}!\n\nRecebemos um pedido para redefinir a senha da sua conta na ${nomeBarbearia}.\n\nClique no link abaixo para escolher uma senha nova. Ele vale por 30 minutos e só pode ser usado uma vez:\n${link}\n\nSe não foi você quem pediu, ignore este e-mail — sua senha continua a mesma.`,
        });
        registrarInfo(ROTA, "link de redefinição enviado");
      } catch (erro) {
        registrarErro(ROTA, "falha ao enviar e-mail de redefinição", erro);
      }
    }
  }

  return Response.json({ ok: true, mensagem: MENSAGEM_GENERICA });
});
