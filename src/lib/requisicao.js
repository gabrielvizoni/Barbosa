/**
 * Lê e faz parse do corpo JSON de uma Request.
 *
 * Corpo vazio vira `{}` — deixa a validação de cada campo dar a mensagem
 * específica ("nome é obrigatório" etc.). Corpo malformado (JSON inválido)
 * devolve `undefined`: antes, `request.json().catch(() => ({}))` tratava os
 * dois casos como a mesma coisa, e um corpo quebrado virava silenciosamente
 * "{}" — o cliente recebia "Nada para salvar" em vez de saber que mandou
 * JSON inválido.
 */
export async function lerCorpoJson(request) {
  const texto = await request.text();
  if (!texto.trim()) return {};
  try {
    return JSON.parse(texto);
  } catch {
    return undefined;
  }
}
