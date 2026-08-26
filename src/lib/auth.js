import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { cookies } from 'next/headers';
import { lerConfig, salvarConfig } from './db';
import { segredoDeSessaoValido, senhaInicialValida } from './config-ambiente';

const scrypt = promisify(crypto.scrypt);

const NOME_COOKIE = 'barbosa_admin';
const DURACAO_SEGUNDOS = 60 * 60 * 12; // 12 horas

/**
 * Em produção, exige um SESSION_SECRET de verdade: presente, com pelo menos
 * 32 caracteres e diferente de qualquer valor de exemplo publicado no
 * repositório — sem isso, qualquer pessoa que leia o .env.example consegue
 * forjar um cookie de admin válido. Em desenvolvimento, o segredo fixo abaixo
 * continua valendo, por conveniência.
 */
export function sessaoConfiguradaComSeguranca() {
  return segredoDeSessaoValido(process.env.SESSION_SECRET) || process.env.NODE_ENV !== 'production';
}

/**
 * Mesma ideia, para a senha inicial: em produção, ADMIN_PASSWORD precisa
 * estar definido e não ser um dos valores de exemplo do .env.example. Só
 * importa enquanto ninguém cadastrou uma senha própria — depois disso o
 * .env deixa de valer (ver senhaConfere()).
 */
export function senhaInicialConfiguradaComSeguranca() {
  return senhaInicialValida(process.env.ADMIN_PASSWORD) || process.env.NODE_ENV !== 'production';
}

/** As duas checagens acima juntas — usada para decidir se o login pode nem tentar. */
export function autenticacaoConfiguradaComSeguranca() {
  if (!sessaoConfiguradaComSeguranca()) return false;
  if (usandoSenhaInicial() && !senhaInicialConfiguradaComSeguranca()) return false;
  return true;
}

const MENSAGEM_CONFIGURACAO_INSEGURA =
  'O painel está indisponível: falta configurar o servidor com segurança (SESSION_SECRET/ADMIN_PASSWORD). Avise quem cuida da hospedagem.';

function segredo() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === 'production') {
    // Não deveria chegar aqui: autenticacaoConfiguradaComSeguranca() barra
    // antes, em exigirSessao() e no login. Mantido como rede de segurança.
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
   painel caso a senha se perca: apague o hash do banco e o .env volta a valer
   — desde que ADMIN_PASSWORD esteja configurado com segurança (ver acima).
   ------------------------------------------------------------------------- */

// scrypt síncrono trava o único thread do Node por ~100ms a cada tentativa —
// sob carga de login isso derruba o site inteiro. Os parâmetros de custo vão
// gravados no próprio hash (formato `scrypt$N$r$p$sal$hash`) para poder
// mudar no futuro sem invalidar senha já definida.
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_TAMANHO_CHAVE = 64;

export async function gerarHash(senha) {
  const sal = crypto.randomBytes(16);
  const derivada = await scrypt(String(senha), sal, SCRYPT_TAMANHO_CHAVE, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${sal.toString('hex')}$${derivada.toString('hex')}`;
}

async function conferirHash(senha, guardado) {
  const partes = String(guardado).split('$');
  let algoritmo;
  let n;
  let r;
  let p;
  let salHex;
  let hashHex;

  if (partes.length === 6) {
    [algoritmo, n, r, p, salHex, hashHex] = partes;
    n = Number(n);
    r = Number(r);
    p = Number(p);
  } else if (partes.length === 3) {
    // Formato antigo (scrypt$sal$hash, sem os parâmetros de custo) — mantido
    // só para não invalidar a senha de quem já rodava o sistema antes desta
    // correção. Os parâmetros eram sempre os mesmos, hoje nomeados acima.
    [algoritmo, salHex, hashHex] = partes;
    n = SCRYPT_N;
    r = SCRYPT_R;
    p = SCRYPT_P;
  } else {
    return false;
  }

  if (algoritmo !== 'scrypt' || !salHex || !hashHex || !Number.isFinite(n)) return false;

  const esperado = Buffer.from(hashHex, 'hex');
  const derivada = await scrypt(String(senha), Buffer.from(salHex, 'hex'), esperado.length, {
    N: n,
    r,
    p,
  });
  if (derivada.length !== esperado.length) return false;
  return crypto.timingSafeEqual(derivada, esperado);
}

export async function senhaConfere(tentativa) {
  const texto = String(tentativa ?? '');
  if (!texto) return false;

  const { senha_hash: guardado } = lerConfig();
  if (guardado) return conferirHash(texto, guardado);

  // Sem senha própria cadastrada ainda: só aceita a do .env quando ela está
  // configurada com segurança — nunca um valor hardcoded no código-fonte.
  if (!senhaInicialConfiguradaComSeguranca()) return false;
  return iguais(texto, process.env.ADMIN_PASSWORD);
}

/** True quando a senha ainda é a do .env — o painel avisa para trocar. */
export function usandoSenhaInicial() {
  return !lerConfig().senha_hash;
}

/**
 * Grava a senha nova e derruba todas as outras sessões abertas, bumpando a
 * versão que vai assinada no cookie. Quem trocou continua logado.
 */
export async function trocarSenha(nova) {
  const versao = Number(lerConfig().sessao_versao || 1) + 1;
  salvarConfig({ senha_hash: await gerarHash(nova), sessao_versao: String(versao) });
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
    // Não existe fluxo do painel vindo de fora do próprio site — 'strict' não
    // quebra nada aqui e fecha a porta pra CSRF via navegação/formulário externo.
    sameSite: 'strict',
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

const METODOS_MUTACAO = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Enquanto a senha ainda é a inicial (a do .env), o painel só deixa trocar a
// senha e ler a configuração — o resto responde 403. A trava visual no
// frontend (PainelAdmin.jsx) continua existindo, mas quem decide é aqui.
function rotaPermitidaComSenhaInicial(request) {
  const { pathname } = new URL(request.url);
  if (pathname === '/api/admin/senha') return true;
  if (pathname === '/api/admin/config' && request.method === 'GET') return true;
  return false;
}

/** Devolve null quando autorizado, ou uma Response de erro quando não. */
export function exigirSessao(request) {
  if (!autenticacaoConfiguradaComSeguranca()) {
    return Response.json({ erro: MENSAGEM_CONFIGURACAO_INSEGURA }, { status: 503 });
  }
  if (!sessaoValida()) {
    return Response.json({ erro: 'Sessão expirada. Entre novamente.' }, { status: 401 });
  }

  // CSRF: uma mutação de fora do próprio site sempre manda Origin — quando
  // vem e não bate com o host da requisição, é bloqueada. Quando não vem
  // (cliente não-navegador, ou navegador antigo em same-origin), deixa
  // passar; sameSite=strict no cookie já cobre a maior parte do risco.
  if (request && METODOS_MUTACAO.has(request.method)) {
    const origem = request.headers.get('origin');
    const host = request.headers.get('host');
    if (origem && host) {
      let hostDaOrigem = null;
      try {
        hostDaOrigem = new URL(origem).host;
      } catch {
        hostDaOrigem = null;
      }
      if (hostDaOrigem !== host) {
        return Response.json({ erro: 'Origem não permitida.' }, { status: 403 });
      }
    }
  }

  if (request && usandoSenhaInicial() && !rotaPermitidaComSenhaInicial(request)) {
    return Response.json(
      { erro: 'Troque a senha inicial antes de continuar usando o painel.' },
      { status: 403 }
    );
  }

  return null;
}
