// Substitui `next/headers` nos testes (trocado pelo hook em module-hooks.mjs).
// `cookies()` fora de uma requisição real do Next lança erro; aqui é só um
// cookie jar em memória, do tamanho do que src/lib/auth.js precisa: get/set.
let loja = new Map();

export function cookies() {
  return {
    get(nome) {
      return loja.has(nome) ? { name: nome, value: loja.get(nome) } : undefined;
    },
    set(nome, valor) {
      loja.set(nome, valor);
    },
  };
}

/** Só para os testes: limpa todos os cookies entre casos. */
export function __resetCookies() {
  loja = new Map();
}

/** Só para os testes: injeta um cookie diretamente, sem passar por criarSessao(). */
export function __setCookie(nome, valor) {
  loja.set(nome, valor);
}
