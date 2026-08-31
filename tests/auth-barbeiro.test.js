import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  autenticarBarbeiro,
  concluirBootstrap,
  consumirTokenReset,
  construirTokenBarbeiro,
  gerarTokenReset,
  modoBootstrap,
  sessaoValida,
  trocarSenhaPropria,
  NOME_COOKIE,
} from "../src/lib/auth.js";
import { getDb, buscarBarbeiroPorId } from "../src/lib/db.js";
import { __resetCookies, __setCookie } from "./fake-next-headers.mjs";
import { bancoDeTeste, criarBarbeiroComLogin } from "./ajuda.js";

beforeEach(() => {
  bancoDeTeste();
  __resetCookies();
  // Cada teste começa numa equipe vazia — modoBootstrap() e a unicidade de
  // e-mail dependem do estado da tabela, então um barbeiro deixado por um
  // teste anterior contaminaria os seguintes.
  getDb().exec("DELETE FROM barbeiros");
});

/* ---------------------------------------------------------------------
   autenticarBarbeiro
   --------------------------------------------------------------------- */

test("autenticarBarbeiro aceita e-mail e senha corretos", async () => {
  await criarBarbeiroComLogin({
    email: "corte@teste.com",
    senha: "senha-correta-123",
  });
  const resultado = await autenticarBarbeiro(
    "corte@teste.com",
    "senha-correta-123",
  );
  assert.equal(resultado.ok, true);
  assert.equal(resultado.barbeiro.email, "corte@teste.com");
});

test("autenticarBarbeiro rejeita senha errada", async () => {
  await criarBarbeiroComLogin({
    email: "corte2@teste.com",
    senha: "senha-correta-123",
  });
  const resultado = await autenticarBarbeiro("corte2@teste.com", "errada");
  assert.equal(resultado.ok, false);
});

test("autenticarBarbeiro rejeita e-mail inexistente", async () => {
  const resultado = await autenticarBarbeiro(
    "ninguem@teste.com",
    "qualquer-coisa",
  );
  assert.equal(resultado.ok, false);
});

test("autenticarBarbeiro rejeita barbeiro com login_ativo = 0, mesmo com a senha certa", async () => {
  await criarBarbeiroComLogin({
    email: "desativado@teste.com",
    senha: "senha-correta-123",
    loginAtivo: 0,
  });
  const resultado = await autenticarBarbeiro(
    "desativado@teste.com",
    "senha-correta-123",
  );
  assert.equal(resultado.ok, false);
});

test("autenticarBarbeiro é case-insensitive no e-mail", async () => {
  await criarBarbeiroComLogin({
    email: "MaiUsculo@Teste.com",
    senha: "senha-correta-123",
  });
  const resultado = await autenticarBarbeiro(
    "maiusculo@teste.com",
    "senha-correta-123",
  );
  assert.equal(resultado.ok, true);
});

/* ---------------------------------------------------------------------
   Token de reset (gerarTokenReset / consumirTokenReset)
   --------------------------------------------------------------------- */

test("consumirTokenReset aceita um token recém-gerado e grava a senha nova", async () => {
  const id = await criarBarbeiroComLogin({ email: "reset1@teste.com" });
  const token = gerarTokenReset(id, "1.2.3.4");

  const resultado = await consumirTokenReset(token, "senha-nova-123");
  assert.equal(resultado.ok, true);
  assert.equal(resultado.barbeiroId, id);

  const login = await autenticarBarbeiro("reset1@teste.com", "senha-nova-123");
  assert.equal(login.ok, true);
});

test("consumirTokenReset rejeita um token que nunca existiu", async () => {
  const resultado = await consumirTokenReset(
    "token-que-nunca-foi-gerado",
    "senha-nova-123",
  );
  assert.equal(resultado.ok, false);
});

test("consumirTokenReset rejeita um token expirado", async () => {
  const id = await criarBarbeiroComLogin({ email: "reset2@teste.com" });
  const token = gerarTokenReset(id, "1.2.3.4");

  // Força a expiração diretamente no banco — gerarTokenReset() não aceita
  // um prazo customizado (é sempre 30 minutos, por design).
  getDb()
    .prepare(
      "UPDATE reset_senha_tokens SET expira_em = datetime('now', '-1 minute')",
    )
    .run();

  const resultado = await consumirTokenReset(token, "senha-nova-123");
  assert.equal(resultado.ok, false);
});

