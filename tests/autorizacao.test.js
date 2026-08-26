// O teste de maior custo-benefício da bateria: garante que toda rota sob
// /api/admin/* continua fechada para quem não tem sessão. A lista abaixo é
// explícita de propósito — o teste "cobertura completa" no fim do arquivo
// falha alto se uma rota nova (ou um método novo numa rota existente) for
// esquecido aqui, em vez de vazar em silêncio.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { __resetCookies } from './fake-next-headers.mjs';
import './ajuda.js'; // garante DATABASE_PATH=':memory:' antes de qualquer getDb()

const METODOS_HTTP = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const PREFIXO = '../src/app/api/admin/';

// Toda rota aqui precisa devolver 401 sem cookie de sessão válido.
const ROTAS_PROTEGIDAS = [
  { modulo: `${PREFIXO}senha/route.js`, metodos: ['POST'], params: {} },
  { modulo: `${PREFIXO}config/route.js`, metodos: ['GET', 'PUT'], params: {} },
  { modulo: `${PREFIXO}upload/route.js`, metodos: ['POST'], params: {} },
  { modulo: `${PREFIXO}resumo/route.js`, metodos: ['GET'], params: {} },
  { modulo: `${PREFIXO}agendamentos/route.js`, metodos: ['GET', 'POST', 'PUT'], params: {} },
  {
    modulo: `${PREFIXO}agendamentos/[id]/route.js`,
    metodos: ['PATCH', 'DELETE'],
    params: { id: '1' },
  },
  {
    modulo: `${PREFIXO}[recurso]/route.js`,
    metodos: ['GET', 'POST'],
    params: { recurso: 'servicos' },
  },
  {
    modulo: `${PREFIXO}[recurso]/[id]/route.js`,
    metodos: ['PATCH', 'DELETE'],
    params: { recurso: 'servicos', id: '1' },
  },
];

// Rotas que INTENCIONALMENTE não passam por exigirSessao() — cada uma precisa
// estar aqui ou na lista acima. Se um dia faltar nas duas, o teste de
// cobertura completa, no fim do arquivo, aponta o esquecimento.
const ROTAS_PUBLICAS_INTENCIONAIS = [
  { modulo: `${PREFIXO}login/route.js`, metodos: ['POST'], motivo: 'é o próprio endpoint de login' },
  {
    modulo: `${PREFIXO}sessao/route.js`,
    metodos: ['GET'],
    motivo:
      'usada pelo frontend para checar se há sessão ativa; responde 200 com { autenticado: false } em vez de 401, por design',
  },
  {
    modulo: `${PREFIXO}logout/route.js`,
    metodos: ['POST'],
    motivo: 'ação idempotente e sem dado sensível — encerrar uma sessão inexistente não deveria falhar',
  },
];

beforeEach(() => {
  __resetCookies();
});

for (const rota of ROTAS_PROTEGIDAS) {
  for (const metodo of rota.metodos) {
    test(`${metodo} ${rota.modulo.replace(PREFIXO, '/api/admin/')} responde 401 sem sessão`, async () => {
      const handlers = await import(rota.modulo);
      const handler = handlers[metodo];
      assert.ok(typeof handler === 'function', `rota não exporta ${metodo}`);

      const resposta = await handler(new Request('http://localhost/x', { method: metodo }), {
        params: rota.params,
      });
      assert.equal(resposta.status, 401);
    });
  }
}

test('nenhuma rota expõe um método HTTP fora do que está declarado neste arquivo', async () => {
  for (const rota of [...ROTAS_PROTEGIDAS, ...ROTAS_PUBLICAS_INTENCIONAIS]) {
    const handlers = await import(rota.modulo);
    const expostos = METODOS_HTTP.filter((m) => typeof handlers[m] === 'function').sort();
    assert.deepEqual(
      expostos,
      [...rota.metodos].sort(),
      `métodos exportados por ${rota.modulo} não batem com os declarados aqui`
    );
  }
});

test('toda rota sob /api/admin/* está coberta por este arquivo', () => {
  const dirAdmin = path.join(process.cwd(), 'src', 'app', 'api', 'admin');
  const reais = fs
    .readdirSync(dirAdmin, { recursive: true })
    .filter((f) => f.endsWith('route.js'))
    .map((f) => f.split(path.sep).join('/'));

  const listadas = new Set(
    [...ROTAS_PROTEGIDAS, ...ROTAS_PUBLICAS_INTENCIONAIS].map((r) => r.modulo.replace(PREFIXO, ''))
  );

  const faltando = reais.filter((r) => !listadas.has(r));
  assert.deepEqual(
    faltando,
    [],
    `rota(s) nova(s) sem cobertura no teste de autorização: ${faltando.join(', ')}`
  );
});
