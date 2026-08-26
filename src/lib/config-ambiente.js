import fs from "node:fs";
import path from "node:path";
import { lerConfig } from "./db.js";

const TAMANHO_MINIMO_SEGREDO = 32;

// Mesma lista para SESSION_SECRET e ADMIN_PASSWORD: o que importa aqui não é
// o significado do valor, é que ele seja um dos exemplos publicados no
// próprio repositório (.env.example) — quem não trocou continua com um
// valor que qualquer pessoa lendo o código também conhece.
const PLACEHOLDERS_CONHECIDOS = new Set([
  "troque-este-segredo",
  "troque-esta-senha",
  "changeme",
  "secret",
  "segredo-de-desenvolvimento-troque-em-producao",
]);

function ehPlaceholder(valor) {
  return PLACEHOLDERS_CONHECIDOS.has(
    String(valor ?? "")
      .trim()
      .toLowerCase(),
  );
}

/** True quando o valor serve para assinar sessões: presente, comprido e não é um exemplo. */
export function segredoDeSessaoValido(valor) {
  return (
    Boolean(valor) &&
    String(valor).length >= TAMANHO_MINIMO_SEGREDO &&
    !ehPlaceholder(valor)
  );
}

/** True quando o valor serve como senha inicial do painel: presente e não é um exemplo. */
export function senhaInicialValida(valor) {
  return Boolean(valor) && !ehPlaceholder(valor);
}

/** Confere se dá para ler/escrever num diretório sem criar nada nele. */
export function diretorioGravavel(caminho) {
  try {
    const alvo = fs.existsSync(caminho)
      ? caminho
      : path.dirname(caminho) || ".";
    fs.accessSync(alvo, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Lista os problemas de configuração encontrados no ambiente — vazia quando
 * está tudo certo. Não lança nada sozinha: quem chama decide o que fazer com
 * a lista (ver getDb(), que recusa subir em produção se ela não vier vazia).
 */
export function verificarAmbiente() {
  const problemas = [];

  const segredo = process.env.SESSION_SECRET;
  if (!segredo) {
    problemas.push("SESSION_SECRET não está definido.");
  } else if (segredo.length < TAMANHO_MINIMO_SEGREDO) {
    problemas.push(
      `SESSION_SECRET tem menos de ${TAMANHO_MINIMO_SEGREDO} caracteres.`,
    );
  } else if (ehPlaceholder(segredo)) {
    problemas.push(
      "SESSION_SECRET está com um valor de exemplo do .env.example — gere um valor aleatório.",
    );
  }

  if (!lerConfig().senha_hash) {
    const senha = process.env.ADMIN_PASSWORD;
    if (!senha) {
      problemas.push(
        "ADMIN_PASSWORD não está definido e ainda não existe senha própria cadastrada.",
      );
    } else if (ehPlaceholder(senha)) {
      problemas.push(
        "ADMIN_PASSWORD está com um valor de exemplo do .env.example — defina uma senha real.",
      );
    }
  }

  const dirBanco = path.dirname(process.env.DATABASE_PATH || "./data/app.db");
  if (!diretorioGravavel(dirBanco)) {
    problemas.push(`Diretório do banco (${dirBanco}) não é gravável.`);
  }

  const dirUploads = path.join(process.cwd(), "public", "uploads");
  if (!diretorioGravavel(dirUploads)) {
    problemas.push(`Diretório de uploads (${dirUploads}) não é gravável.`);
  }

  return problemas;
}