test("consumirTokenReset rejeita um token já usado", async () => {
  const id = await criarBarbeiroComLogin({ email: "reset3@teste.com" });
  const token = gerarTokenReset(id, "1.2.3.4");

  const primeiro = await consumirTokenReset(token, "senha-nova-123");
  assert.equal(primeiro.ok, true);

  const segundo = await consumirTokenReset(token, "outra-senha-456");
  assert.equal(segundo.ok, false);
});

test("consumirTokenReset apaga outros tokens pendentes do mesmo barbeiro ao ser usado", async () => {
  const id = await criarBarbeiroComLogin({ email: "reset4@teste.com" });
  const primeiroToken = gerarTokenReset(id, "1.2.3.4");
  const segundoToken = gerarTokenReset(id, "1.2.3.4");

  await consumirTokenReset(segundoToken, "senha-nova-123");

  // O primeiro token, nunca usado, deveria ter sido invalidado junto.
  const resultado = await consumirTokenReset(primeiroToken, "outra-senha-456");
  assert.equal(resultado.ok, false);
});

/* ---------------------------------------------------------------------
   sessao_versao — invalidação de sessões antigas
   --------------------------------------------------------------------- */

test("trocar a própria senha derruba um cookie emitido antes da troca", async () => {
  const id = await criarBarbeiroComLogin({
    email: "versao@teste.com",
    senha: "senha-antiga-123",
  });
  const barbeiroAntes = buscarBarbeiroPorId(id);
  const tokenAntigo = construirTokenBarbeiro(
    id,
    String(barbeiroAntes.sessao_versao),
    Date.now() + 60_000,
  );
  __setCookie(NOME_COOKIE, tokenAntigo);
  assert.equal(sessaoValida(), true);

  const resultado = await trocarSenhaPropria(
    id,
    "senha-antiga-123",
    "senha-nova-456",
  );
  assert.equal(resultado.ok, true);

  // trocarSenhaPropria já substitui o cookie por um válido na versão nova —
  // aqui simulamos um SEGUNDO aparelho, que ainda carrega o cookie antigo.
  __setCookie(NOME_COOKIE, tokenAntigo);
  assert.equal(sessaoValida(), false);
});

/* ---------------------------------------------------------------------
   modoBootstrap()
   --------------------------------------------------------------------- */

test("modoBootstrap() é true sem nenhum admin com login definido, e false depois do primeiro", async () => {
  assert.equal(modoBootstrap(), true);

  const resultado = await concluirBootstrap({
    barbeiroId: null,
    nome: "Primeiro Admin",
    email: "admin@teste.com",
    senha: "senha-do-admin-123",
  });
  assert.equal(resultado.ok, true);

  assert.equal(modoBootstrap(), false);
});

test("modoBootstrap() continua true só com barbeiros sem senha (upgrade de instalação antiga)", () => {
  getDb()
    .prepare(
      "INSERT INTO barbeiros (nome, papel, senha_hash) VALUES ('Legado', 'admin', '')",
    )
    .run();
  assert.equal(modoBootstrap(), true);
});

test("concluirBootstrap promove um barbeiro já cadastrado em vez de criar um novo", async () => {
  // Simula o resultado da migration num upgrade: já promovido a admin, mas
  // ainda sem e-mail/senha próprios (colunas na string vazia, seus defaults).
  const { lastInsertRowid } = getDb()
    .prepare("INSERT INTO barbeiros (nome, papel) VALUES ('Legado', 'admin')")
    .run();
  const id = Number(lastInsertRowid);

  const resultado = await concluirBootstrap({
    barbeiroId: id,
    email: "promovido@teste.com",
    senha: "senha-do-admin-123",
  });
  assert.equal(resultado.ok, true);
  assert.equal(resultado.barbeiroId, id);

  const total = getDb().prepare("SELECT COUNT(*) AS n FROM barbeiros").get().n;
  assert.equal(total, 1, "não deveria ter criado um segundo barbeiro");
});
