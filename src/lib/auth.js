import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { lerConfig, salvarConfig } from './db';

const NOME_COOKIE = 'barbosa_admin';
const DURACAO_SEGUNDOS = 60 * 60 * 12; // 12 horas

/**
 * Em produção, exige SESSION_SECRET de verdade — sem ele, qualquer pessoa que
 * conheça o valor de desenvolvimento (documentado no próprio código-fonte)
 * conseguiria forjar um cookie de admin válido. Em desenvolvimento, o valor
 * fixo continua valendo, por conveniência.
 */
export function sessaoConfiguradaComSeguranca() {
  return Boolean(process.env.SESSION_SECRET) || process.env.NODE_ENV !== 'production';
}

function segredo() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === 'production') {
    // Não deveria chegar aqui: sessaoConfiguradaComSeguranca() barra antes,
    // em exigirSessao() e no login. Mantido como rede de segurança.
    throw new Error('SESSION_SECRET não configurado em produção.');
  }
  return 'segredo-de-desenvolvimento-troque-em-producao';
}

function assinar(valor) {
  return crypto.createHmac('sha256', segredo()).update(valor).digest('hex');
}

/** Compara duas strings sem vazar, pelo tempo de resposta, onde elas diferem. */
function iguais(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/* -------------------------------------------------------------------------
   Senha

   A senha fica no banco, guardada como hash scrypt — nem o painel nem um
   backup do arquivo revelam a senha em texto.

   Enquanto o barbeiro não tiver definido a dele, vale a do .env
   (ADMIN_PASSWORD). Isso serve para o primeiro acesso e para destravar o
   painel caso a senha se perca: apague o hash do banco e o .env volta a valer.
   ------------------------------------------------------------------------- */

export function gerarHash(senha) {
  const sal = crypto.randomBytes(16);
  const derivada = crypto.scryptSync(String(senha), sal, 64);
  return `scrypt$${sal.toString('hex')}$${derivada.toString('hex')}`;
}

function conferirHash(senha, guardado) {
  const [algoritmo, salHex, hashHex] = String(guardado).split('$');
  if (algoritmo !== 'scrypt' || !salHex || !hashHex) return false;
  const derivada = crypto.scryptSync(String(senha), Buffer.from(salHex, 'hex'), 64);
  const esperado = Buffer.from(hashHex, 'hex');
  if (derivada.length !== esperado.length) return false;
  return crypto.timingSafeEqual(derivada, esperado);
}

export function senhaConfere(tentativa) {
  const texto = String(tentativa ?? '');
  if (!texto) return false;

  const { senha_hash: guardado } = lerConfig();
  if (guardado) return conferirHash(texto, guardado);

  return iguais(texto, process.env.ADMIN_PASSWORD || 'barbosa');
}

/** True quando a senha ainda é a do .env — o painel avisa para trocar. */
export function usandoSenhaInicial() {
  return !lerConfig().senha_hash;
}

/**
 * Grava a senha nova e derruba todas as outras sessões abertas, bumpando a
 * versão que vai assinada no cookie. Quem trocou continua logado.
 */
export function trocarSenha(nova) {
  const versao = Number(lerConfig().sessao_versao || 1) + 1;
  salvarConfig({ senha_hash: gerarHash(nova), sessao_versao: String(versao) });
  criarSessao();
}

/* -------------------------------------------------------------------------
   Sessão
   ------------------------------------------------------------------------- */

/**
 * Monta o valor assinado do cookie de sessão a partir da versão e do
 * instante de expiração — extraído à parte de criarSessao() para poder ser
 * exercitado em teste sem depender do contexto de requisição do Next
 * (next/headers só funciona dentro de uma rota/Server Component de verdade).
 */
export function construirToken(versao, expiraEm) {
  const carga = `admin.${versao}.${expiraEm}`;
  return `${carga}.${assinar(carga)}`;
}

/** Nome do cookie de sessão — exportado só para uso nos testes. */
export { NOME_COOKIE };

export function criarSessao() {
  const versao = lerConfig().sessao_versao || '1';
  const expiraEm = Date.now() + DURACAO_SEGUNDOS * 1000;
  cookies().set(NOME_COOKIE, construirToken(versao, expiraEm), {
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

/** Mesma verificação de sessaoValida(), mas recebendo o token diretamente. */
export function tokenValido(token) {
  if (!token) return false;

  const partes = token.split('.');
  if (partes.length !== 4) return false;

  const [dono, versao, expiraEm, assinatura] = partes;
  const carga = `${dono}.${versao}.${expiraEm}`;

  if (!iguais(assinatura, assinar(carga))) return false;
  if (Number(expiraEm) <= Date.now()) return false;

  // Uma troca de senha invalida os cookies emitidos antes dela.
  return versao === (lerConfig().sessao_versao || '1');
}

export function sessaoValida() {
  return tokenValido(cookies().get(NOME_COOKIE)?.value);
}

/** Devolve null quando autorizado, ou uma Response de erro quando não. */
export function exigirSessao() {
  if (!sessaoConfiguradaComSeguranca()) {
    return Response.json(
      {
        erro:
          'O painel está indisponível: falta configurar SESSION_SECRET no servidor. Avise quem cuida da hospedagem.',
      },
      { status: 503 }
    );
  }
  if (sessaoValida()) return null;
  return Response.json({ erro: 'Sessão expirada. Entre novamente.' }, { status: 401 });
}
