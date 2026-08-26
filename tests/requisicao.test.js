import { test } from 'node:test';
import assert from 'node:assert/strict';

import { lerCorpoJson } from '../src/lib/requisicao.js';

test('corpo vazio vira objeto vazio, não erro', async () => {
  const req = new Request('http://localhost/x', { method: 'POST' });
  assert.deepEqual(await lerCorpoJson(req), {});
});

test('JSON válido é parseado normalmente', async () => {
  const req = new Request('http://localhost/x', {
    method: 'POST',
    body: JSON.stringify({ a: 1, b: 'texto' }),
  });
  assert.deepEqual(await lerCorpoJson(req), { a: 1, b: 'texto' });
});

test('JSON malformado devolve undefined, distinto de corpo vazio', async () => {
  const req = new Request('http://localhost/x', { method: 'POST', body: '{isso não é json' });
  assert.equal(await lerCorpoJson(req), undefined);
});
