import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { bancoDeTeste } from './ajuda.js';
import { __resetCookies } from './fake-next-headers.mjs';

beforeEach(() => {
  bancoDeTeste();
  __resetCookies();
});

async function capturarStdoutAsync(fnAsync) {
  const linhas = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    linhas.push(chunk);
    return true;
  };
  let resultado;
  try {
    resultado = await fnAsync();
  } finally {
    process.stdout.write = original;
  }
  return { resultado, linhas: linhas.map((l) => JSON.parse(l)) };
}

test('login falho gera uma linha de log, e essa linha não contém a senha', async () => {
  const { POST } = await import('../src/app/api/admin/login/route.js');
  const senhaTentada = 'senha-super-secreta-de-teste-12345';

  const { resultado: resposta, linhas } = await capturarStdoutAsync(() =>
    POST(
      new Request('http://localhost/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ senha: senhaTentada }),
      })
    )
  );

  assert.equal(resposta.status, 401);

  const linhaLogin = linhas.find((l) => l.msg === 'login falho');
  assert.ok(linhaLogin, 'deveria ter gerado uma linha de log para o login falho');
  assert.equal(linhaLogin.nivel, 'aviso');
  assert.equal(linhaLogin.rota, 'POST /api/admin/login');
  assert.ok(linhaLogin.ts);

  // A senha tentada não pode aparecer em lugar nenhum da linha de log.
  assert.equal(JSON.stringify(linhaLogin).includes(senhaTentada), false);
  assert.equal(Object.keys(linhaLogin).includes('senha'), false);
});

test('login bem-sucedido também gera log, sem a senha', async () => {
  const { salvarConfig } = await import('../src/lib/db.js');
  const { gerarHash } = await import('../src/lib/auth.js');

  const senhaReal = 'senha-de-teste-valida-99';
  salvarConfig({ senha_hash: await gerarHash(senhaReal) });

  const { POST } = await import('../src/app/api/admin/login/route.js');

  const { resultado: resposta, linhas } = await capturarStdoutAsync(() =>
    POST(
      new Request('http://localhost/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ senha: senhaReal }),
      })
    )
  );

  assert.equal(resposta.status, 200);

  const linhaLogin = linhas.find((l) => l.msg === 'login bem-sucedido');
  assert.ok(linhaLogin);
  assert.equal(linhaLogin.nivel, 'info');
  assert.equal(JSON.stringify(linhaLogin).includes(senhaReal), false);
});
