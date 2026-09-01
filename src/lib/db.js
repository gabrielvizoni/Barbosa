import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { verificarAmbiente } from "./config-ambiente.js";
import { versaoDoBanco, versaoEsperada } from "./migrations.js";
import { registrarAuditoria } from "./auditoria.js";

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

/** Os 7 dias de expediente de um profissional, em ordem (0 = domingo). */
export function lerExpedienteBarbeiro(barbeiroId) {
  return getDb()
    .prepare(
      "SELECT dia, aberto, abre, fecha FROM expediente_barbeiro WHERE barbeiro_id = ? ORDER BY dia",
    )
    .all(barbeiroId);
}

/** Grava o expediente semanal de um profissional — UPSERT por (barbeiro, dia). */
export function salvarExpedienteBarbeiro(barbeiroId, dias) {
  const stmt = getDb().prepare(
    `INSERT INTO expediente_barbeiro (barbeiro_id, dia, aberto, abre, fecha)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(barbeiro_id, dia)
       DO UPDATE SET aberto = excluded.aberto, abre = excluded.abre, fecha = excluded.fecha`,
  );
  const tx = getDb().transaction((lista) => {
    for (const d of lista)
      stmt.run(barbeiroId, d.dia, d.aberto ? 1 : 0, d.abre, d.fecha);
  });
  tx(dias);
}

/** Dias da semana (0 = domingo) em que o profissional tem folga recorrente. */
export function listarFolgasRecorrentes(barbeiroId) {
  return getDb()
    .prepare(
      "SELECT dia_semana FROM folgas_recorrentes WHERE barbeiro_id = ? ORDER BY dia_semana",
    )
    .all(barbeiroId)
    .map((f) => f.dia_semana);
}

/** Substitui todas as folgas recorrentes de um profissional pela lista informada. */
export function definirFolgasRecorrentes(barbeiroId, diasSemana) {
  const conn = getDb();
  const unicos = [...new Set((diasSemana || []).map(Number))].filter(
    (d) => Number.isInteger(d) && d >= 0 && d <= 6,
  );
  const tx = conn.transaction(() => {
    conn
      .prepare("DELETE FROM folgas_recorrentes WHERE barbeiro_id = ?")
      .run(barbeiroId);
    const stmt = conn.prepare(
      "INSERT INTO folgas_recorrentes (barbeiro_id, dia_semana) VALUES (?, ?)",
    );
    for (const dia of unicos) stmt.run(barbeiroId, dia);
  });
  tx();
}

/**
 * Resumo do expediente para o site público: a união dos profissionais
 * ativos. Um dia da semana é "aberto" se ao menos um profissional ativo
 * atende nele (e não está de folga recorrente); a faixa exibida vai do menor
 * `abre` ao maior `fecha` entre eles. Mantém o formato `{ dia, aberto, abre,
 * fecha }` que `resumirExpediente()` na página inicial espera.
 */
