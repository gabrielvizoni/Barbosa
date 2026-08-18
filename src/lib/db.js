import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = process.env.DATABASE_PATH || './data/barbosa.db';

let db;

function migrate(conn) {
  conn.pragma('journal_mode = WAL');
  conn.pragma('foreign_keys = ON');

  conn.exec(`
    CREATE TABLE IF NOT EXISTS config (
      chave TEXT PRIMARY KEY,
      valor TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS expediente (
      dia INTEGER PRIMARY KEY,          -- 0 = domingo ... 6 = sábado
      aberto INTEGER NOT NULL DEFAULT 1,
      abre TEXT NOT NULL DEFAULT '09:00',
      fecha TEXT NOT NULL DEFAULT '20:00'
    );

    CREATE TABLE IF NOT EXISTS barbeiros (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      funcao TEXT NOT NULL DEFAULT '',
      bio TEXT NOT NULL DEFAULT '',
      foto TEXT NOT NULL DEFAULT '',
      ativo INTEGER NOT NULL DEFAULT 1,
      ordem INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS servicos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      descricao TEXT NOT NULL DEFAULT '',
      categoria TEXT NOT NULL DEFAULT 'Corte',
      preco_centavos INTEGER NOT NULL DEFAULT 0,
      duracao_min INTEGER NOT NULL DEFAULT 30,
      ativo INTEGER NOT NULL DEFAULT 1,
      ordem INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS servico_barbeiro (
      servico_id INTEGER NOT NULL REFERENCES servicos(id) ON DELETE CASCADE,
      barbeiro_id INTEGER NOT NULL REFERENCES barbeiros(id) ON DELETE CASCADE,
      PRIMARY KEY (servico_id, barbeiro_id)
    );

    CREATE TABLE IF NOT EXISTS produtos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      marca TEXT NOT NULL DEFAULT '',
      preco_centavos INTEGER NOT NULL DEFAULT 0,
      estoque INTEGER NOT NULL DEFAULT 0,
      ativo INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS bloqueios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      barbeiro_id INTEGER REFERENCES barbeiros(id) ON DELETE CASCADE,
      data TEXT NOT NULL,               -- AAAA-MM-DD
      inicio TEXT NOT NULL,             -- HH:MM
      fim TEXT NOT NULL,                -- HH:MM
      motivo TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS agendamentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_nome TEXT NOT NULL,
      cliente_telefone TEXT NOT NULL,
      barbeiro_id INTEGER REFERENCES barbeiros(id) ON DELETE SET NULL,
      servico_id INTEGER REFERENCES servicos(id) ON DELETE SET NULL,
      barbeiro_nome TEXT NOT NULL DEFAULT '',
      servico_nome TEXT NOT NULL DEFAULT '',
      data TEXT NOT NULL,
      inicio TEXT NOT NULL,
      fim TEXT NOT NULL,
      duracao_min INTEGER NOT NULL DEFAULT 30,
      preco_centavos INTEGER NOT NULL DEFAULT 0,
      observacoes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pendente',
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_ag_data ON agendamentos(data);
    CREATE INDEX IF NOT EXISTS idx_ag_barbeiro ON agendamentos(barbeiro_id, data);
    CREATE INDEX IF NOT EXISTS idx_bloq_data ON bloqueios(data);
  `);

  // Configurações padrão (só entram se ainda não existirem)
  const padroes = {
    nome_barbearia: 'The Barbosa Barbearia',
    slogan: 'Tradição, precisão e estilo. Onde cada detalhe é tratado com a seriedade que você merece.',
    whatsapp: '',
    endereco: 'Maringá, Paraná — Brasil',
    instagram: '',
    intervalo_min: '30',
    antecedencia_min: '60',
    dias_futuros: '30',
    confirmacao_automatica: '1',
    sessao_versao: '1',
  };
  const insereConfig = conn.prepare('INSERT OR IGNORE INTO config (chave, valor) VALUES (?, ?)');
  for (const [chave, valor] of Object.entries(padroes)) insereConfig.run(chave, valor);

  // Expediente padrão: domingo fechado, seg–sex 09–20, sábado 08–18
  const insereDia = conn.prepare(
    'INSERT OR IGNORE INTO expediente (dia, aberto, abre, fecha) VALUES (?, ?, ?, ?)'
  );
  const semana = [
    [0, 0, '09:00', '18:00'],
    [1, 1, '09:00', '20:00'],
    [2, 1, '09:00', '20:00'],
    [3, 1, '09:00', '20:00'],
    [4, 1, '09:00', '20:00'],
    [5, 1, '09:00', '20:00'],
    [6, 1, '08:00', '18:00'],
  ];
  for (const dia of semana) insereDia.run(...dia);

  // Os dois barbeiros da casa entram já cadastrados; serviços começam vazios.
  const total = conn.prepare('SELECT COUNT(*) AS n FROM barbeiros').get().n;
  if (total === 0) {
    const insereBarbeiro = conn.prepare(
      'INSERT INTO barbeiros (nome, funcao, bio, ativo, ordem) VALUES (?, ?, ?, 1, ?)'
    );
    insereBarbeiro.run(
      'Heitor Lampa',
      'Barbeiro',
      'Cortes clássicos, navalha e acabamento na régua.',
      1
    );
    insereBarbeiro.run(
      'Ana Donegá',
      'Barbeira',
      'Degradê, cortes modernos e tratamento capilar.',
      2
    );
  }
}

