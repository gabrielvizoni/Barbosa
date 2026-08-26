// Hook de resolução de módulos ESM usado só pelos testes (via register-hooks.mjs).
//
// Existe por dois motivos:
// 1. O código-fonte usa o alias "@/..." (configurado em jsconfig.json para o
//    bundler do Next) e imports relativos sem extensão ("./db"), que o
//    resolvedor ESM nativo do Node não entende sozinho.
// 2. Rotas de admin importam `next/headers`, que só funciona dentro do
//    runtime de requisição do Next — nos testes ele é trocado por
//    tests/fake-next-headers.mjs, um cookie jar em memória controlável.
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const RAIZ = process.cwd();

function comExtensaoJs(caminho) {
  if (path.extname(caminho)) return caminho;
  if (fs.existsSync(`${caminho}.js`)) return `${caminho}.js`;
  if (fs.existsSync(path.join(caminho, 'index.js'))) return path.join(caminho, 'index.js');
  return `${caminho}.js`;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const alvo = comExtensaoJs(path.join(RAIZ, 'src', specifier.slice(2)));
    return nextResolve(pathToFileURL(alvo).href, context);
  }

  if (specifier === 'next/headers') {
    const alvo = pathToFileURL(path.join(RAIZ, 'tests', 'fake-next-headers.mjs')).href;
    return nextResolve(alvo, context);
  }

  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !path.extname(specifier)) {
    const dirBase = path.dirname(fileURLToPath(context.parentURL));
    const alvo = comExtensaoJs(path.join(dirBase, specifier));
    return nextResolve(pathToFileURL(alvo).href, context);
  }

  return nextResolve(specifier, context);
}
