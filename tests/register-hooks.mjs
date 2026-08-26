// Ponto de entrada passado via `node --import` (ver package.json): registra
// o hook de resolução de tests/module-hooks.mjs antes de qualquer teste
// carregar código de src/.
//
// DATABASE_PATH também é definida aqui, e não em tests/ajuda.js — imports
// ESM são "hoisted" para o topo do módulo, então um `import '../src/lib/db.js'`
// escrito DEPOIS de uma atribuição a process.env no mesmo arquivo ainda
// executa antes dela, e db.js já teria lido a env var vazia. Este arquivo
// não importa nada de src/, então a atribuição abaixo é garantida por rodar
// antes de qualquer módulo de teste começar a carregar.
//
// Usa um arquivo temporário, não ':memory:': desde a Etapa 2, getDb() só
// VERIFICA a versão do schema — quem aplica as migrations é
// aplicarMigrations() (ver tests/ajuda.js), numa conexão própria, aberta
// antes da primeira chamada a getDb(). Duas conexões ':memory:' são bancos
// completamente independentes, então a migration não "aparece" para o
// getDb() de dentro do app; um arquivo real, aberto duas vezes, é o mesmo
// banco nas duas conexões — como vai ser no ambiente real também.
import { register } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const CAMINHO_DB_TESTE = path.join(
  os.tmpdir(),
  `barbosa-teste-${process.pid}-${crypto.randomBytes(4).toString("hex")}.db`,
);
process.env.DATABASE_PATH = CAMINHO_DB_TESTE;

register("./module-hooks.mjs", import.meta.url);

process.on("exit", () => {
  for (const sufixo of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(CAMINHO_DB_TESTE + sufixo);
    } catch {
      // já não existe, ou não deu tempo de criar — sem problema.
    }
  }
});