export function expedienteResumoPublico() {
  return getDb()
    .prepare(
      `SELECT eb.dia,
              MAX(CASE WHEN eb.aberto = 1 AND fr.dia_semana IS NULL THEN 1 ELSE 0 END) AS aberto,
              MIN(CASE WHEN eb.aberto = 1 AND fr.dia_semana IS NULL THEN eb.abre END) AS abre,
              MAX(CASE WHEN eb.aberto = 1 AND fr.dia_semana IS NULL THEN eb.fecha END) AS fecha
       FROM expediente_barbeiro eb
       JOIN barbeiros b ON b.id = eb.barbeiro_id AND b.ativo = 1
       LEFT JOIN folgas_recorrentes fr
         ON fr.barbeiro_id = eb.barbeiro_id AND fr.dia_semana = eb.dia
       GROUP BY eb.dia
       ORDER BY eb.dia`,
    )
    .all()
    .map((r) => ({
      dia: r.dia,
      aberto: r.aberto,
      abre: r.abre ?? "09:00",
      fecha: r.fecha ?? "20:00",
    }));
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

// Nunca inclui `senha_hash`, `email`, `login_ativo`, `papel` nem
// `sessao_versao`: esta é a listagem que alimenta o site público (página
// inicial e /api/public) — inclusive quando passada como prop de um Server
// Component para um Client Component, o que serializa o objeto inteiro no
// payload enviado ao navegador. Ver listarBarbeirosAdmin() para o painel.
const COLUNAS_BARBEIRO_PUBLICAS = "id, nome, funcao, bio, foto, ativo, ordem";

export function listarBarbeiros({ somenteAtivos = false } = {}) {
  const where = somenteAtivos ? "WHERE ativo = 1" : "";
  return getDb()
    .prepare(
      `SELECT ${COLUNAS_BARBEIRO_PUBLICAS} FROM barbeiros ${where} ORDER BY ordem, id`,
    )
    .all();
}

/** Mesma listagem, com as colunas de login que só o painel pode ver — nunca `senha_hash`. */
export function listarBarbeirosAdmin({ somenteAtivos = false } = {}) {
  const where = somenteAtivos ? "WHERE ativo = 1" : "";
  return getDb()
    .prepare(
      `SELECT ${COLUNAS_BARBEIRO_PUBLICAS}, email, login_ativo, papel FROM barbeiros ${where} ORDER BY ordem, id`,
    )
    .all();
}

export function buscarBarbeiroPorId(id) {
  return getDb().prepare("SELECT * FROM barbeiros WHERE id = ?").get(id);
}

export function buscarBarbeiroPorEmail(email) {
  const texto = String(email ?? "").trim();
  if (!texto) return undefined;
  return getDb()
    .prepare("SELECT * FROM barbeiros WHERE lower(email) = lower(?)")
    .get(texto);
}

/** True quando já existe um admin com login definido — condição de saída do modo bootstrap. */
export function existeAdminComSenha() {
  return Boolean(
    getDb()
      .prepare(
        "SELECT 1 FROM barbeiros WHERE papel = 'admin' AND senha_hash <> '' LIMIT 1",
      )
      .get(),
  );
}

/** Bootstrap: cria um barbeiro novo já como admin, com login definido. */
export function criarBarbeiroAdmin({ nome, email, senhaHash }) {
  const { n: ordem } = getDb()
    .prepare("SELECT COALESCE(MAX(ordem), 0) + 1 AS n FROM barbeiros")
    .get();
  const resultado = getDb()
    .prepare(
      `INSERT INTO barbeiros (nome, email, senha_hash, papel, ativo, ordem)
       VALUES (?, ?, ?, 'admin', 1, ?)`,
    )
    .run(nome, email, senhaHash, ordem);
  return Number(resultado.lastInsertRowid);
}

/** Bootstrap: promove um barbeiro já cadastrado a admin, definindo o login dele. */
export function promoverBarbeiroAAdmin(id, { email, senhaHash }) {
  return getDb()
    .prepare(
      "UPDATE barbeiros SET email = ?, senha_hash = ?, papel = 'admin' WHERE id = ?",
    )
    .run(email, senhaHash, id).changes;
}

/**
 * Define e-mail e/ou senha de um barbeiro (troca própria ou reset) — sempre
 * derruba as sessões abertas dele (bump em sessao_versao), mesmo quando só
 * um dos dois campos é enviado.
 */
export function definirLoginBarbeiro(id, { email, senhaHash } = {}) {
  const campos = [];
  const valores = [];
  if (email !== undefined) {
    campos.push("email = ?");
    valores.push(email);
  }
  if (senhaHash !== undefined) {
    campos.push("senha_hash = ?");
    valores.push(senhaHash);
  }
  campos.push("sessao_versao = sessao_versao + 1");
  valores.push(id);
  return getDb()
    .prepare(`UPDATE barbeiros SET ${campos.join(", ")} WHERE id = ?`)
    .run(...valores).changes;
}

/** Token de reset: expira_em é calculado pelo próprio SQLite, para bater exatamente com o formato de datetime('now') usado na comparação (ver buscarTokenResetValido). */
export function criarTokenReset({ barbeiroId, tokenHash, minutos, ip }) {
  const resultado = getDb()
    .prepare(
      `INSERT INTO reset_senha_tokens (barbeiro_id, token_hash, expira_em, ip_solicitante)
       VALUES (?, ?, datetime('now', ?), ?)`,
    )
    .run(barbeiroId, tokenHash, `+${minutos} minutes`, ip || "");
  return Number(resultado.lastInsertRowid);
}

/** Só devolve o token se ainda não foi usado e ainda não expirou — nunca diferencia os dois motivos para quem chama. */
export function buscarTokenResetValido(tokenHash) {
  return getDb()
    .prepare(
      `SELECT * FROM reset_senha_tokens
       WHERE token_hash = ? AND usado_em IS NULL AND expira_em > datetime('now')`,
    )
    .get(tokenHash);
}

export function marcarTokenResetUsado(id) {
  getDb()
    .prepare(
      "UPDATE reset_senha_tokens SET usado_em = datetime('now') WHERE id = ?",
    )
    .run(id);
}

export function apagarTokensResetPendentes(barbeiroId) {
  getDb()
    .prepare(
      "DELETE FROM reset_senha_tokens WHERE barbeiro_id = ? AND usado_em IS NULL",
    )
    .run(barbeiroId);
}

/* -------------------------------------------------------------------------
   Conta do cliente (migration 8)
   ------------------------------------------------------------------------- */

export function buscarClientePorId(id) {
  return getDb().prepare("SELECT * FROM clientes WHERE id = ?").get(id);
}

/** Só acha por e-mail preenchido — contas anonimizadas (email = '') nunca casam. */
export function buscarClientePorEmail(email) {
  const texto = String(email ?? "").trim();
  if (!texto) return undefined;
  return getDb()
    .prepare(
      "SELECT * FROM clientes WHERE email <> '' AND lower(email) = lower(?)",
    )
    .get(texto);
}

export function criarCliente({ nome, telefone, email, senhaHash }) {
  const resultado = getDb()
    .prepare(
      `INSERT INTO clientes (nome, telefone, email, senha_hash)
       VALUES (?, ?, ?, ?)`,
    )
    .run(nome, telefone, email, senhaHash);
  return Number(resultado.lastInsertRowid);
}

/** Atualiza campos não sensíveis (nome, telefone) — e-mail e senha têm fluxo próprio. */
export function atualizarCliente(id, { nome, telefone } = {}) {
  const campos = [];
  const valores = [];
  if (nome !== undefined) {
    campos.push("nome = ?");
    valores.push(nome);
  }
  if (telefone !== undefined) {
    campos.push("telefone = ?");
    valores.push(telefone);
  }
  if (campos.length === 0) return 0;
  valores.push(id);
  return getDb()
    .prepare(`UPDATE clientes SET ${campos.join(", ")} WHERE id = ?`)
    .run(...valores).changes;
}

/**
 * Define e-mail e/ou senha de um cliente (troca própria ou reset) — sempre
 * derruba as sessões abertas dele (bump em sessao_versao), mesmo quando só
 * um dos dois campos é enviado. Espelha definirLoginBarbeiro().
 */
export function definirLoginCliente(id, { email, senhaHash } = {}) {
  const campos = [];
  const valores = [];
  if (email !== undefined) {
    campos.push("email = ?");
    valores.push(email);
  }
  if (senhaHash !== undefined) {
    campos.push("senha_hash = ?");
    valores.push(senhaHash);
  }
  campos.push("sessao_versao = sessao_versao + 1");
  valores.push(id);
  return getDb()
    .prepare(`UPDATE clientes SET ${campos.join(", ")} WHERE id = ?`)
    .run(...valores).changes;
}

/**
 * Exclusão a pedido do cliente (RF-19 / RN-44): anonimiza em vez de apagar.
 * Zera os dados pessoais da conta E o retrato (nome/telefone) nos
 * agendamentos daquele cliente — o financeiro (serviço, profissional, data,
 * valor, status) fica intacto. Sobe sessao_versao para derrubar qualquer
 * sessão aberta. A auditoria só registra o id, nunca os dados apagados.
 */
export function anonimizarCliente(id) {
  const conn = getDb();
  const tx = conn.transaction(() => {
    conn
      .prepare(
        `UPDATE agendamentos
         SET cliente_nome = 'Cliente removido', cliente_telefone = ''
         WHERE cliente_id = ?`,
      )
      .run(id);
    conn
      .prepare(
        `UPDATE clientes
         SET nome = '', telefone = '', email = '', senha_hash = '',
             sessao_versao = sessao_versao + 1,
             anonimizado_em = datetime('now')
         WHERE id = ?`,
      )
      .run(id);
    registrarAuditoria(conn, {
      acao: "anonimizar",
      tabela: "clientes",
      registroId: id,
    });
  });
  tx();
}

/** Token de reset do cliente — mesma técnica do reset do barbeiro (só o hash é guardado). */
export function criarTokenResetCliente({ clienteId, tokenHash, minutos, ip }) {
  const resultado = getDb()
    .prepare(
      `INSERT INTO cliente_reset_tokens (cliente_id, token_hash, expira_em, ip_solicitante)
       VALUES (?, ?, datetime('now', ?), ?)`,
    )
    .run(clienteId, tokenHash, `+${minutos} minutes`, ip || "");
  return Number(resultado.lastInsertRowid);
}

export function buscarTokenResetClienteValido(tokenHash) {
  return getDb()
    .prepare(
      `SELECT * FROM cliente_reset_tokens
       WHERE token_hash = ? AND usado_em IS NULL AND expira_em > datetime('now')`,
    )
    .get(tokenHash);
}

export function marcarTokenResetClienteUsado(id) {
  getDb()
    .prepare(
      "UPDATE cliente_reset_tokens SET usado_em = datetime('now') WHERE id = ?",
    )
    .run(id);
}

export function apagarTokensResetClientePendentes(clienteId) {
  getDb()
    .prepare(
      "DELETE FROM cliente_reset_tokens WHERE cliente_id = ? AND usado_em IS NULL",
    )
    .run(clienteId);
}

/**
 * Lista para a seção Clientes do painel: cada cliente com métricas
 * derivadas. `recorrente` = 2+ atendimentos `concluido` (RN-51).
 */
export function listarClientesAdmin({ busca = "" } = {}) {
  const termo = String(busca).trim();
  const condicoes = ["c.anonimizado_em IS NULL"];
  const valores = [];
  if (termo) {
    condicoes.push("(c.nome LIKE ? OR c.email LIKE ? OR c.telefone LIKE ?)");
    valores.push(`%${termo}%`, `%${termo}%`, `%${termo.replace(/\D/g, "")}%`);
  }
  return getDb()
    .prepare(
      `SELECT c.id, c.nome, c.telefone, c.email, c.criado_em,
              COUNT(a.id) AS total_agendamentos,
              SUM(CASE WHEN a.status = 'concluido' THEN 1 ELSE 0 END) AS concluidos
       FROM clientes c
       LEFT JOIN agendamentos a
         ON a.cliente_id = c.id AND a.excluido_em IS NULL
       WHERE ${condicoes.join(" AND ")}
       GROUP BY c.id
       ORDER BY c.nome COLLATE NOCASE`,
    )
    .all(...valores)
    .map((c) => ({
      ...c,
      recorrente: (c.concluidos || 0) >= 2,
    }));
}

/** Ficha de um cliente para o painel: dados, histórico e métricas. */
export function fichaClienteAdmin(id) {
  const conn = getDb();
  const cliente = conn
    .prepare(
      "SELECT id, nome, telefone, email, criado_em, anonimizado_em FROM clientes WHERE id = ?",
    )
    .get(id);
  if (!cliente) return null;

  const agendamentos = conn
    .prepare(
      `SELECT id, servico_nome, barbeiro_nome, data, inicio, fim,
              preco_centavos, status
       FROM agendamentos
       WHERE cliente_id = ? AND excluido_em IS NULL
       ORDER BY data DESC, inicio DESC`,
    )
    .all(id);

  const concluidos = agendamentos.filter((a) => a.status === "concluido");
  const cancelados = agendamentos.filter((a) => a.status === "cancelado");
  const totalGastoCentavos = concluidos.reduce(
    (soma, a) => soma + (a.preco_centavos || 0),
    0,
  );

  const contagemServico = {};
  for (const a of concluidos) {
    contagemServico[a.servico_nome] =
      (contagemServico[a.servico_nome] || 0) + 1;
  }
  const servicoMaisFrequente =
    Object.entries(contagemServico).sort((x, y) => y[1] - x[1])[0]?.[0] || null;

  return {
    cliente,
    agendamentos,
    metricas: {
      totalAgendamentos: agendamentos.length,
      concluidos: concluidos.length,
      cancelados: cancelados.length,
      recorrente: concluidos.length >= 2,
      totalGastoCentavos,
      servicoMaisFrequente,
      primeiraVisita: agendamentos.length
        ? agendamentos[agendamentos.length - 1].data
        : null,
      ultimaVisita: agendamentos.length ? agendamentos[0].data : null,
    },
  };
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
