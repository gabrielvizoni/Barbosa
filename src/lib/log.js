// Log estruturado, uma linha JSON por evento (NDJSON) no stdout — sem
// biblioteca externa, fácil de agregar com qualquer coletor de log padrão
// (Railway, Fly.io, PM2 etc. já capturam stdout como log).
//
// NUNCA logar PII: nada de telefone ou nome de cliente — use o id do
// agendamento. Isso vale para todo `contexto` passado às funções abaixo.

function escrever(nivel, rota, msg, contexto = {}) {
  const linha = { ts: new Date().toISOString(), nivel, rota, msg, ...contexto };
  process.stdout.write(`${JSON.stringify(linha)}\n`);
}

export function registrarInfo(rota, msg, contexto) {
  escrever("info", rota, msg, contexto);
}

export function registrarAviso(rota, msg, contexto) {
  escrever("aviso", rota, msg, contexto);
}

/** `erroOriginal` vira só a mensagem (nunca o stack trace, que fica só no processo). */
export function registrarErro(rota, msg, erroOriginal, contexto) {
  const erro =
    erroOriginal instanceof Error
      ? erroOriginal.message
      : String(erroOriginal ?? "");
  escrever("erro", rota, msg, { ...contexto, erro });
}

/**
 * Envolve um route handler: qualquer exceção não tratada é logada (com a
 * mensagem real, nunca vazada pro cliente) e vira uma resposta genérica —
 * o comportamento atual de não expor stack trace está correto e continua.
 */
export function comLog(rota, handler) {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (erroOriginal) {
      registrarErro(rota, "erro não tratado", erroOriginal);
      return Response.json(
        { erro: "Algo deu errado. Tente de novo em instantes." },
        { status: 500 },
      );
    }
  };
}
