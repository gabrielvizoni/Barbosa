import crypto from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import {
  lerConfig,
  salvarConfig,
  buscarBarbeiroPorId,
  buscarBarbeiroPorEmail,
  existeAdminComSenha,
  criarBarbeiroAdmin,
  promoverBarbeiroAAdmin,
  definirLoginBarbeiro,
  criarTokenReset,
  buscarTokenResetValido,
  marcarTokenResetUsado,
  apagarTokensResetPendentes,
} from "./db";
import { segredoDeSessaoValido, senhaInicialValida } from "./config-ambiente";

const scrypt = promisify(crypto.scrypt);

const NOME_COOKIE = "admin_sessao";
const DURACAO_SEGUNDOS = 60 * 60 * 12; // 12 horas
const MINUTOS_EXPIRACAO_RESET = 30;

/**
 * Em produção, exige um SESSION_SECRET de verdade: presente, com pelo menos
 * 32 caracteres e diferente de qualquer valor de exemplo publicado no
 * repositório — sem isso, qualquer pessoa que leia o .env.example consegue
 * forjar um cookie de admin válido. Em desenvolvimento, o segredo fixo abaixo
 * continua valendo, por conveniência.
 */
export function sessaoConfiguradaComSeguranca() {
  return (
    segredoDeSessaoValido(process.env.SESSION_SECRET) ||
    process.env.NODE_ENV !== "production"
  );
}

/**
 * Mesma ideia, para a senha de bootstrap: em produção, ADMIN_PASSWORD
 * precisa estar definido e não ser um dos valores de exemplo do
 * .env.example. Só importa enquanto o bootstrap não foi concluído — depois
 * disso o .env deixa de valer (ver senhaBootstrapConfere()).
 */
export function senhaInicialConfiguradaComSeguranca() {
  return (
    senhaInicialValida(process.env.ADMIN_PASSWORD) ||
    process.env.NODE_ENV !== "production"
  );
}

/** As duas checagens acima juntas — usada para decidir se o login pode nem tentar. */
export function autenticacaoConfiguradaComSeguranca() {
  if (!sessaoConfiguradaComSeguranca()) return false;
  if (modoBootstrap() && !senhaInicialConfiguradaComSeguranca()) return false;
  return true;
}

const MENSAGEM_CONFIGURACAO_INSEGURA =
  "O painel está indisponível: falta configurar o servidor com segurança (SESSION_SECRET/ADMIN_PASSWORD). Avise quem cuida da hospedagem.";

export function segredo() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === "production") {
    // Não deveria chegar aqui: autenticacaoConfiguradaComSeguranca() barra
    // antes, em exigirSessao() e no login. Mantido como rede de segurança.
    throw new Error("SESSION_SECRET não configurado em produção.");
  }
  return "segredo-de-desenvolvimento-troque-em-producao";
}

function assinar(valor) {
  return crypto.createHmac("sha256", segredo()).update(valor).digest("hex");
}

