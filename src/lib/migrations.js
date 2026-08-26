// Migrations versionadas do schema. Cada entrada roda uma única vez, em
// ordem, dentro de uma transação — se uma migration falhar no meio, nada
// dela fica gravado. `npm run migrate` (scripts/migrate.js) é quem aplica;
// getDb() só confere se a versão do arquivo bate com a esperada (ver db.js).
//
// PRAGMA foreign_keys é desligado durante a aplicação de cada migration e
// religado depois — necessário para o procedimento de "rebuild" que várias
// delas usam (criar tabela nova com CHECK, copiar dados, dropar a antiga,
// renomear), já que SQLite não suporta ALTER TABLE ADD CONSTRAINT.

const GLOB_DATA = "[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]";
const GLOB_HORA = "[0-9][0-9]:[0-9][0-9]";

export const migrations = [
  {
    versao: 1,
    descricao: 'schema inicial',
    up(conn) {
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

        -- Controle de taxa (login e agendamento público): cada linha é uma tentativa.
        CREATE TABLE IF NOT EXISTS limitador (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          chave TEXT NOT NULL,
          criado_em TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_limitador_chave ON limitador(chave, criado_em);
      `);

      // Configurações padrão (só entram se ainda não existirem). Nome,
      // slogan e endereço começam vazios de propósito — este é um sistema
      // white-label, não vem pré-preenchido com dados de nenhum cliente.
      const padroes = {
        nome_barbearia: '',
        slogan: '',
        whatsapp: '',
        endereco: '',
        instagram: '',
        logo_url: '',
        intervalo_min: '30',
        antecedencia_min: '60',
        dias_futuros: '90',
        confirmacao_automatica: '1',
        sessao_versao: '1',
      };
      const insereConfig = conn.prepare('INSERT OR IGNORE INTO config (chave, valor) VALUES (?, ?)');
      for (const [chave, valor] of Object.entries(padroes)) insereConfig.run(chave, valor);

      // Expediente padrão: domingo fechado, seg–sex 09–20, sábado 08–18.
      // Isso é um default operacional razoável, não dado de cliente — fica.
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

      // Sem seed de barbeiros: um cliente novo cadastra a própria equipe.
    },
  },

  {
    versao: 2,
    descricao: 'adiciona coluna imagem em servicos e produtos',
    up(conn) {
      const garantirColuna = (tabela, coluna, definicao) => {
        const existe = conn
          .prepare(`PRAGMA table_info(${tabela})`)
          .all()
          .some((c) => c.name === coluna);
        if (!existe) conn.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${definicao}`);
      };
      garantirColuna('servicos', 'imagem', "TEXT NOT NULL DEFAULT ''");
      garantirColuna('produtos', 'imagem', "TEXT NOT NULL DEFAULT ''");
    },
  },

  {
    versao: 3,
    descricao: 'adiciona constraints de integridade',
    up(conn) {
      // SQLite não suporta ALTER TABLE ADD CONSTRAINT: o procedimento
      // oficial é criar uma tabela nova (já com os CHECK) sob um nome
      // temporário, copiar os dados, dropar a antiga e só então renomear a
      // nova para o nome original.
      //
      // A ordem importa: por padrão, `ALTER TABLE x RENAME TO y` também
      // reescreve as FOREIGN KEY de QUALQUER outra tabela que referencie x,
      // trocando "REFERENCES x" por "REFERENCES y" — se a tabela renomeada
      // fosse a original (ex.: servicos → servicos_antigo), servico_barbeiro
      // e agendamentos ficariam com "REFERENCES servicos_antigo" gravado
      // permanentemente, mesmo depois de servicos_antigo ser dropada.
      // Renomeando a tabela NOVA (que nada referencia ainda) para o nome
      // definitivo, esse efeito colateral não tem o que reescrever.
      conn.exec(`
        CREATE TABLE servicos_novo (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nome TEXT NOT NULL,
          descricao TEXT NOT NULL DEFAULT '',
          categoria TEXT NOT NULL DEFAULT 'Corte',
          preco_centavos INTEGER NOT NULL DEFAULT 0 CHECK (preco_centavos >= 0),
          duracao_min INTEGER NOT NULL DEFAULT 30 CHECK (duracao_min BETWEEN 5 AND 480),
          ativo INTEGER NOT NULL DEFAULT 1,
          ordem INTEGER NOT NULL DEFAULT 0,
          imagem TEXT NOT NULL DEFAULT ''
        );
        INSERT INTO servicos_novo (id, nome, descricao, categoria, preco_centavos, duracao_min, ativo, ordem, imagem)
          SELECT id, nome, descricao, categoria, preco_centavos, duracao_min, ativo, ordem, imagem FROM servicos;
        DROP TABLE servicos;
        ALTER TABLE servicos_novo RENAME TO servicos;

        CREATE TABLE produtos_novo (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nome TEXT NOT NULL,
          marca TEXT NOT NULL DEFAULT '',
          preco_centavos INTEGER NOT NULL DEFAULT 0 CHECK (preco_centavos >= 0),
          estoque INTEGER NOT NULL DEFAULT 0 CHECK (estoque >= 0),
          ativo INTEGER NOT NULL DEFAULT 1,
          imagem TEXT NOT NULL DEFAULT ''
        );
        INSERT INTO produtos_novo (id, nome, marca, preco_centavos, estoque, ativo, imagem)
          SELECT id, nome, marca, preco_centavos, estoque, ativo, imagem FROM produtos;
        DROP TABLE produtos;
        ALTER TABLE produtos_novo RENAME TO produtos;

        CREATE TABLE expediente_novo (
          dia INTEGER PRIMARY KEY CHECK (dia BETWEEN 0 AND 6),
          aberto INTEGER NOT NULL DEFAULT 1,
          abre TEXT NOT NULL DEFAULT '09:00' CHECK (abre GLOB '${GLOB_HORA}'),
          fecha TEXT NOT NULL DEFAULT '20:00' CHECK (fecha GLOB '${GLOB_HORA}'),
          CHECK (fecha > abre)
        );
        INSERT INTO expediente_novo (dia, aberto, abre, fecha)
          SELECT dia, aberto, abre, fecha FROM expediente;
        DROP TABLE expediente;
        ALTER TABLE expediente_novo RENAME TO expediente;

        CREATE TABLE bloqueios_novo (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          barbeiro_id INTEGER REFERENCES barbeiros(id) ON DELETE CASCADE,
          data TEXT NOT NULL CHECK (data GLOB '${GLOB_DATA}'),
          inicio TEXT NOT NULL CHECK (inicio GLOB '${GLOB_HORA}'),
          fim TEXT NOT NULL CHECK (fim GLOB '${GLOB_HORA}'),
          motivo TEXT NOT NULL DEFAULT '',
          CHECK (fim > inicio)
        );
        INSERT INTO bloqueios_novo (id, barbeiro_id, data, inicio, fim, motivo)
          SELECT id, barbeiro_id, data, inicio, fim, motivo FROM bloqueios;
        DROP TABLE bloqueios;
        ALTER TABLE bloqueios_novo RENAME TO bloqueios;
        CREATE INDEX IF NOT EXISTS idx_bloq_data ON bloqueios(data);

        CREATE TABLE agendamentos_novo (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          cliente_nome TEXT NOT NULL,
          cliente_telefone TEXT NOT NULL,
          barbeiro_id INTEGER REFERENCES barbeiros(id) ON DELETE SET NULL,
          servico_id INTEGER REFERENCES servicos(id) ON DELETE SET NULL,
          barbeiro_nome TEXT NOT NULL DEFAULT '',
          servico_nome TEXT NOT NULL DEFAULT '',
          data TEXT NOT NULL CHECK (data GLOB '${GLOB_DATA}'),
          inicio TEXT NOT NULL CHECK (inicio GLOB '${GLOB_HORA}'),
          fim TEXT NOT NULL CHECK (fim GLOB '${GLOB_HORA}'),
          duracao_min INTEGER NOT NULL DEFAULT 30 CHECK (duracao_min BETWEEN 5 AND 480),
          preco_centavos INTEGER NOT NULL DEFAULT 0 CHECK (preco_centavos >= 0),
          observacoes TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'confirmado', 'concluido', 'cancelado')),
          criado_em TEXT NOT NULL DEFAULT (datetime('now')),
          CHECK (fim > inicio)
        );
        INSERT INTO agendamentos_novo (id, cliente_nome, cliente_telefone, barbeiro_id, servico_id, barbeiro_nome, servico_nome, data, inicio, fim, duracao_min, preco_centavos, observacoes, status, criado_em)
          SELECT id, cliente_nome, cliente_telefone, barbeiro_id, servico_id, barbeiro_nome, servico_nome, data, inicio, fim, duracao_min, preco_centavos, observacoes, status, criado_em FROM agendamentos;
        DROP TABLE agendamentos;
        ALTER TABLE agendamentos_novo RENAME TO agendamentos;
        CREATE INDEX IF NOT EXISTS idx_ag_data ON agendamentos(data);
        CREATE INDEX IF NOT EXISTS idx_ag_barbeiro ON agendamentos(barbeiro_id, data);
      `);
    },
  },

  {
    versao: 4,
    descricao: 'índice único parcial contra agendamento duplicado',
    up(conn) {
      // Cobre a colisão exata (mesmo barbeiro, data e início) — sobreposição
      // parcial de horário continua sendo responsabilidade da aplicação.
      conn.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_ag_sem_duplicidade
          ON agendamentos(barbeiro_id, data, inicio)
          WHERE status <> 'cancelado';
      `);
    },
  },

  {
    versao: 5,
    descricao: 'soft delete de agendamentos e tabela de auditoria',
    up(conn) {
      // Coluna nova sem CHECK: ALTER TABLE ADD COLUMN é suportado direto pelo
      // SQLite (diferente de ADD CONSTRAINT) — não precisa do procedimento de
      // rebuild de tabela usado na Etapa 2.
      conn.exec(`ALTER TABLE agendamentos ADD COLUMN excluido_em TEXT`);

      // "antes"/"depois" guardam um retrato dos campos operacionais (status,
      // data, horário, ids, preço) — nunca nome ou telefone do cliente, que
      // já ficam de fora dos objetos montados em src/lib/auditoria.js.
      conn.exec(`
        CREATE TABLE IF NOT EXISTS auditoria (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          acao TEXT NOT NULL,
          tabela TEXT NOT NULL,
          registro_id INTEGER,
          antes TEXT,
          depois TEXT,
          criado_em TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_auditoria_tabela_registro ON auditoria(tabela, registro_id);
      `);
    },
  },
];

/** Maior número de versão declarado — o que o banco precisa ter para subir. */
export function versaoEsperada() {
  return migrations.reduce((max, m) => Math.max(max, m.versao), 0);
}

/** Versão atual gravada no banco — 0 quando ele nunca foi migrado. */
export function versaoDoBanco(conn) {
  const existe = conn
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'")
    .get();
  if (!existe) return 0;
  const linha = conn.prepare('SELECT versao FROM schema_version LIMIT 1').get();
  return linha ? linha.versao : 0;
}

/**
 * Aplica, em ordem, as migrations com versão maior que a atual. Cada uma
 * roda numa transação própria (tudo ou nada) com PRAGMA foreign_keys
 * desligado durante a operação — obrigatório para o rebuild de tabelas, e
 * inofensivo para as migrations que não precisam dele.
 * Devolve a lista das migrations aplicadas (vazia se já estava em dia).
 */
export function aplicarMigrations(conn) {
  conn.exec('CREATE TABLE IF NOT EXISTS schema_version (versao INTEGER NOT NULL)');

  const atual = versaoDoBanco(conn);
  const pendentes = migrations
    .filter((m) => m.versao > atual)
    .sort((a, b) => a.versao - b.versao);

  for (const migration of pendentes) {
    conn.pragma('foreign_keys = OFF');
    const aplicar = conn.transaction(() => {
      migration.up(conn);
      conn.prepare('DELETE FROM schema_version').run();
      conn.prepare('INSERT INTO schema_version (versao) VALUES (?)').run(migration.versao);
    });
    aplicar();
    conn.pragma('foreign_keys = ON');
  }

  return pendentes;
}
