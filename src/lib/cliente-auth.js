// Conta do cliente do site. Espelha src/lib/auth.js (sessão HMAC, scrypt,
// tokens de recuperação), mas para a pessoa que agenda — não para a equipe.
// Reaproveita as primitivas de cripto do auth.js; o que muda é a tabela
// (`clientes`), o cookie (`cliente_sessao`) e a duração da sessão.
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { conferirHash, gerarHash, HASH_DUMMY, iguais, segredo } from "./auth";
import {
  apagarTokensResetClientePendentes,
  atualizarCliente,
  buscarClientePorEmail,
  buscarClientePorId,
  buscarTokenResetClienteValido,
  criarCliente,
  criarTokenResetCliente,
  definirLoginCliente,
  marcarTokenResetClienteUsado,
} from "./db";
import { somenteDigitos, telefoneValido } from "./format";
import { emailValido } from "./validacao";

const NOME_COOKIE = "cliente_sessao";
// A conta do cliente não acessa dado sensível de terceiros como o painel
// (RN-41 são 12 h só para a equipe). Um site de agendamento de consumidor
// mantém a pessoa logada por bastante tempo, para não pedir senha a cada
// visita — 30 dias, renovado a cada login.
const DURACAO_SEGUNDOS = 60 * 60 * 24 * 30;
const MINUTOS_EXPIRACAO_RESET = 30;
const SENHA_MINIMA = 6;

export { NOME_COOKIE };

function assinar(valor) {
  return crypto.createHmac("sha256", segredo()).update(valor).digest("hex");
}

function opcoesCookie() {
  return {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DURACAO_SEGUNDOS,
  };
}

/** Valor assinado do cookie — extraído à parte para poder ser exercitado em teste. */
export function construirTokenCliente(clienteId, versao, expiraEm) {
  const carga = `cliente.${clienteId}.${versao}.${expiraEm}`;
  return `${carga}.${assinar(carga)}`;
}

export function criarSessaoCliente(clienteId) {
  const cliente = buscarClientePorId(clienteId);
  const versao = String(cliente?.sessao_versao ?? 1);
  const expiraEm = Date.now() + DURACAO_SEGUNDOS * 1000;
  cookies().set(
    NOME_COOKIE,
    construirTokenCliente(clienteId, versao, expiraEm),
    opcoesCookie(),
  );
}

export function encerrarSessaoCliente() {
  cookies().set(NOME_COOKIE, "", { path: "/", maxAge: 0 });
}

/**
 * Decodifica e valida um token de sessão de cliente. Devolve null quando
 * inválido, ou `{ clienteId, nome, email }`. Uma conta anonimizada
 * (`anonimizado_em` preenchido) nunca tem sessão válida — a exclusão sobe
 * `sessao_versao`, mas a checagem explícita abaixo é cinturão e suspensórios.
 */
export function decodificarSessaoCliente(token) {
  if (!token) return null;
  const partes = token.split(".");
  if (partes.length !== 5 || partes[0] !== "cliente") return null;

  const [dono, idTexto, versao, expiraEm, assinatura] = partes;
  const carga = `${dono}.${idTexto}.${versao}.${expiraEm}`;
  if (!iguais(assinatura, assinar(carga))) return null;
  if (Number(expiraEm) <= Date.now()) return null;

  const cliente = buscarClientePorId(Number(idTexto));
  if (!cliente || cliente.anonimizado_em) return null;
  if (versao !== String(cliente.sessao_versao)) return null;

  return {
    clienteId: cliente.id,
    nome: cliente.nome,
    email: cliente.email,
    telefone: cliente.telefone,
  };
}

export function sessaoClienteAtual() {
  return decodificarSessaoCliente(cookies().get(NOME_COOKIE)?.value);
}

export function sessaoClienteValida() {
  return sessaoClienteAtual() !== null;
}

const METODOS_MUTACAO = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Devolve null quando a requisição tem sessão de cliente válida, ou uma
 * Response de erro quando não. Mesma checagem de Origin (CSRF) do painel:
 * uma mutação vinda de outro host é bloqueada.
 */
export function exigirSessaoCliente(request) {
  if (!sessaoClienteValida()) {
    return Response.json(
      { erro: "Entre na sua conta para continuar." },
      { status: 401 },
    );
  }

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

  return null;
}

/* -------------------------------------------------------------------------
   Cadastro e autenticação
   ------------------------------------------------------------------------- */

/**
 * Cria a conta. Valida nome, telefone (10–11 dígitos), e-mail e senha
 * (mín. 6). Devolve `{ ok: true, clienteId }` ou `{ ok: false, erro }`.
 */
export async function cadastrarCliente({ nome, telefone, email, senha }) {
  const nomeLimpo = String(nome ?? "")
    .trim()
    .slice(0, 80);
  if (nomeLimpo.length < 2) return { ok: false, erro: "Escreva seu nome." };

  const tel = somenteDigitos(telefone);
  if (!telefoneValido(tel)) {
    return { ok: false, erro: "Informe um WhatsApp com DDD." };
  }

  const emailLimpo = String(email ?? "")
    .trim()
    .toLowerCase();
  const erroEmail = emailValido(emailLimpo);
  if (!emailLimpo || erroEmail) {
    return { ok: false, erro: erroEmail || "Informe o e-mail." };
  }

  if (String(senha ?? "").length < SENHA_MINIMA) {
    return {
      ok: false,
      erro: `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`,
    };
  }

  const senhaHash = await gerarHash(senha);
  try {
    const id = criarCliente({
      nome: nomeLimpo,
      telefone: tel,
      email: emailLimpo,
      senhaHash,
    });
    return { ok: true, clienteId: id };
  } catch (e) {
    if (String(e?.code ?? "").startsWith("SQLITE_CONSTRAINT")) {
      return { ok: false, erro: "Esse e-mail já tem conta." };
    }
    throw e;
  }
}