/** Compara duas strings sem vazar, pelo tempo de resposta, onde elas diferem. */
export function iguais(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/* -------------------------------------------------------------------------
   Senha (hash)

   scrypt síncrono trava o único thread do Node por ~100ms a cada tentativa —
   sob carga de login isso derruba o site inteiro. Os parâmetros de custo vão
   gravados no próprio hash (formato `scrypt$N$r$p$sal$hash`) para poder
   mudar no futuro sem invalidar senha já definida.
   ------------------------------------------------------------------------- */

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
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${sal.toString("hex")}$${derivada.toString("hex")}`;
}

export async function conferirHash(senha, guardado) {
  const partes = String(guardado).split("$");
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

  if (algoritmo !== "scrypt" || !salHex || !hashHex || !Number.isFinite(n))
    return false;

  const esperado = Buffer.from(hashHex, "hex");
  const derivada = await scrypt(
    String(senha),
    Buffer.from(salHex, "hex"),
    esperado.length,
    {
      N: n,
      r,
      p,
    },
  );
  if (derivada.length !== esperado.length) return false;
  return crypto.timingSafeEqual(derivada, esperado);
}

// Hash formatado, com os mesmos parâmetros de custo de gerarHash(), mas com
// sal e derivada fixos (nunca corresponde a nenhuma senha real). Usado só
// para rodar o scrypt contra ALGO quando o e-mail não existe ou o barbeiro
// não tem senha própria ainda — sem isso, autenticarBarbeiro() responderia
// bem mais rápido para e-mails desconhecidos do que para incorretos,
// revelando por timing quais e-mails têm conta no painel.
export const HASH_DUMMY = `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${"00".repeat(16)}$${"00".repeat(SCRYPT_TAMANHO_CHAVE)}`;

/* -------------------------------------------------------------------------
   Senha de bootstrap (a única, compartilhada, do modo transitório)

   Fica em config.senha_hash — hash scrypt, nunca a senha em texto. Enquanto
   ninguém completou o bootstrap (ver modoBootstrap()), vale a senha do .env
   (ADMIN_PASSWORD): serve para o primeiro acesso e para destravar o painel
   caso a senha se perca (apague o hash do banco e o .env volta a valer) —
   desde que ADMIN_PASSWORD esteja configurado com segurança (ver acima).
   ------------------------------------------------------------------------- */

export async function senhaBootstrapConfere(tentativa) {
  const texto = String(tentativa ?? "");
  if (!texto) return false;

  const { senha_hash: guardado } = lerConfig();
  if (guardado) return conferirHash(texto, guardado);

  if (!senhaInicialConfiguradaComSeguranca()) return false;
  return iguais(texto, process.env.ADMIN_PASSWORD);
}

/**
 * Grava a senha de bootstrap nova e derruba as outras sessões de bootstrap
 * abertas, bumpando config.sessao_versao. Sem efeito nas sessões já
 * autenticadas como barbeiro (essas usam barbeiros.sessao_versao).
 */
export async function trocarSenhaBootstrap(nova) {
  const versao = Number(lerConfig().sessao_versao || 1) + 1;
  salvarConfig({
    senha_hash: await gerarHash(nova),
    sessao_versao: String(versao),
  });
  criarSessao();
}

/* -------------------------------------------------------------------------
   Login individual por barbeiro
   ------------------------------------------------------------------------- */

/** True enquanto não existir nenhum barbeiro admin com login já definido — condição de saída do bootstrap. */
export function modoBootstrap() {
  return !existeAdminComSenha();
}

/**
 * Autentica um barbeiro pelo e-mail. Sempre roda o scrypt contra ALGUM hash
 * (o real ou o dummy) antes de responder — e-mail inexistente, login
 * desativado e senha errada devem levar o mesmo tempo, para não vazar por
 * timing quais e-mails têm conta.
 */
export async function autenticarBarbeiro(email, senha) {
  const texto = String(senha ?? "");
  const barbeiro = buscarBarbeiroPorEmail(email);

  if (!barbeiro || !barbeiro.login_ativo) {
    await conferirHash(texto || " ", HASH_DUMMY);
    return { ok: false };
  }

  const confere = await conferirHash(texto, barbeiro.senha_hash || HASH_DUMMY);
  if (!confere) return { ok: false };

  return { ok: true, barbeiro };
}

/** Troca a própria senha (exige a atual) — deixa quem trocou logado, com uma sessão já na versão nova. */
export async function trocarSenhaPropria(barbeiroId, senhaAtual, novaSenha) {
  const barbeiro = buscarBarbeiroPorId(barbeiroId);
  if (!barbeiro) return { ok: false, erro: "Barbeiro não encontrado." };

  const confere = await conferirHash(
    String(senhaAtual ?? ""),
    barbeiro.senha_hash || HASH_DUMMY,
  );
  if (!confere) return { ok: false, erro: "A senha atual está incorreta." };

  definirLoginBarbeiro(barbeiroId, { senhaHash: await gerarHash(novaSenha) });
  criarSessaoBarbeiro(barbeiroId);
  return { ok: true };
}

/**
 * Troca o próprio e-mail (exige a senha atual) — sem isso, uma sessão
 * sequestrada poderia redirecionar em silêncio a recuperação de senha para
 * um e-mail que o atacante controla.
 */
export async function trocarEmailProprio(barbeiroId, senhaAtual, novoEmail) {
  const barbeiro = buscarBarbeiroPorId(barbeiroId);
  if (!barbeiro) return { ok: false, erro: "Barbeiro não encontrado." };

  const confere = await conferirHash(
    String(senhaAtual ?? ""),
    barbeiro.senha_hash || HASH_DUMMY,
  );
  if (!confere) return { ok: false, erro: "A senha atual está incorreta." };

  const email = String(novoEmail ?? "")
    .trim()
    .toLowerCase();
  try {
    definirLoginBarbeiro(barbeiroId, { email });
  } catch (e) {
    if (String(e?.code ?? "").startsWith("SQLITE_CONSTRAINT")) {
      return { ok: false, erro: "Esse e-mail já está em uso." };
    }
    throw e;
  }
  criarSessaoBarbeiro(barbeiroId);
  return { ok: true };
}

/**
 * Conclui o bootstrap: cria (sem barbeiroId) ou promove (com barbeiroId) o
 * primeiro admin com login definido. Bumpa config.sessao_versao — cinturão e
 * suspensórios além de tokenValido() já rejeitar qualquer token de bootstrap
 * assim que modoBootstrap() vira false, independente de versão.
 */
export async function concluirBootstrap({ barbeiroId, nome, email, senha }) {
  const emailNormalizado = String(email ?? "")
    .trim()
    .toLowerCase();
  const senhaHash = await gerarHash(senha);

  let id;
  try {
    if (barbeiroId) {
      const alterados = promoverBarbeiroAAdmin(barbeiroId, {
        email: emailNormalizado,
        senhaHash,
      });
      if (!alterados) return { ok: false, erro: "Barbeiro não encontrado." };
      id = barbeiroId;
    } else {
      const nomeLimpo = String(nome ?? "").trim();
      if (!nomeLimpo) return { ok: false, erro: "Informe o nome." };
      id = criarBarbeiroAdmin({
        nome: nomeLimpo,
        email: emailNormalizado,
        senhaHash,
      });
    }
  } catch (e) {
    if (String(e?.code ?? "").startsWith("SQLITE_CONSTRAINT")) {
      return { ok: false, erro: "Esse e-mail já está em uso." };
    }
    throw e;
  }

  const versao = Number(lerConfig().sessao_versao || 1) + 1;
  salvarConfig({ sessao_versao: String(versao) });

  return { ok: true, barbeiroId: id };
}

/** Gera um token de reset de alta entropia, guarda só o hash (sha256) e devolve o token bruto — nunca persistido em texto puro. */
export function gerarTokenReset(barbeiroId, ip) {
  const bruto = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(bruto).digest("hex");
  criarTokenReset({
    barbeiroId,
    tokenHash,
    minutos: MINUTOS_EXPIRACAO_RESET,
    ip,
  });
  return bruto;
}

/**
 * Consome um token de reset: se válido (existe, não usado, não expirado),
 * grava a senha nova, marca o token como usado, apaga qualquer outro token
 * pendente do mesmo barbeiro e derruba as sessões abertas dele (bump em
 * sessao_versao, dentro de definirLoginBarbeiro). Nunca diferencia, para
 * quem chama, entre token inexistente/expirado/já usado.
 */
export async function consumirTokenReset(tokenBruto, novaSenha) {
  const tokenHash = crypto
    .createHash("sha256")
    .update(String(tokenBruto ?? ""))
    .digest("hex");
  const registro = buscarTokenResetValido(tokenHash);
  if (!registro) return { ok: false };

  definirLoginBarbeiro(registro.barbeiro_id, {
    senhaHash: await gerarHash(novaSenha),
  });
  marcarTokenResetUsado(registro.id);
  apagarTokensResetPendentes(registro.barbeiro_id);

  return { ok: true, barbeiroId: registro.barbeiro_id };
}

/* -------------------------------------------------------------------------
   Sessão

   Dois formatos de cookie, distinguíveis pelo primeiro campo:
     bootstrap.<versaoGlobal>.<expiraEm>.<assinatura>
     barbeiro.<barbeiroId>.<versao>.<expiraEm>.<assinatura>
   O segundo é validado contra barbeiros.sessao_versao DAQUELE id, não mais
   um contador global — trocar a senha de um barbeiro não derruba a sessão
   dos outros.
   ------------------------------------------------------------------------- */

export { NOME_COOKIE };

function opcoesCookie() {
  return {
    httpOnly: true,
    // Não existe fluxo do painel vindo de fora do próprio site — 'strict' não
    // quebra nada aqui e fecha a porta pra CSRF via navegação/formulário externo.
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DURACAO_SEGUNDOS,
  };
}

/** Monta o valor assinado do cookie de bootstrap — extraído à parte para poder ser exercitado em teste. */
export function construirTokenBootstrap(versao, expiraEm) {
  const carga = `bootstrap.${versao}.${expiraEm}`;
  return `${carga}.${assinar(carga)}`;
}

/** Mesma ideia, para o cookie de um barbeiro autenticado. */
export function construirTokenBarbeiro(barbeiroId, versao, expiraEm) {
  const carga = `barbeiro.${barbeiroId}.${versao}.${expiraEm}`;
  return `${carga}.${assinar(carga)}`;
}

export function criarSessao() {
  const versao = lerConfig().sessao_versao || "1";
  const expiraEm = Date.now() + DURACAO_SEGUNDOS * 1000;
  cookies().set(
    NOME_COOKIE,
    construirTokenBootstrap(versao, expiraEm),
    opcoesCookie(),
  );
}

export function criarSessaoBarbeiro(barbeiroId) {
  const barbeiro = buscarBarbeiroPorId(barbeiroId);
  const versao = String(barbeiro?.sessao_versao ?? 1);
  const expiraEm = Date.now() + DURACAO_SEGUNDOS * 1000;
  cookies().set(
    NOME_COOKIE,
    construirTokenBarbeiro(barbeiroId, versao, expiraEm),
    opcoesCookie(),
  );
}

export function encerrarSessao() {
  cookies().set(NOME_COOKIE, "", { path: "/", maxAge: 0 });
}

/**
 * Decodifica e valida um token, devolvendo null quando inválido ou
 * { tipo: 'bootstrap' } | { tipo: 'barbeiro', barbeiroId, papel, nome, email }.
 * Único lugar que entende os dois formatos de cookie — tokenValido() e
 * sessaoAtual() são só fachadas em cima desta função.
 */
function decodificarSessao(token) {
  if (!token) return null;
  const partes = token.split(".");

  if (partes.length === 4 && partes[0] === "bootstrap") {
    const [dono, versao, expiraEm, assinatura] = partes;
    const carga = `${dono}.${versao}.${expiraEm}`;
    if (!iguais(assinatura, assinar(carga))) return null;
    if (Number(expiraEm) <= Date.now()) return null;
    // O bootstrap fica desativado para sempre assim que o primeiro admin é
    // criado — mesmo um cookie ainda "na versão certa" não deveria voltar a
    // valer depois disso.
    if (!modoBootstrap()) return null;
    if (versao !== (lerConfig().sessao_versao || "1")) return null;
    return { tipo: "bootstrap" };
  }

  if (partes.length === 5 && partes[0] === "barbeiro") {
    const [dono, idTexto, versao, expiraEm, assinatura] = partes;
    const carga = `${dono}.${idTexto}.${versao}.${expiraEm}`;
    if (!iguais(assinatura, assinar(carga))) return null;
    if (Number(expiraEm) <= Date.now()) return null;

    const barbeiro = buscarBarbeiroPorId(Number(idTexto));
    if (!barbeiro || !barbeiro.login_ativo) return null;
    if (versao !== String(barbeiro.sessao_versao)) return null;

    return {
      tipo: "barbeiro",
      barbeiroId: barbeiro.id,
      papel: barbeiro.papel,
      nome: barbeiro.nome,
      email: barbeiro.email,
    };
  }

  return null;
}

/** Mesma verificação de sessaoValida(), mas recebendo o token diretamente — usado nos testes. */
export function tokenValido(token) {
  return decodificarSessao(token) !== null;
}

export function sessaoValida() {
  return tokenValido(cookies().get(NOME_COOKIE)?.value);
}

/** Quem está logado agora, e como — null sem sessão válida. */
export function sessaoAtual() {
  return decodificarSessao(cookies().get(NOME_COOKIE)?.value);
}

const METODOS_MUTACAO = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Enquanto o bootstrap não foi concluído, o painel só deixa: trocar a senha
// de bootstrap, ler a configuração, listar barbeiros (para o formulário
// escolher quem vira o primeiro admin) e concluir o próprio bootstrap — todo
// o resto responde 403. A trava visual no frontend (PainelAdmin.jsx) continua
// existindo, mas quem decide é aqui.
function rotaPermitidaEmBootstrap(request) {
  const { pathname } = new URL(request.url);
  if (pathname === "/api/admin/senha") return true;
  if (pathname === "/api/admin/bootstrap") return true;
  if (pathname === "/api/admin/config" && request.method === "GET") return true;
  if (pathname === "/api/admin/barbeiros" && request.method === "GET")
    return true;
  return false;
}

/** Devolve null quando autorizado, ou uma Response de erro quando não. */
export function exigirSessao(request) {
  if (!autenticacaoConfiguradaComSeguranca()) {
    return Response.json(
      { erro: MENSAGEM_CONFIGURACAO_INSEGURA },
      { status: 503 },
    );
  }
  if (!sessaoValida()) {
    return Response.json(
      { erro: "Sessão expirada. Entre novamente." },
      { status: 401 },
    );
  }

  // CSRF: uma mutação de fora do próprio site sempre manda Origin — quando
  // vem e não bate com o host da requisição, é bloqueada. Quando não vem
  // (cliente não-navegador, ou navegador antigo em same-origin), deixa
  // passar; sameSite=strict no cookie já cobre a maior parte do risco.
  if (request && METODOS_MUTACAO.has(request.method)) {
    const origem = request.headers.get("origin");
    const host = request.headers.get("host");
    if (origem && host) {
      let hostDaOrigem = null;
      try {
        hostDaOrigem = new URL(origem).host;
      } catch {
        hostDaOrigem = null;
      }
      if (hostDaOrigem !== host) {
        return Response.json(
          { erro: "Origem não permitida." },
          { status: 403 },
        );
      }
    }
  }

  if (request && modoBootstrap() && !rotaPermitidaEmBootstrap(request)) {
    return Response.json(
      {
        erro: "Conclua a configuração inicial antes de continuar usando o painel.",
      },
      { status: 403 },
    );
  }

  return null;
}
