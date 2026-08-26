// Ponto de entrada passado via `node --import` (ver package.json): registra
// o hook de resolução de tests/module-hooks.mjs antes de qualquer teste
// carregar código de src/.
//
// DATABASE_PATH também é definida aqui, e não em tests/ajuda.js — imports
// ESM são "hoisted" para o topo do módulo, então um `import '../src/lib/db.js'`
// escrito DEPOIS de `process.env.DATABASE_PATH = ':memory:'` no mesmo
// arquivo ainda executa antes dessa atribuição, e db.js já teria lido a env
// var vazia. Este arquivo não importa nada de src/, então a atribuição abaixo
// é garantida por rodar antes de qualquer módulo de teste começar a carregar.
import { register } from 'node:module';

process.env.DATABASE_PATH = ':memory:';

register('./module-hooks.mjs', import.meta.url);
