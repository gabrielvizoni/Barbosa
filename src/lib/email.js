// Envio de e-mail transacional (convite/reset de senha) — sem SDK, só fetch
// direto na API do provedor escolhido, seguindo a mesma filosofia de
// dependências mínimas do resto do projeto (ex.: scrypt nativo em auth.js).
//
// EMAIL_PROVIDER=console (padrão/dev): não envia nada de verdade, só loga o
// conteúdo com o prefixo "[email:dev]" — para nunca ser confundido com um
// envio real — e nunca lança erro; um "falso envio" não pode derrubar o
// fluxo de esqueci-senha em desenvolvimento.
//
// EMAIL_PROVIDER=resend: chamada HTTP à API do Resend (RESEND_API_KEY,
// EMAIL_REMETENTE). Em produção, verificarAmbiente() (config-ambiente.js)
// recusa o boot se EMAIL_PROVIDER continuar em "console".

async function enviarViaResend({ para, assunto, texto, html }) {
  const resposta = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_REMETENTE,
      to: [para],
      subject: assunto,
      text: texto,
      ...(html ? { html } : {}),
    }),
  });

  if (!resposta.ok) {
    const corpo = await resposta.text().catch(() => "");
    throw new Error(
      `Resend respondeu ${resposta.status} ao enviar e-mail: ${corpo.slice(0, 300)}`,
    );
  }
}

/**
 * Envia um e-mail transacional. Só lança quando o provedor real (resend)
 * falha — quem chama (as rotas de esqueci-senha/redefinir-senha) precisa
 * decidir o que fazer sem deixar isso vazar como diferença observável para
 * quem fez a requisição (a resposta ao cliente é sempre a mesma, dê certo
 * ou não o envio).
 */
export async function enviarEmail({ para, assunto, texto, html }) {
  const provedor = process.env.EMAIL_PROVIDER || "console";

  if (provedor === "resend") {
    await enviarViaResend({ para, assunto, texto, html });
    return;
  }

  console.log(`[email:dev] para=${para} assunto="${assunto}"\n${texto}`);
}
