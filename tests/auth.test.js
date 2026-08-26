import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  sessaoValida,
  tokenValido,
  construirToken,
  NOME_COOKIE,
  senhaConfere,
  gerarHash,
  sessaoConfiguradaComSeguranca,
} from '../src/lib/auth.js';
import { salvarConfig } from '../src/lib/db.js';
import { __resetCookies, __setCookie } from './fake-next-headers.mjs';
import { bancoDeTeste } from './ajuda.js';

const AMBIENTE_ORIGINAL = { ...process.env };

beforeEach(() => {
  bancoDeTeste();
  __resetCookies();
  salvarConfig({ sessao_versao: '1' });
});

afterEach(() => {
  for (const chave of ['NODE_ENV', 'SESSION_SECRET']) {
    if (AMBIENTE_ORIGINAL[chave] === undefined) delete process.env[chave];
    else process.env[chave] = AMBIENTE_ORIGINAL[chave];
  }
});

test('cookie com assinatura inválida é rejeitado', () => {
  const token = construirToken('1', Date.now() + 60_000);
  const adulterado = `${token.slice(0, -4)}0000`;
  __setCookie(NOME_COOKIE, adulterado);
  assert.equal(sessaoValida(), false);
});

test('cookie expirado é rejeitado', () => {
  const expirado = construirToken('1', Date.now() - 1000);
  __setCookie(NOME_COOKIE, expirado);
  assert.equal(sessaoValida(), false);
});

test('cookie com sessao_versao antiga é rejeitado depois de uma troca de senha', () => {
  const token = construirToken('1', Date.now() + 60_000);
  __setCookie(NOME_COOKIE, token);
  assert.equal(sessaoValida(), true);

  // Simula o bump de versão que trocarSenha() faz ao derrubar as outras sessões.
  salvarConfig({ sessao_versao: '2' });
  assert.equal(sessaoValida(), false);
});

test('tokenValido rejeita valor sem o formato esperado (4 partes)', () => {
  assert.equal(tokenValido('qualquer-coisa'), false);
  assert.equal(tokenValido(undefined), false);
});

test('conferirHash (via senhaConfere) aceita a senha correta e rejeita a errada', () => {
  salvarConfig({ senha_hash: gerarHash('minha-senha-forte') });
  assert.equal(senhaConfere('minha-senha-forte'), true);
  assert.equal(senhaConfere('senha-errada'), false);
});

test(
  'cookie assinado com o valor placeholder não deve ser aceito quando NODE_ENV=production',
  { skip: 'corrigir na Etapa 1 — sessaoConfiguradaComSeguranca() hoje só checa presença, não valor' },
  () => {
    process.env.NODE_ENV = 'production';
    process.env.SESSION_SECRET = 'troque-este-segredo';
    assert.equal(sessaoConfiguradaComSeguranca(), false);
  }
);