/**
 * Autentica pelo e-mail. Sempre roda o scrypt contra ALGUM hash (o real ou
 * o dummy) antes de responder — e-mail inexistente, conta anonimizada e
 * senha errada levam o mesmo tempo, para não vazar por timing quais
 * e-mails têm conta.
 */
export async function autenticarCliente(email, senha) {
  const texto = String(senha ?? "");
  const cliente = buscarClientePorEmail(email);

  if (!cliente || cliente.anonimizado_em || !cliente.senha_hash) {
    await conferirHash(texto || " ", HASH_DUMMY);
    return { ok: false };
  }

  const confere = await conferirHash(texto, cliente.senha_hash);
  if (!confere) return { ok: false };

  return { ok: true, cliente };
}

/** Troca a própria senha (exige a atual) — deixa quem trocou logado, na versão nova. */
export async function trocarSenhaCliente(clienteId, senhaAtual, novaSenha) {
  const cliente = buscarClientePorId(clienteId);
  if (!cliente) return { ok: false, erro: "Conta não encontrada." };

  const confere = await conferirHash(
    String(senhaAtual ?? ""),
    cliente.senha_hash || HASH_DUMMY,
  );
  if (!confere) return { ok: false, erro: "A senha atual está incorreta." };

  if (String(novaSenha ?? "").length < SENHA_MINIMA) {
    return {
      ok: false,
      erro: `A senha nova precisa ter pelo menos ${SENHA_MINIMA} caracteres.`,
    };
  }

  definirLoginCliente(clienteId, { senhaHash: await gerarHash(novaSenha) });
  criarSessaoCliente(clienteId);
  return { ok: true };
}

/** Troca o próprio e-mail (exige a senha atual — igual ao painel). */
export async function trocarEmailCliente(clienteId, senhaAtual, novoEmail) {
  const cliente = buscarClientePorId(clienteId);
  if (!cliente) return { ok: false, erro: "Conta não encontrada." };

  const confere = await conferirHash(
    String(senhaAtual ?? ""),
    cliente.senha_hash || HASH_DUMMY,
  );
  if (!confere) return { ok: false, erro: "A senha atual está incorreta." };

  const email = String(novoEmail ?? "")
    .trim()
    .toLowerCase();
  const erroEmail = emailValido(email);
  if (!email || erroEmail) {
    return { ok: false, erro: erroEmail || "Informe o e-mail." };
  }

  try {
    definirLoginCliente(clienteId, { email });
  } catch (e) {
    if (String(e?.code ?? "").startsWith("SQLITE_CONSTRAINT")) {
      return { ok: false, erro: "Esse e-mail já está em uso." };
    }
    throw e;
  }
  criarSessaoCliente(clienteId);
  return { ok: true };
}

/** Atualiza nome e telefone (não exige senha; e-mail e senha têm fluxo próprio). */
export function atualizarDadosCliente(clienteId, { nome, telefone }) {
  const campos = {};
  if (nome !== undefined) {
    const n = String(nome).trim().slice(0, 80);
    if (n.length < 2) return { ok: false, erro: "Escreva seu nome." };
    campos.nome = n;
  }
  if (telefone !== undefined) {
    const t = somenteDigitos(telefone);
    if (!telefoneValido(t)) {
      return { ok: false, erro: "Informe um WhatsApp com DDD." };
    }
    campos.telefone = t;
  }
  if (Object.keys(campos).length === 0) {
    return { ok: false, erro: "Nada para salvar." };
  }
  atualizarCliente(clienteId, campos);
  return { ok: true };
}

/* -------------------------------------------------------------------------
   Token de recuperação de senha
   ------------------------------------------------------------------------- */

/** Gera um token de alta entropia, guarda só o hash (sha256) e devolve o bruto. */
export function gerarTokenResetCliente(clienteId, ip) {
  const bruto = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(bruto).digest("hex");
  criarTokenResetCliente({
    clienteId,
    tokenHash,
    minutos: MINUTOS_EXPIRACAO_RESET,
    ip,
  });
  return bruto;
}

/**
 * Consome um token: se válido (existe, não usado, não expirado), grava a
 * senha nova, marca o token como usado, apaga os pendentes do mesmo cliente
 * e derruba as sessões dele (bump de `sessao_versao` dentro de
 * definirLoginCliente). Nunca diferencia inexistente/expirado/já usado.
 */
export async function consumirTokenResetCliente(tokenBruto, novaSenha) {
  if (String(novaSenha ?? "").length < SENHA_MINIMA) {
    return { ok: false };
  }
  const tokenHash = crypto
    .createHash("sha256")
    .update(String(tokenBruto ?? ""))
    .digest("hex");
  const registro = buscarTokenResetClienteValido(tokenHash);
  if (!registro) return { ok: false };

  definirLoginCliente(registro.cliente_id, {
    senhaHash: await gerarHash(novaSenha),
  });
  marcarTokenResetClienteUsado(registro.id);
  apagarTokensResetClientePendentes(registro.cliente_id);

  return { ok: true, clienteId: registro.cliente_id };
}
