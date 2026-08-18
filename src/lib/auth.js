import crypto from 'node:crypto';
import { cookies } from 'next/headers';

const NOME_COOKIE = 'barbosa_admin';
const DURACAO_SEGUNDOS = 60 * 60 * 12; // 12 horas

function segredo() {
  return process.env.SESSION_SECRET || 'segredo-de-desenvolvimento-troque-em-producao';
}

function senhaCorreta() {
  return process.env.ADMIN_PASSWORD || 'barbosa';
}

function assinar(valor) {
  return crypto.createHmac('sha256', segredo()).update(valor).digest('hex');
}

/** Compara duas strings em tempo constante. */
function iguais(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function senhaConfere(tentativa) {
  return iguais(String(tentativa || ''), senhaCorreta());
}

export function criarSessao() {
  const expiraEm = Date.now() + DURACAO_SEGUNDOS * 1000;
  const payload = `admin.${expiraEm}`;
  const token = `${payload}.${assinar(payload)}`;
  cookies().set(NOME_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: DURACAO_SEGUNDOS,
  });
}

export function encerrarSessao() {
  cookies().set(NOME_COOKIE, '', { path: '/', maxAge: 0 });
}

export function sessaoValida() {
  const token = cookies().get(NOME_COOKIE)?.value;
  if (!token) return false;
  const partes = token.split('.');
  if (partes.length !== 3) return false;
  const [dono, expiraEm, assinatura] = partes;
  const payload = `${dono}.${expiraEm}`;
  if (!iguais(assinatura, assinar(payload))) return false;
  return Number(expiraEm) > Date.now();
}

/** Devolve null quando autorizado, ou uma Response 401 quando não. */
export function exigirSessao() {
  if (sessaoValida()) return null;
  return Response.json({ erro: 'Sessão expirada. Entre novamente.' }, { status: 401 });
}
