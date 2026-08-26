import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

import { bancoDeTeste } from "./ajuda.js";
import { __resetCookies, __setCookie } from "./fake-next-headers.mjs";
import { construirToken, NOME_COOKIE, gerarHash } from "../src/lib/auth.js";
import { salvarConfig } from "../src/lib/db.js";

// Arquivos criados por este teste, para apagar no final — grava em
// public/uploads de verdade (é o que a rota faz), então precisa limpar.
const criados = [];

beforeEach(async () => {
  bancoDeTeste();
  __resetCookies();
  // Sem senha própria definida, exigirSessao() bloqueia tudo com 403 exceto
  // /api/admin/senha e o GET de /api/admin/config (Etapa 1, item 6) — o
  // upload precisa de uma senha já trocada para não cair nessa trava.
  salvarConfig({ senha_hash: await gerarHash("senha-de-teste-valida-99") });
  __setCookie(NOME_COOKIE, construirToken("1", Date.now() + 60_000));
});

after(() => {
  // Só limpeza best-effort: numa pasta de projeto sincronizada pelo
  // OneDrive, o arquivo recém-criado às vezes fica preso (EBUSY) por mais
  // tempo do que vale a pena esperar aqui — isso nunca deveria derrubar o
  // hook e marcar os testes (que já passaram) como falhos.
  for (const caminho of criados) {
    try {
      fs.rmSync(caminho, { force: true });
    } catch {
      // best-effort: se não der para apagar agora, fica para a próxima.
    }
  }
});

/**
 * Simula uma foto de câmera: grande e "ruidosa" (não comprime de graça como
 * um bitmap liso), mas ainda abaixo do teto de 5 MB que a rota aceita.
 */
async function fotoSimulada() {
  return sharp({
    create: {
      width: 2200,
      height: 2900,
      channels: 3,
      noise: { type: "gaussian", mean: 128, sigma: 25 },
    },
  })
    .jpeg({ quality: 82 })
    .toBuffer();
}

test("upload redimensiona para no máximo 700px de largura e converte para WebP leve", async () => {
  const { POST } = await import("../src/app/api/admin/upload/route.js");

  const bytes = await fotoSimulada();
  const form = new FormData();
  form.append("arquivo", new File([bytes], "foto.jpg", { type: "image/jpeg" }));
  form.append("pasta", "servicos");

  const resposta = await POST(
    new Request("http://localhost/api/admin/upload", {
      method: "POST",
      body: form,
    }),
  );
  assert.equal(resposta.status, 201);

  const { url } = await resposta.json();
  assert.match(url, /^\/uploads\/servicos\/[0-9a-f-]{36}\.webp$/);

  const caminho = path.join(process.cwd(), "public", url);
  criados.push(caminho);
  assert.ok(
    fs.existsSync(caminho),
    "arquivo processado deveria existir em disco",
  );

  const tamanho = fs.statSync(caminho).size;
  assert.ok(
    tamanho < 150 * 1024,
    `esperava menos de 150 KB, ficou com ${(tamanho / 1024).toFixed(1)} KB`,
  );

  const meta = await sharp(caminho).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.width, 700);
});

test("upload apaga a imagem anterior ao gravar a substituta", async () => {
  const { POST } = await import("../src/app/api/admin/upload/route.js");
  const bytes = await fotoSimulada();

  async function enviar(anterior) {
    const form = new FormData();
    form.append(
      "arquivo",
      new File([bytes], "foto.jpg", { type: "image/jpeg" }),
    );
    form.append("pasta", "produtos");
    if (anterior) form.append("anterior", anterior);
    const resposta = await POST(
      new Request("http://localhost/api/admin/upload", {
        method: "POST",
        body: form,
      }),
    );
    const { url } = await resposta.json();
    const caminho = path.join(process.cwd(), "public", url);
    criados.push(caminho);
    return { url, caminho };
  }

  const primeira = await enviar(null);
  assert.ok(fs.existsSync(primeira.caminho));

  const segunda = await enviar(primeira.url);
  assert.ok(fs.existsSync(segunda.caminho), "a nova imagem deveria existir");
  assert.equal(
    fs.existsSync(primeira.caminho),
    false,
    "a imagem anterior deveria ter sido apagada",
  );
});

test("upload ignora um valor forjado em 'anterior' fora do formato de upload nosso", async () => {
  const { POST } = await import("../src/app/api/admin/upload/route.js");
  const bytes = await fotoSimulada();

  const alvo = path.join(process.cwd(), "public", "uploads-teste-alvo.txt");
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.writeFileSync(alvo, "não pode sumir");
  criados.push(alvo);

  const form = new FormData();
  form.append("arquivo", new File([bytes], "foto.jpg", { type: "image/jpeg" }));
  form.append("pasta", "produtos");
  form.append("anterior", "/../uploads-teste-alvo.txt");

  const resposta = await POST(
    new Request("http://localhost/api/admin/upload", {
      method: "POST",
      body: form,
    }),
  );
  const { url } = await resposta.json();
  criados.push(path.join(process.cwd(), "public", url));

  assert.ok(
    fs.existsSync(alvo),
    "arquivo fora do padrão de upload não deveria ser apagado",
  );
});
