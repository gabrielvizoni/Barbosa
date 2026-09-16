// Infra das rotinas periódicas (Epic 0): exigirSegredoTarefa, os três stubs
// de /api/tarefas/* e a exigência de TAREFA_SEGREDO em produção (RNF-22).
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { exigirSegredoTarefa } from "../src/lib/tarefas.js";
import { verificarAmbiente } from "../src/lib/config-ambiente.js";
import { bancoDeTeste, requisicao } from "./ajuda.js";

const SEGREDO = "segredo-de-teste-bem-comprido-123";

let segredoOriginal;

beforeEach(() => {
  bancoDeTeste();
  segredoOriginal = process.env.TAREFA_SEGREDO;
  process.env.TAREFA_SEGREDO = SEGREDO;
});

afterEach(() => {
  if (segredoOriginal === undefined) delete process.env.TAREFA_SEGREDO;
  else process.env.TAREFA_SEGREDO = segredoOriginal;
});

/* -------------------- exigirSegredoTarefa -------------------- */

test("exigirSegredoTarefa responde 401 sem o header", () => {
  const resposta = exigirSegredoTarefa(
    requisicao("http://localhost/api/tarefas/lembretes", { method: "POST" }),
  );
  assert.equal(resposta.status, 401);
});

test("exigirSegredoTarefa responde 401 com o header vazio ou errado", () => {
  for (const valor of ["", "outro-segredo"]) {
    const req = requisicao("http://localhost/api/tarefas/lembretes", {
      method: "POST",
    });
    req.headers.set("X-Tarefa-Segredo", valor);
    assert.equal(exigirSegredoTarefa(req).status, 401);
  }
});

test("exigirSegredoTarefa devolve null com o segredo certo", () => {
  const req = requisicao("http://localhost/api/tarefas/lembretes", {
    method: "POST",
  });
  req.headers.set("X-Tarefa-Segredo", SEGREDO);
  assert.equal(exigirSegredoTarefa(req), null);
});

test("exigirSegredoTarefa nunca autoriza quando TAREFA_SEGREDO não está definido, mesmo com header vazio", () => {
  delete process.env.TAREFA_SEGREDO;
  const req = requisicao("http://localhost/api/tarefas/lembretes", {
    method: "POST",
  });
  req.headers.set("X-Tarefa-Segredo", "");
  assert.equal(exigirSegredoTarefa(req).status, 401);
});

/* -------------------- stubs -------------------- */

const ROTAS_STUB = [
  "../src/app/api/tarefas/lembretes/route.js",
  "../src/app/api/tarefas/marcar-no-show/route.js",
  "../src/app/api/tarefas/limpeza/route.js",
];

for (const modulo of ROTAS_STUB) {
  test(`${modulo}: 401 sem segredo, 200 com segredo`, async () => {
    const { POST } = await import(modulo);

    const semSegredo = await POST(
      requisicao("http://localhost/x", { method: "POST" }),
    );
    assert.equal(semSegredo.status, 401);

    const req = requisicao("http://localhost/x", { method: "POST" });
    req.headers.set("X-Tarefa-Segredo", SEGREDO);
    const comSegredo = await POST(req);
    assert.equal(comSegredo.status, 200);
    const corpo = await comSegredo.json();
    assert.deepEqual(corpo, { ok: true, processados: 0 });
  });
}

/* -------------------- verificarAmbiente -------------------- */

test("verificarAmbiente acusa TAREFA_SEGREDO ausente ou placeholder", () => {
  delete process.env.TAREFA_SEGREDO;
  assert.ok(
    verificarAmbiente().some((p) => p.includes("TAREFA_SEGREDO")),
    "deveria acusar TAREFA_SEGREDO ausente",
  );

  process.env.TAREFA_SEGREDO = "troque-este-segredo";
  assert.ok(
    verificarAmbiente().some((p) => p.includes("TAREFA_SEGREDO")),
    "deveria acusar o placeholder do .env.example",
  );

  process.env.TAREFA_SEGREDO = SEGREDO;
  assert.ok(
    !verificarAmbiente().some((p) => p.includes("TAREFA_SEGREDO")),
    "não deveria acusar nada com um segredo de verdade",
  );
});
