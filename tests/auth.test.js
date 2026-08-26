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
  senhaInicialConfiguradaComSeguranca,
} from '../src/lib/auth.js';
import { salvarConfig } from '../src/lib/db.js';
import { obterIp } from '../src/lib/limitador.js';
import { __resetCookies, __setCookie } from './fake-next-headers.mjs';
import { bancoDeTeste, requisicao } from './ajuda.js';

const AMBIENTE_ORIGINAL = { ...process.env };

beforeEach(() => {
  bancoDeTeste();
  __resetCookies();
  salvarConfig({ sessao_versao: '1' });
});

afterEach(() => {
  for (const chave of ['NODE_ENV', 'SESSION_SECRET', 'ADMIN_PASSWORD', 'TRUST_PROXY']) {
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

test('conferirHash (via senhaConfere) aceita a senha correta e rejeita a errada', async () => {
  salvarConfig({ senha_hash: await gerarHash('minha-senha-forte') });
  assert.equal(await senhaConfere('minha-senha-forte'), true);
  assert.equal(await senhaConfere('senha-errada'), false);
});

test('cookie assinado com o valor placeholder não deve ser aceito quando NODE_ENV=production', () => {
  process.env.NODE_ENV = 'production';
  process.env.SESSION_SECRET = 'troque-este-segredo';
  assert.equal(sessaoConfiguradaComSeguranca(), false);
});

test('SESSION_SECRET curto (menos de 32 caracteres) é rejeitado em produção', () => {
  process.env.NODE_ENV = 'production';
  process.env.SESSION_SECRET = 'a'.repeat(31);
  assert.equal(sessaoConfiguradaComSeguranca(), false);
});

test('senha rejeitada quando ADMIN_PASSWORD ausente (sem senha própria, em produção)', async () => {
  process.env.NODE_ENV = 'production';
  delete process.env.ADMIN_PASSWORD;
  assert.equal(senhaInicialConfiguradaComSeguranca(), false);
  // Sem senha_hash no banco (beforeEach não define uma) e sem ADMIN_PASSWORD válido:
  // nenhuma senha deveria ser aceita, nem uma vazia nem qualquer outra.
  assert.equal(await senhaConfere('qualquer-coisa'), false);
});

test('senha rejeitada quando ADMIN_PASSWORD é o placeholder do .env.example, em produção', async () => {
  process.env.NODE_ENV = 'production';
  process.env.ADMIN_PASSWORD = 'troque-esta-senha';
  assert.equal(await senhaConfere('troque-esta-senha'), false);
});

test('rate limit: X-Forwarded-For forjado é ignorado quando TRUST_PROXY não está definido', () => {
  delete process.env.TRUST_PROXY;
  const requisicaoForjada = requisicao('http://localhost/api/admin/login', { method: 'POST' });
  requisicaoForjada.headers.set('x-forwarded-for', '1.2.3.4');
  assert.equal(obterIp(requisicaoForjada), 'sem-ip');
});

test('rate limit: X-Forwarded-For só é usado quando TRUST_PROXY=1', () => {
  process.env.TRUST_PROXY = '1';
  const requisicaoComProxy = requisicao('http://localhost/api/admin/login', { method: 'POST' });
  requisicaoComProxy.headers.set('x-forwarded-for', '1.2.3.4, 5.6.7.8');
  assert.equal(obterIp(requisicaoComProxy), '1.2.3.4');
});
