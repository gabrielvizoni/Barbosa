import { NextResponse } from "next/server";

// A CSP mora aqui, e não em next.config.mjs, porque script-src precisa de um
// nonce novo a cada requisição: o próprio Next injeta scripts inline com o
// payload do RSC (streaming de Server Components) — sem o nonce, só
// `script-src 'self'` bloqueia esses scripts, e o site quebra em produção
// (em dev o Next contorna isso de um jeito que não reflete o build real —
// por isso testar só com `next dev` não pega esse problema).
// O Next detecta o nonce sozinho a partir do header de resposta abaixo e o
// aplica nos scripts que ele mesmo injeta.
//
// style-src precisa de 'unsafe-inline': o projeto usa `style={{...}}`
// (atributo HTML, não <style nonce>) em várias telas do painel — CSP não tem
// mecanismo de nonce para atributo style, só para blocos <style>. Trocar por
// CSS sem inline seria um refactor grande, fora do escopo desta correção.
// De https://fonts.googleapis.com/gstatic.com vem a folha de estilo e os
// arquivos de fonte do Google Fonts, carregados via <link> em layout.jsx.
export function middleware(request) {
  const nonce = crypto.randomUUID();

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set("Content-Security-Policy", csp);
  // O painel (/admin) é clickjackável hoje — nada impede alguém de embutir a
  // página num iframe e sobrepor botões invisíveis.
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains; preload",
  );

  return response;
}

export const config = {
  matcher: [
    // Tudo, exceto os arquivos estáticos do Next e o favicon — não têm HTML
    // pra proteger, e reescrever a resposta deles à toa custa performance.
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