export function getDb() {
  if (!db) {
    const dir = path.dirname(DB_PATH);
    if (dir && dir !== '.' && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    db = new Database(DB_PATH);
    migrate(db);
  }
  return db;
}

export function lerConfig() {
  const linhas = getDb().prepare('SELECT chave, valor FROM config').all();
  const config = {};
  for (const { chave, valor } of linhas) config[chave] = valor;
  return config;
}

export function salvarConfig(pares) {
  const stmt = getDb().prepare(
    'INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor'
  );
  const tx = getDb().transaction((entradas) => {
    for (const [chave, valor] of entradas) stmt.run(chave, String(valor ?? ''));
  });
  tx(Object.entries(pares));
}

export function lerExpediente() {
  return getDb().prepare('SELECT * FROM expediente ORDER BY dia').all();
}

export function salvarExpediente(dias) {
  const stmt = getDb().prepare(
    'UPDATE expediente SET aberto = ?, abre = ?, fecha = ? WHERE dia = ?'
  );
  const tx = getDb().transaction((lista) => {
    for (const d of lista) stmt.run(d.aberto ? 1 : 0, d.abre, d.fecha, d.dia);
  });
  tx(dias);
}

/** Serviços com a lista de barbeiros que os executam. */
export function listarServicos({ somenteAtivos = false } = {}) {
  const conn = getDb();
  const where = somenteAtivos ? 'WHERE ativo = 1' : '';
  const servicos = conn.prepare(`SELECT * FROM servicos ${where} ORDER BY ordem, id`).all();
  const vinculos = conn.prepare('SELECT servico_id, barbeiro_id FROM servico_barbeiro').all();
  return servicos.map((s) => ({
    ...s,
    barbeiros: vinculos.filter((v) => v.servico_id === s.id).map((v) => v.barbeiro_id),
  }));
}

export function definirBarbeirosDoServico(servicoId, barbeiroIds) {
  const conn = getDb();
  const tx = conn.transaction(() => {
    conn.prepare('DELETE FROM servico_barbeiro WHERE servico_id = ?').run(servicoId);
    const stmt = conn.prepare(
      'INSERT OR IGNORE INTO servico_barbeiro (servico_id, barbeiro_id) VALUES (?, ?)'
    );
    for (const id of barbeiroIds || []) stmt.run(servicoId, Number(id));
  });
  tx();
}

export function listarBarbeiros({ somenteAtivos = false } = {}) {
  const where = somenteAtivos ? 'WHERE ativo = 1' : '';
  return getDb().prepare(`SELECT * FROM barbeiros ${where} ORDER BY ordem, id`).all();
}

export function listarProdutos({ somenteAtivos = false } = {}) {
  const where = somenteAtivos ? 'WHERE ativo = 1' : '';
  return getDb().prepare(`SELECT * FROM produtos ${where} ORDER BY id DESC`).all();
}

export function listarBloqueios() {
  return getDb()
    .prepare(
      `SELECT b.*, bb.nome AS barbeiro_nome
       FROM bloqueios b LEFT JOIN barbeiros bb ON bb.id = b.barbeiro_id
       ORDER BY b.data DESC, b.inicio`
    )
    .all();
}
