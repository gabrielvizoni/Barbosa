import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { verificarAmbiente } from "./config-ambiente.js";
import { versaoDoBanco, versaoEsperada } from "./migrations.js";

const DB_PATH = process.env.DATABASE_PATH || "./data/app.db";

let db;

/** Abre a conexão com os pragmas de base — sem checar versão nem aplicar migrations. */
export function abrirConexao() {
  const dir = path.dirname(DB_PATH);
  if (dir && dir !== "." && !fs.existsSync(dir))
    fs.mkdirSync(dir, { recursive: true });
  const conn = new Database(DB_PATH);
  conn.pragma("journal_mode = WAL");
  conn.pragma("foreign_keys = ON");
  return conn;
}

export function getDb() {
  if (!db) {
    db = abrirConexao();

    const atual = versaoDoBanco(db);
    const esperada = versaoEsperada();
    if (atual !== esperada) {
      throw new Error(
        `Banco de dados desatualizado (versão ${atual}, esperada ${esperada}). Rode "npm run migrate" antes de iniciar o servidor.`,
      );
    }

    // Melhor não subir do que subir inseguro: em produção, um SESSION_SECRET
    // ou ADMIN_PASSWORD ainda no valor de exemplo do repositório vira uma
    // porta aberta para qualquer pessoa forjar sessão de admin.
    if (process.env.NODE_ENV === "production") {
      const problemas = verificarAmbiente();
      if (problemas.length > 0) {
        const lista = problemas.map((p) => `  - ${p}`).join("\n");
        throw new Error(
          `Configuração insegura para produção — corrija antes de continuar:\n${lista}`,
        );
      }
    }
  }
  return db;
}

export function lerConfig() {
  const linhas = getDb().prepare("SELECT chave, valor FROM config").all();
  const config = {};
  for (const { chave, valor } of linhas) config[chave] = valor;
  return config;
}

export function salvarConfig(pares) {
  const stmt = getDb().prepare(
    "INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor",
  );
  const tx = getDb().transaction((entradas) => {
    for (const [chave, valor] of entradas) stmt.run(chave, String(valor ?? ""));
  });
  tx(Object.entries(pares));
}

export function lerExpediente() {
  return getDb().prepare("SELECT * FROM expediente ORDER BY dia").all();
}

export function salvarExpediente(dias) {
  const stmt = getDb().prepare(
    "UPDATE expediente SET aberto = ?, abre = ?, fecha = ? WHERE dia = ?",
  );
  const tx = getDb().transaction((lista) => {
    for (const d of lista) stmt.run(d.aberto ? 1 : 0, d.abre, d.fecha, d.dia);
  });
  tx(dias);
}

/** Serviços com a lista de barbeiros que os executam. */
export function listarServicos({ somenteAtivos = false } = {}) {
  const conn = getDb();
  const where = somenteAtivos ? "WHERE ativo = 1" : "";
  const servicos = conn
    .prepare(`SELECT * FROM servicos ${where} ORDER BY ordem, id`)
    .all();
  const vinculos = conn
    .prepare("SELECT servico_id, barbeiro_id FROM servico_barbeiro")
    .all();
  return servicos.map((s) => ({
    ...s,
    barbeiros: vinculos
      .filter((v) => v.servico_id === s.id)
      .map((v) => v.barbeiro_id),
  }));
}

export function definirBarbeirosDoServico(servicoId, barbeiroIds) {
  const conn = getDb();
  const tx = conn.transaction(() => {
    conn
      .prepare("DELETE FROM servico_barbeiro WHERE servico_id = ?")
      .run(servicoId);
    const stmt = conn.prepare(
      "INSERT OR IGNORE INTO servico_barbeiro (servico_id, barbeiro_id) VALUES (?, ?)",
    );
    for (const id of barbeiroIds || []) stmt.run(servicoId, Number(id));
  });
  tx();
}

export function listarBarbeiros({ somenteAtivos = false } = {}) {
  const where = somenteAtivos ? "WHERE ativo = 1" : "";
  return getDb()
    .prepare(`SELECT * FROM barbeiros ${where} ORDER BY ordem, id`)
    .all();
}

export function listarProdutos({ somenteAtivos = false } = {}) {
  const where = somenteAtivos ? "WHERE ativo = 1" : "";
  return getDb()
    .prepare(`SELECT * FROM produtos ${where} ORDER BY id DESC`)
    .all();
}

export function listarBloqueios() {
  return getDb()
    .prepare(
      `SELECT b.*, bb.nome AS barbeiro_nome
       FROM bloqueios b LEFT JOIN barbeiros bb ON bb.id = b.barbeiro_id
       ORDER BY b.data DESC, b.inicio`,
    )
    .all();
}
