# 01 — Mapa do back-end (The Barbosa)

> Etapa de mapeamento. **Sem achados, sem severidade.** Só o terreno, para as
> próximas etapas terem onde pisar. O que já chamou atenção está na seção
> [Pistas para as próximas etapas](#7-pistas-para-as-próximas-etapas), sem
> classificação.

Coletado por leitura de: `src/lib/*`, `src/app/api/**`, `src/middleware.js`,
`scripts/migrate.js`, `next.config.mjs`, `package.json`, `tests/*`,
`.env.example`. `npm test` executado de verdade (resultado na seção 5).

Ambiente observado: Node `v22.23.2` (`.nvmrc` = `22`, `engines.node` =
`>=18.19.0`), `better-sqlite3` `11.10.0`, Next `^14.2.30`, React `^18.3.1`,
`sharp` `^0.35.4`. Banco em `DATABASE_PATH` ou `./data/app.db`. `data/` é
git-ignored (só `data/.gitkeep` versionado) — o banco não vai no repositório.

---

## 1. Schema real (extraído de `src/lib/migrations.js`)

O schema é definido por 5 migrations versionadas. `versaoEsperada()` = **5**.
`scripts/migrate.js` (`npm run migrate`) aplica; `getDb()` (`src/lib/db.js:26-32`)
só **verifica** `versaoDoBanco(db) === 5` e **recusa subir** se não bater. Um
arquivo de banco novo tem versão 0 → a aplicação não sobe antes de
`npm run migrate`.

Tabela de controle: **`schema_version(versao INTEGER NOT NULL)`** — uma linha,
sem PK nem UNIQUE. `aplicarMigrations()` faz `DELETE` + `INSERT` a cada
migration; `versaoDoBanco()` lê `SELECT versao FROM schema_version LIMIT 1`.

Migrations:

| Versão | Descrição                                  | Técnica                                                                                                            |
| ------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| 1      | schema inicial                             | `CREATE TABLE IF NOT EXISTS` + seed de `config` e `expediente`                                                     |
| 2      | coluna `imagem` em `servicos` e `produtos` | `ALTER TABLE ADD COLUMN` idempotente (`garantirColuna`)                                                            |
| 3      | constraints de integridade                 | rebuild de tabela (cria `*_novo` com CHECK, copia, dropa, renomeia a **nova**) — `PRAGMA foreign_keys=OFF` durante |
| 4      | anti-duplicidade                           | índice único parcial `idx_ag_sem_duplicidade`                                                                      |
| 5      | soft delete + auditoria                    | `ALTER TABLE agendamentos ADD COLUMN excluido_em`; `CREATE TABLE auditoria`                                        |

`aplicarMigrations()` roda cada migration numa transação própria (tudo ou
nada), com `foreign_keys=OFF` durante e `ON` depois.

### 1.1 Tabelas (estado final, após migration 5)

#### `config`

| Coluna  | Tipo | Constraints     |
| ------- | ---- | --------------- |
| `chave` | TEXT | **PRIMARY KEY** |
| `valor` | TEXT | NOT NULL        |

Sem CHECK. Chaves semeadas na migration 1 (só se ainda não existirem):
`nome_barbearia`, `slogan`, `whatsapp`, `endereco`, `instagram`, `logo_url`
(todas `""`), `intervalo_min='30'`, `antecedencia_min='60'`,
`dias_futuros='90'`, `confirmacao_automatica='1'`, `sessao_versao='1'`.
Chaves gravadas em runtime, sem seed: `senha_hash` (ao trocar a senha),
`onboarding_expediente_ok` (checklist de primeiros passos).
`lerConfig()` devolve tudo como um objeto `{chave: valor}` (strings).

#### `expediente` (reconstruída na migration 3)

| Coluna   | Tipo    | Constraints                                                              |
| -------- | ------- | ------------------------------------------------------------------------ |
| `dia`    | INTEGER | **PRIMARY KEY**, `CHECK (dia BETWEEN 0 AND 6)` — 0 = domingo             |
| `aberto` | INTEGER | NOT NULL DEFAULT 1                                                       |
| `abre`   | TEXT    | NOT NULL DEFAULT `'09:00'`, `CHECK (abre GLOB '[0-9][0-9]:[0-9][0-9]')`  |
| `fecha`  | TEXT    | NOT NULL DEFAULT `'20:00'`, `CHECK (fecha GLOB '[0-9][0-9]:[0-9][0-9]')` |
| —        | —       | `CHECK (fecha > abre)` (nível de tabela)                                 |

Seed: 7 linhas (dia 0..6). Dom 09–18, seg–sex 09–20, sáb 08–18. `aberto=0` no domingo? Não — o seed traz dia 0 com `aberto=0`. (linha `[0, 0, "09:00", "18:00"]`.)

#### `barbeiros`

| Coluna   | Tipo    | Constraints           |
| -------- | ------- | --------------------- |
| `id`     | INTEGER | **PK AUTOINCREMENT**  |
| `nome`   | TEXT    | NOT NULL              |
| `funcao` | TEXT    | NOT NULL DEFAULT `''` |
| `bio`    | TEXT    | NOT NULL DEFAULT `''` |
| `foto`   | TEXT    | NOT NULL DEFAULT `''` |
| `ativo`  | INTEGER | NOT NULL DEFAULT 1    |
| `ordem`  | INTEGER | NOT NULL DEFAULT 0    |

Sem CHECK. Sem seed (cliente cadastra a própria equipe).

#### `servicos` (reconstruída na migration 3; `imagem` veio da 2)

| Coluna           | Tipo    | Constraints                                                  |
| ---------------- | ------- | ------------------------------------------------------------ |
| `id`             | INTEGER | **PK AUTOINCREMENT**                                         |
| `nome`           | TEXT    | NOT NULL                                                     |
| `descricao`      | TEXT    | NOT NULL DEFAULT `''`                                        |
| `categoria`      | TEXT    | NOT NULL DEFAULT `'Corte'`                                   |
| `preco_centavos` | INTEGER | NOT NULL DEFAULT 0, `CHECK (preco_centavos >= 0)`            |
| `duracao_min`    | INTEGER | NOT NULL DEFAULT 30, `CHECK (duracao_min BETWEEN 5 AND 480)` |
| `ativo`          | INTEGER | NOT NULL DEFAULT 1                                           |
| `ordem`          | INTEGER | NOT NULL DEFAULT 0                                           |
| `imagem`         | TEXT    | NOT NULL DEFAULT `''`                                        |

Sem seed.

#### `servico_barbeiro` (**não** reconstruída na migration 3)

| Coluna        | Tipo    | Constraints                                          |
| ------------- | ------- | ---------------------------------------------------- |
| `servico_id`  | INTEGER | NOT NULL, **FK → `servicos(id)` ON DELETE CASCADE**  |
| `barbeiro_id` | INTEGER | NOT NULL, **FK → `barbeiros(id)` ON DELETE CASCADE** |
| —             | —       | **PRIMARY KEY (`servico_id`, `barbeiro_id`)**        |

As FKs continuam válidas por resolverem pelo nome da tabela (a migration 3
renomeia a tabela **nova** justamente para não reescrever "REFERENCES" nas
tabelas dependentes). `INSERT OR IGNORE` em `definirBarbeirosDoServico()`.

#### `produtos` (reconstruída na migration 3)

| Coluna           | Tipo    | Constraints                        |
| ---------------- | ------- | ---------------------------------- |
| `id`             | INTEGER | **PK AUTOINCREMENT**               |
| `nome`           | TEXT    | NOT NULL                           |
| `marca`          | TEXT    | NOT NULL DEFAULT `''`              |
| `preco_centavos` | INTEGER | NOT NULL DEFAULT 0, `CHECK (>= 0)` |
| `estoque`        | INTEGER | NOT NULL DEFAULT 0, `CHECK (>= 0)` |
| `ativo`          | INTEGER | NOT NULL DEFAULT 1                 |
| `imagem`         | TEXT    | NOT NULL DEFAULT `''`              |

#### `bloqueios` (reconstruída na migration 3)

| Coluna        | Tipo               | Constraints                                                                |
| ------------- | ------------------ | -------------------------------------------------------------------------- |
| `id`          | INTEGER            | **PK AUTOINCREMENT**                                                       |
| `barbeiro_id` | INTEGER (nullable) | **FK → `barbeiros(id)` ON DELETE CASCADE**; `NULL` = afeta todo mundo      |
| `data`        | TEXT               | NOT NULL, `CHECK (data GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')` |
| `inicio`      | TEXT               | NOT NULL, `CHECK (inicio GLOB '[0-9][0-9]:[0-9][0-9]')`                    |
| `fim`         | TEXT               | NOT NULL, `CHECK (fim GLOB '[0-9][0-9]:[0-9][0-9]')`                       |
| `motivo`      | TEXT               | NOT NULL DEFAULT `''`                                                      |
| —             | —                  | `CHECK (fim > inicio)`                                                     |

Nunca são podados (não há DELETE de bloqueio antigo em lugar nenhum do código).

#### `agendamentos` (reconstruída na migration 3; `excluido_em` veio da 5)

| Coluna             | Tipo               | Constraints                                                                                          |
| ------------------ | ------------------ | ---------------------------------------------------------------------------------------------------- |
| `id`               | INTEGER            | **PK AUTOINCREMENT**                                                                                 |
| `cliente_nome`     | TEXT               | NOT NULL                                                                                             |
| `cliente_telefone` | TEXT               | NOT NULL                                                                                             |
| `barbeiro_id`      | INTEGER (nullable) | **FK → `barbeiros(id)` ON DELETE SET NULL**                                                          |
| `servico_id`       | INTEGER (nullable) | **FK → `servicos(id)` ON DELETE SET NULL**                                                           |
| `barbeiro_nome`    | TEXT               | NOT NULL DEFAULT `''` (snapshot congelado)                                                           |
| `servico_nome`     | TEXT               | NOT NULL DEFAULT `''` (snapshot congelado)                                                           |
| `data`             | TEXT               | NOT NULL, `CHECK (data GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')`                           |
| `inicio`           | TEXT               | NOT NULL, `CHECK (inicio GLOB '[0-9][0-9]:[0-9][0-9]')`                                              |
| `fim`              | TEXT               | NOT NULL, `CHECK (fim GLOB '[0-9][0-9]:[0-9][0-9]')`                                                 |
| `duracao_min`      | INTEGER            | NOT NULL DEFAULT 30, `CHECK (BETWEEN 5 AND 480)`                                                     |
| `preco_centavos`   | INTEGER            | NOT NULL DEFAULT 0, `CHECK (>= 0)`                                                                   |
| `observacoes`      | TEXT               | NOT NULL DEFAULT `''`                                                                                |
| `status`           | TEXT               | NOT NULL DEFAULT `'pendente'`, `CHECK (status IN ('pendente','confirmado','concluido','cancelado'))` |
| `criado_em`        | TEXT               | NOT NULL DEFAULT `(datetime('now'))` — UTC                                                           |
| `excluido_em`      | TEXT (nullable)    | **sem CHECK**; `NULL` = ativo, timestamp = soft-deleted                                              |
| —                  | —                  | `CHECK (fim > inicio)`                                                                               |

#### `limitador` (rate limit; migration 1)

| Coluna      | Tipo    | Constraints                                                  |
| ----------- | ------- | ------------------------------------------------------------ |
| `id`        | INTEGER | **PK AUTOINCREMENT**                                         |
| `chave`     | TEXT    | NOT NULL (ex.: `login:<ip>`, `agendar:<ip>`, `login:global`) |
| `criado_em` | TEXT    | NOT NULL DEFAULT `(datetime('now'))` — UTC                   |

Uma linha por tentativa. Limpeza amostrada (1 %) de linhas com mais de 1 dia.

#### `auditoria` (migration 5)

| Coluna        | Tipo               | Constraints                                                                                    |
| ------------- | ------------------ | ---------------------------------------------------------------------------------------------- |
| `id`          | INTEGER            | **PK AUTOINCREMENT**                                                                           |
| `acao`        | TEXT               | NOT NULL (`criar`, `status`, `remarcar`, `excluir`, `alterar_preco`, `trocar_senha`, `salvar`) |
| `tabela`      | TEXT               | NOT NULL                                                                                       |
| `registro_id` | INTEGER (nullable) |                                                                                                |
| `antes`       | TEXT (nullable)    | JSON; só campos operacionais, nunca nome/telefone                                              |
| `depois`      | TEXT (nullable)    | JSON                                                                                           |
| `criado_em`   | TEXT               | NOT NULL DEFAULT `(datetime('now'))` — UTC                                                     |

### 1.2 Índices

| Índice                          | Tabela / colunas                                                                                                                               | Tipo              | Origem                 |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ---------------------- |
| `idx_ag_data`                   | `agendamentos(data)`                                                                                                                           | comum             | migr. 1, recriado na 3 |
| `idx_ag_barbeiro`               | `agendamentos(barbeiro_id, data)`                                                                                                              | comum             | migr. 1, recriado na 3 |
| `idx_ag_sem_duplicidade`        | `agendamentos(barbeiro_id, data, inicio)` **WHERE `status <> 'cancelado'`**                                                                    | **único parcial** | migr. 4                |
| `idx_bloq_data`                 | `bloqueios(data)`                                                                                                                              | comum             | migr. 1, recriado na 3 |
| `idx_limitador_chave`           | `limitador(chave, criado_em)`                                                                                                                  | comum             | migr. 1                |
| `idx_auditoria_tabela_registro` | `auditoria(tabela, registro_id)`                                                                                                               | comum             | migr. 5                |
| _(implícitos)_                  | PK de `config(chave)`, `expediente(dia)`, `schema_version` — sem; `servico_barbeiro(servico_id, barbeiro_id)`; rowid das tabelas AUTOINCREMENT | —                 | —                      |

### 1.3 Predicados usados no código **sem índice que os cubra**

Levantado varrendo cada `prepare(...)` em `src/lib/*` e `src/app/api/**`.
Ordenado por frequência de execução / crescimento com o tempo.

| Predicado                                                              | Onde                                                                                                                                                          | Índice existente mais próximo                                           | Efeito                                                                  |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `agendamentos.status = ?` **sozinho** (sem `data` nem `barbeiro_id`)   | `pendentes/route.js`; `resumo/route.js` (`pendentesTotal`, `geralRealizado`, `geralPrevisto`); `admin/agendamentos` GET quando só o filtro `status` é passado | nenhum em `status`                                                      | varredura completa de `agendamentos`; cresce sem limite com o histórico |
| `agendamentos` `ORDER BY criado_em DESC`                               | `resumo/route.js` (`recentes`, `LIMIT 8`)                                                                                                                     | nenhum em `criado_em`                                                   | varredura + sort de toda a tabela a cada chamada do resumo              |
| `agendamentos.servico_id = ?`                                          | `admin/[recurso]/[id]/route.js` DELETE de serviço (`COUNT(*)`)                                                                                                | `idx_ag_barbeiro` cobre `barbeiro_id`, **não** `servico_id`             | varredura completa ao excluir/desativar um serviço                      |
| `agendamentos` `ORDER BY data DESC, inicio DESC`                       | `admin/agendamentos/route.js` GET (paginação)                                                                                                                 | `idx_ag_data` cobre só o filtro `data`, não o `inicio` do `ORDER BY`    | b-tree temporária de ordenação a cada abertura da tela                  |
| `agendamentos.cliente_nome LIKE '%?%'` / `cliente_telefone LIKE '%?%'` | `admin/agendamentos/route.js` GET (busca)                                                                                                                     | nenhum                                                                  | curinga à esquerda nunca usa índice; varredura completa na busca        |
| `bloqueios` sem filtro de data, `ORDER BY data DESC, inicio`           | `db.js` `listarBloqueios()`                                                                                                                                   | `idx_bloq_data` (não ajuda sem `WHERE data`)                            | lê **todos** os bloqueios já criados, sempre; a lista só cresce         |
| `limitador.criado_em < datetime('now','-1 day')` (DELETE de limpeza)   | `limitador.js:19`                                                                                                                                             | `idx_limitador_chave(chave, criado_em)` — `criado_em` não é a 1ª coluna | varredura na limpeza (amostrada em 1 %)                                 |

Predicados **bem servidos** (para contraste): `agendamentos WHERE data=? AND
barbeiro_id=? ...` (→ `idx_ag_barbeiro`), `agendamentos WHERE data >= ? AND
data < ?` no financeiro (→ `idx_ag_data`, intervalo), `bloqueios WHERE data=?`
(→ `idx_bloq_data`), `limitador WHERE chave=? AND criado_em>=?` (→
`idx_limitador_chave`), tudo por `id`/PK.

---

## 2. Inventário de endpoints

`exige sessão?` verificado no código: "sim" = a 1ª coisa do handler é
`const negado = exigirSessao(request); if (negado) return negado;`.
Todos os handlers são embrulhados por `comLog(rota, ...)` e declaram
`export const dynamic = "force-dynamic"`.

### 2.1 Públicos (sem `exigirSessao`)

| Método | Caminho             | Arquivo                             | Exige sessão?         | Observações                                                                                                                              |
| ------ | ------------------- | ----------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/public`       | `src/app/api/public/route.js`       | **não**               | catálogo p/ o fluxo de agendamento: config pública, barbeiros ativos, serviços ativos **com ≥1 barbeiro**, `dias`, `fuso`                |
| GET    | `/api/horarios`     | `src/app/api/horarios/route.js`     | **não**               | `?barbeiro=&servico=&data=`; valida formato; 404 se serviço inativo; devolve `horariosLivres`                                            |
| POST   | `/api/agendamentos` | `src/app/api/agendamentos/route.js` | **não**               | agendamento público; rate limit `agendar:<ip>` (6 / 10 min); responde **200** (não 201)                                                  |
| GET    | `/api/health`       | `src/app/api/health/route.js`       | **não**               | `SELECT 1` + gravabilidade de `public/uploads`; 200 / 503                                                                                |
| POST   | `/api/admin/login`  | `src/app/api/admin/login/route.js`  | **não** (é o login)   | checa `autenticacaoConfiguradaComSeguranca` (503); rate limit por IP (8 / 15 min) + global (`login:global`, 50 / 15 min → bloqueia 60 s) |
| GET    | `/api/admin/sessao` | `src/app/api/admin/sessao/route.js` | **não** (por design)  | devolve `{autenticado, senhaInicial}` ou `{autenticado:false, configuracaoInsegura:true}`; **200** mesmo sem sessão                      |
| POST   | `/api/admin/logout` | `src/app/api/admin/logout/route.js` | **não** (idempotente) | `encerrarSessao()` (cookie `maxAge=0`)                                                                                                   |

### 2.2 Protegidos (`exigirSessao` na 1ª linha)

`exigirSessao` faz, em ordem: (1) `autenticacaoConfiguradaComSeguranca()` →
503; (2) `sessaoValida()` → 401; (3) se método ∈ {POST,PUT,PATCH,DELETE} e
header `Origin` presente e ≠ `Host` → 403; (4) se `usandoSenhaInicial()` e a
rota **não** é `POST /api/admin/senha` nem `GET /api/admin/config` → 403.

| Método | Caminho                        | Arquivo                                        | Exige sessão? | Liberado sob "senha inicial"?                                      |
| ------ | ------------------------------ | ---------------------------------------------- | ------------- | ------------------------------------------------------------------ |
| GET    | `/api/admin/config`            | `src/app/api/admin/config/route.js`            | sim           | **sim** (só o GET)                                                 |
| PUT    | `/api/admin/config`            | `src/app/api/admin/config/route.js`            | sim           | não (403)                                                          |
| POST   | `/api/admin/senha`             | `src/app/api/admin/senha/route.js`             | sim           | **sim** (exceção explícita)                                        |
| POST   | `/api/admin/upload`            | `src/app/api/admin/upload/route.js`            | sim           | não (403)                                                          |
| GET    | `/api/admin/resumo`            | `src/app/api/admin/resumo/route.js`            | sim           | não (403)                                                          |
| GET    | `/api/admin/pendentes`         | `src/app/api/admin/pendentes/route.js`         | sim           | não (403)                                                          |
| GET    | `/api/admin/agendamentos`      | `src/app/api/admin/agendamentos/route.js`      | sim           | não (403)                                                          |
| POST   | `/api/admin/agendamentos`      | `src/app/api/admin/agendamentos/route.js`      | sim           | não (403) — encaixe manual                                         |
| PUT    | `/api/admin/agendamentos`      | `src/app/api/admin/agendamentos/route.js`      | sim           | não (403) — horários p/ encaixe                                    |
| PATCH  | `/api/admin/agendamentos/[id]` | `src/app/api/admin/agendamentos/[id]/route.js` | sim           | não (403) — status **ou** remarcação                               |
| DELETE | `/api/admin/agendamentos/[id]` | `src/app/api/admin/agendamentos/[id]/route.js` | sim           | não (403) — soft delete                                            |
| GET    | `/api/admin/[recurso]`         | `src/app/api/admin/[recurso]/route.js`         | sim           | não (403) — `recurso` ∈ {barbeiros, servicos, produtos, bloqueios} |
| POST   | `/api/admin/[recurso]`         | `src/app/api/admin/[recurso]/route.js`         | sim           | não (403) — cria; bloqueios devolvem `atropelados`                 |
| PATCH  | `/api/admin/[recurso]/[id]`    | `src/app/api/admin/[recurso]/[id]/route.js`    | sim           | não (403) — audita `alterar_preco`                                 |
| DELETE | `/api/admin/[recurso]/[id]`    | `src/app/api/admin/[recurso]/[id]/route.js`    | sim           | não (403) — desativa se tem histórico, senão `DELETE` físico       |

Não existe PATCH/PUT/DELETE no nível da coleção `/api/admin/[recurso]`; a
mutação de um item é sempre por `/api/admin/[recurso]/[id]`.
`obterRecurso()` usa `Object.hasOwn` (evita `constructor`/`toString` etc.).

### 2.3 Middleware

`src/middleware.js` roda em `/((?!_next/static|_next/image|favicon.ico).*)` —
ou seja, **inclui todas as rotas `/api/*`**. Por requisição: gera `nonce`
(`crypto.randomUUID()`), injeta `x-nonce` no request, e põe na resposta
`Content-Security-Policy` (com `nonce` + `strict-dynamic`; `'unsafe-eval'`
só fora de produção), `X-Frame-Options: DENY`, `X-Content-Type-Options:
nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
`Strict-Transport-Security`. `next.config.mjs` não define `headers()` (a CSP
mora no middleware por causa do nonce por requisição); só marca
`better-sqlite3` como external no webpack.

---

## 3. Grafo de dependências entre os módulos de `src/lib`

Só imports internos a `src/lib` (o alias `@/lib/*` e `./x` resolvem para o
mesmo lugar). Setas = "importa de".

```
migrations.js   → (nenhum)                      [puro]
auditoria.js    → (nenhum; recebe `conn`)       [puro]
validacao.js    → (nenhum)                      [puro]
format.js       → (nenhum)                      [puro]
log.js          → (nenhum; escreve stdout)      [puro]
requisicao.js   → (nenhum)                      [puro]
datas-cliente.js→ (nenhum; p/ o navegador)      [puro, sem importador no servidor]

db.js           → config-ambiente.js , migrations.js
config-ambiente.js → db.js                      ⟲  (ciclo com db.js)
slots.js        → db.js
limitador.js    → db.js
auth.js         → db.js , config-ambiente.js , next/headers
agendamentos.js → db.js , slots.js , format.js , validacao.js , auditoria.js
```

Cadeia mais profunda: `agendamentos.js → slots.js → db.js → config-ambiente.js → db.js`.

**Ciclo:** `db.js` ↔ `config-ambiente.js`. `db.js` importa
`verificarAmbiente` (usado só dentro de `getDb()`, em runtime);
`config-ambiente.js` importa `lerConfig` (usado só dentro de
`verificarAmbiente()` / `senhaInicialValida` chamados em runtime). Resolve
hoje porque nenhum dos dois usa o import do outro em nível de módulo. É
frágil — ver Pistas.

Consumidores fora de `src/lib` (camada de rota) importam livremente `log.js`,
`requisicao.js`, `auth.js`, `db.js`, `slots.js`, `agendamentos.js`,
`validacao.js`, `auditoria.js`, `limitador.js`, `config-ambiente.js`
(`diretorioGravavel` em `health`).

---

## 4. Os quatro caminhos críticos, traçados por chamada

### a. POST público de agendamento

`middleware` (CSP/headers) → `POST /api/agendamentos` (`comLog`):

1. `obterIp(request)` (`limitador.js`) — lê `x-forwarded-for` / `x-real-ip`
   **só se `TRUST_PROXY === '1'`**; senão `"sem-ip"`. `chave = agendar:<ip>`.
2. `limiteAtingido(chave, {janela: 10 min, max: 6})` → `contarTentativas`:
   `getDb()`, limpeza amostrada (1 %), `SELECT COUNT(*) FROM limitador WHERE
chave=? AND criado_em >= datetime('now','-10 minutes')`. `>= 6` →
   `registrarAviso` + **429**.
3. `registrarTentativa(chave)` → `INSERT INTO limitador` — **conta toda
   tentativa, inclusive as que vão dar certo**.
4. `lerCorpoJson(request)` (`requisicao.js`) — vazio → `{}`; JSON inválido →
   `undefined` → **400** "Não consegui ler os dados enviados.".
5. `criarAgendamento({origem:'publico', clienteNome, clienteTelefone,
barbeiroId:Number, servicoId:Number, data:String, inicio:String})`
   (`agendamentos.js`):
   1. `getDb()` — na 1ª vez do processo: abre conexão (`WAL`,
      `foreign_keys=ON`), confere versão do schema (throw se ≠ 5), e em
      `NODE_ENV==='production'` roda `verificarAmbiente()` (throw com a lista
      se houver problema).
   2. `SELECT * FROM servicos WHERE id=?` / `SELECT * FROM barbeiros WHERE
id=?` → faltou → **404**; `!ativo` → **400**.
   3. `SELECT 1 FROM servico_barbeiro WHERE servico_id=? AND barbeiro_id=?` →
      não vinculado → **400** "X não atende Y.".
   4. `nome = trim().slice(0,80)`; `< 2` → **400**.
   5. `telefone = somenteDigitos(...)`; público → `telefoneValido` exige
      **10 ou 11 dígitos**, senão **400**.
   6. `validar("agendamentos", {data, inicio})` — `dataValida` (regex +
      calendário real) e `horaValida` (regex + faixa). Falha → **400**
      "Informe a data e o horário.".
   7. `fim = paraHora(paraMinutos(inicio) + servico.duracao_min)`.
   8. `status`: público → `lerConfig().confirmacao_automatica === '1'` ?
      `'confirmado'` : `'pendente'`.
   9. `conn.transaction(() => { verificarConflito(...); INSERT; registrarAuditoria(...) }).immediate()`
      — **BEGIN IMMEDIATE** pega o write lock antes de ler:
      - `verificarConflito` (origem `publico`): chama
        `horariosLivres({barbeiroId, duracaoMin, data})` e checa
        `livres.includes(inicio)`; se não → `throw ErroAgendamento(409,
"Esse horário acabou de ser ocupado…")`.
      - `INSERT INTO agendamentos (13 colunas)` — pode bater nas CHECK ou no
        **`idx_ag_sem_duplicidade`** (`SQLITE_CONSTRAINT`).
      - `registrarAuditoria(conn, {acao:'criar', tabela:'agendamentos',
registroId, depois: snapshotAgendamento(...)})` — INSERT na mesma tx.
   10. `catch` → `tratarErroTransacao`: `ErroAgendamento` → `{ok:false,
status, erro}`; `code` começa com `SQLITE_CONSTRAINT` → **409**
       (mensagem amigável padrão); senão **rethrow** (→ `comLog` → **500**
       genérico).
6. `!resultado.ok` → `Response.json({erro}, {status})`.
7. `registrarInfo(ROTA, "agendamento criado", {agendamentoId})`.
8. `lerConfig()` de novo → `Response.json({agendamento: {...,
barbearia: nome_barbearia}, whatsapp_barbearia: whatsapp})` — **status
   200 default**.

`horariosLivres` no meio do caminho: ver item (d).

### b. Criação / remarcação / mudança de status pelo painel

Portão comum: `exigirSessao(request)` (ver 2.2). `usandoSenhaInicial()` e
`sessaoValida()` tocam o banco (`lerConfig`).

**Criação** — `POST /api/admin/agendamentos` → `criarAgendamento({origem:'painel', …})`:
mesma sequência de (a), com diferenças:

- telefone **opcional**; se vier, tem de ser válido (10–11 díg.), senão **400**.
- `status` sempre `'confirmado'`.
- `verificarConflito` (origem `painel`) **não** chama `horariosLivres`
  (encaixe fora do expediente é permitido). Faz SQL direto:
  - `SELECT cliente_nome, inicio, fim FROM agendamentos WHERE data=? AND
barbeiro_id=? AND status<>'cancelado' AND excluido_em IS NULL
[AND id<>?] AND inicio < ? AND fim > ?` → **409** "<barbeiro> já
    atende <cliente> das X às Y.".
  - `SELECT motivo, inicio, fim FROM bloqueios WHERE data=? AND
(barbeiro_id IS NULL OR barbeiro_id=?) AND inicio < ? AND fim > ?` →
    **409** "<barbeiro> está bloqueado (…) das X às Y.".
- Resposta: `{id}`, **201**.

**Mudança de status** — `PATCH /api/admin/agendamentos/[id]` com
`corpo.status !== undefined` → `mudarStatusAgendamento(id, novoStatus)`:

1. `STATUS_VALIDOS.includes(novoStatus)` senão **400**.
2. `SELECT * FROM agendamentos WHERE id=? AND excluido_em IS NULL` → **404**.
3. `TRANSICOES_LEGAIS[atual.status]` deve conter `novoStatus`, senão **400**:
   - `pendente → confirmado | cancelado`
   - `confirmado → concluido | cancelado`
   - `concluido → (nenhuma)`
   - `cancelado → pendente | confirmado`
4. `novoStatus === 'concluido' && atual.data > agora().data` → **400**.
5. `conn.transaction(() => { if (atual.status === 'cancelado')
verificarConflito(origem:'painel', {id, nome}, data, inicio, fim,
ignorarId:id); UPDATE status; registrarAuditoria(antes:{status},
depois:{status}) }).immediate()`.
6. `SQLITE_CONSTRAINT` (reabertura colide com o índice único) → **409**.
7. Rota: `registrarInfo(ROTA_PATCH, msg, {agendamentoId})`, **200** `{ok:true}`.

**Remarcação** — `PATCH /api/admin/agendamentos/[id]` com
`data | inicio | barbeiro_id | servico_id` definidos e `status` ausente →
`remarcarAgendamento(id, {data, inicio, barbeiroId, servicoId})`:

1. `SELECT * … WHERE id=? AND excluido_em IS NULL` → **404**.
2. `status` `'concluido'`/`'cancelado'` → **400**.
3. resolve novos valores (fallback ao atual); `SELECT servicos` / `SELECT
barbeiros` → **404** se sumiu; `!ativo` → **400**.
4. `SELECT 1 FROM servico_barbeiro …` → **400** se não vinculado.
5. `validar("agendamentos", {data:novaData, inicio:novoInicio})` → **400**.
6. `novoFim = paraHora(paraMinutos(novoInicio) + servico.duracao_min)`.
7. `conn.transaction(() => { verificarConflito(origem:'painel', barbeiro,
novaData, novoInicio, novoFim, ignorarId:id); UPDATE (barbeiro_id,
servico_id, barbeiro_nome, servico_nome, data, inicio, fim, duracao_min,
preco_centavos); registrarAuditoria(acao:'remarcar', antes:
snapshotAgendamento(atual), depois: snapshot) }).immediate()`.
8. `SQLITE_CONSTRAINT` → **409**. Rota: `registrarInfo`, **200** `{ok:true}`.

**Exclusão** — `DELETE /api/admin/agendamentos/[id]` → `excluirAgendamento(id)`:

1. `SELECT * … WHERE id=? AND excluido_em IS NULL` → **404**.
2. `conn.transaction(() => { UPDATE agendamentos SET excluido_em =
datetime('now') WHERE id=?; registrarAuditoria(acao:'excluir', antes:
snapshot) })()` — **transação simples, sem `.immediate()`** (diferente
   das três acima).
3. Rota: `registrarInfo`, **200** `{ok:true}`.

**PATCH de cadastro** (preço de serviço) — `PATCH /api/admin/[recurso]/[id]`:
`filtrarCampos` (whitelist + coerção) → `validar(recurso, campos)` (sem
`{criando:true}`) → se `recurso==='servicos'` e `preco_centavos in campos`,
lê o preço anterior **antes** e, na mesma `conn.transaction`, faz o `UPDATE`
e, se `changes > 0`, `registrarAuditoria(acao:'alterar_preco', antes/depois)`.
`servico_barbeiro` é re-sincronizado por `definirBarbeirosDoServico` **fora**
dessa transação, se `corpo.barbeiros` for array.

### c. Login, sessão e troca de senha

**Login** — `POST /api/admin/login` (`comLog`):

1. `!autenticacaoConfiguradaComSeguranca()` → **503** (mensagem de config
   insegura).
2. `chave = login:<obterIp>`; `bloqueado = limiteAtingido(chave, {15 min,
8}) || limiteGlobalAtingido("login:global", {15 min, 50, 60 s})`.
   `limiteGlobalAtingido`: se `count(global, 15 min) < 50` → `false`; senão
   verifica se há qualquer linha global nos últimos 60 s → `true`
   (re-arma enquanto as falhas continuam). `bloqueado` → `registrarAviso` +
   **429**.
3. `lerCorpoJson` inválido → **400**.
4. `await senhaConfere(corpo.senha)` (`auth.js`):
   - `String(tentativa ?? "")`; vazio → `false`.
   - `lerConfig().senha_hash` presente → `conferirHash`: `split('$')`;
     6 partes = `scrypt$N$r$p$sal$hash`; 3 partes = legado `scrypt$sal$hash`
     (N/r/p padrão); outro → `false`. `await scrypt(...)` +
     `timingSafeEqual`.
   - sem `senha_hash` → `!senhaInicialConfiguradaComSeguranca()` → `false`;
     senão `iguais(texto, process.env.ADMIN_PASSWORD)` (timing-safe, checa
     comprimento). **Nenhum literal de senha no código.**
5. Falha → `registrarTentativa(chave)` + `registrarTentativa("login:global")`
   - `registrarAviso("login falho")` + **401**.
6. Sucesso → `limparTentativas(chave)` (**não** limpa `login:global`) +
   `criarSessao()` + `registrarInfo("login bem-sucedido")` + **200**
   `{ok:true, senhaInicial: usandoSenhaInicial()}`.
   - `criarSessao()`: `versao = lerConfig().sessao_versao || "1"`;
     `expiraEm = Date.now() + 12 h`; `cookies().set("admin_sessao",
construirToken(versao, expiraEm), {httpOnly, sameSite:'strict', secure:
production, path:'/', maxAge: 12 h})`.
   - `construirToken(v, e)` = `admin.<v>.<e>.<HMAC_SHA256(segredo,
"admin.<v>.<e>")>` (hex).

**Verificação de sessão** — `GET /api/admin/sessao` (`comLog`, sem
`exigirSessao`): `!autenticacaoConfiguradaComSeguranca()` → `{autenticado:
false, configuracaoInsegura:true}` (200); senão `{autenticado:
sessaoValida(), senhaInicial: autenticado ? usandoSenhaInicial() : false}`.
`sessaoValida()` → `tokenValido(cookies().get("admin_sessao")?.value)`:
4 partes; HMAC confere (`timingSafeEqual`); `Number(expiraEm) <= Date.now()`
→ expirado; `versao === (lerConfig().sessao_versao || "1")`.

**Logout** — `POST /api/admin/logout` (sem `exigirSessao`) →
`encerrarSessao()` → cookie vazio `maxAge:0` → **200**.

**Troca de senha** — `POST /api/admin/senha` (`comLog`):

1. `exigirSessao(request)` — passa mesmo sob "senha inicial"
   (`rotaPermitidaComSenhaInicial`), mas ainda exige sessão válida (401) e
   respeita o check de `Origin` (403). **Sem rate limit.**
2. `lerCorpoJson` inválido → **400**. `{senhaAtual, novaSenha, confirmacao}`.
3. `!(await senhaConfere(senhaAtual))` → **400**.
4. `novaSenha.length < 6` → **400**.
5. `novaSenha !== confirmacao` → **400**.
6. `await senhaConfere(novaSenha)` verdadeiro → **400** "igual à atual".
7. `await trocarSenha(nova)`: `versao = Number(sessao_versao || 1) + 1`;
   `salvarConfig({senha_hash: await gerarHash(nova), sessao_versao:
String(versao)})`; `criarSessao()` (reemite o cookie com a nova versão —
   quem trocou continua logado, **todas as outras sessões caem**).
   `gerarHash`: `randomBytes(16)` de sal, `scrypt(nova, sal, 64,
{N:16384, r:8, p:1})` → `scrypt$16384$8$1$<sal>$<hash>`.
8. `registrarAuditoria(getDb(), {acao:'trocar_senha', tabela:'config'})` —
   **fora de transação** (o `salvarConfig` já commitou; é um INSERT à parte).
9. **200** `{ok:true}`.

### d. `horariosLivres`

Chamadores: `GET /api/horarios` (público), `PUT /api/admin/agendamentos`
(painel, autenticado), e interno em `verificarConflito` quando
`origem === 'publico'` (dentro da transação de `criarAgendamento`).

`GET /api/horarios` (`comLog`): parse `barbeiro`/`servico` (`Number`),
`data` (`/^\d{4}-\d{2}-\d{2}$/`). Falta/formato → **400**. `SELECT
duracao_min FROM servicos WHERE id=? AND ativo=1` → não achou → **404**.
`horariosLivres({barbeiroId, duracaoMin: servico.duracao_min, data})` →
`{horarios}`.

`horariosLivres({barbeiroId, duracaoMin, data})` (`slots.js`):

1. `conn = getDb()`, `config = lerConfig()`.
2. `passo = max(5, Number(intervalo_min) || 30)`;
   `antecedencia = max(0, Number(antecedencia_min) || 0)`;
   `duracao = max(5, Number(duracaoMin) || 30)`.
3. `SELECT * FROM expediente WHERE dia = diaDaSemana(data)`
   (`diaDaSemana` via `Date.UTC`, imune a fuso). `!dia || !dia.aberto` →
   `[]`.
4. `abre = paraMinutos(dia.abre)`, `fecha = paraMinutos(dia.fecha)`.
   `fecha <= abre` → `[]` (defesa redundante com o `CHECK (fecha > abre)`).
5. `ocupados` = `SELECT inicio, fim FROM agendamentos WHERE data=? AND
barbeiro_id=? AND status<>'cancelado' AND excluido_em IS NULL` →
   pares `[min, min]`.
6. `bloqueios` = `SELECT inicio, fim FROM bloqueios WHERE data=? AND
(barbeiro_id IS NULL OR barbeiro_id=?)`.
7. `intervalos = [...ocupados, ...bloqueios]`.
8. `hoje = agora()` (`Intl.DateTimeFormat('en-CA', {timeZone: FUSO,…})`,
   com guarda `hora === "24" ? "00"`).
   `minimo = data === hoje.data ? hoje.minutos + antecedencia : -1`.
9. Candidatos: grade fixa `for (i=abre; i+duracao<=fecha; i+=passo)` **mais**
   o `fim` de cada intervalo onde `fim >= abre && fim+duracao <= fecha`
   (cobre atendimento que termina fora da grade).
10. Para cada candidato ordenado: pula se `inicio < minimo`;
    `fim = inicio + duracao`; `conflita = intervalos.some(([i,f]) =>
inicio < f && fim > i)`; se não → `push(paraHora(inicio))`.
11. Devolve `["HH:MM", …]`.

---

## 5. Resultado de `npm test`

Comando real: `node --import ./tests/register-hooks.mjs --test "tests/*.test.js"`.
Cada arquivo roda em processo próprio, com um arquivo de banco temporário em
`os.tmpdir()` (`barbosa-teste-<pid>-<rand>.db`) e `next/headers` trocado por
um cookie-jar em memória (`tests/fake-next-headers.mjs`). `getDb()` não migra
sozinho — `tests/ajuda.js#bancoDeTeste()` roda `aplicarMigrations` numa
conexão à parte antes da 1ª chamada a `getDb()`.

```
# tests 114
# pass  114
# fail  0
# cancelled 0
# skipped 0
# todo 0
# duration_ms ~1541
[exited with code 0]
```

**114 testes, 114 passam, 0 falham, 0 pulados.** (Contrasta com o
`prompts-correcao-barbosa.md`, que previa um teste marcado `skip` na Etapa 0
— ele já foi reativado.)

Cobertura por arquivo:

| Arquivo                            | Nº  | O que cobre                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/agendamentos.test.js`       | 12  | `criarAgendamento()`: telefone obrigatório/opcional (público × painel); `status` inicial (`confirmacao_automatica` × painel sempre `confirmado`); público respeita expediente / painel encaixa fora; painel nunca sobre outro atendimento nem sobre bloqueio; serviço/barbeiro inexistente (404) e inativo (400); par serviço×barbeiro não vinculado (400); nome curto (400); snapshot de `preco_centavos`/`duracao_min`/`fim`. **Não** exercita os route handlers.                          |
| `tests/auth.test.js`               | 11  | cookie: assinatura adulterada, expirado, `sessao_versao` antiga após troca; `tokenValido` com formato inválido; `senhaConfere` certo/errado (hash de 6 partes); `sessaoConfiguradaComSeguranca` recusa placeholder e segredo `< 32` em produção; `senhaConfere` recusa quando `ADMIN_PASSWORD` ausente ou placeholder; `obterIp` ignora `X-Forwarded-For` sem `TRUST_PROXY` e usa com `TRUST_PROXY=1`.                                                                                       |
| `tests/autorizacao.test.js`        | 21  | para cada método de cada rota `/api/admin/*` protegida → **401 sem sessão** (17 casos); "nenhum método HTTP fora do declarado"; "toda rota `/api/admin/*` está listada" (varre o diretório); sob "senha inicial": `GET /resumo` → 403, `GET /config` → 200, `PUT /config` → 403, `POST /senha` → não-403. Lista explícita de rotas — uma rota nova esquecida quebra o teste.                                                                                                                 |
| `tests/concorrencia.test.js`       | 1   | dois `Worker` (threads de SO), conexões SQLite separadas ao mesmo arquivo, criando o **mesmo** horário em paralelo → exatamente 1×sucesso e 1×409; `COUNT` no banco = 1. Exercita `BEGIN IMMEDIATE` + índice único parcial. (origem `painel`.)                                                                                                                                                                                                                                               |
| `tests/datas-cliente.test.js`      | 5   | `hojeLocal(fuso, momento)` / `mesAtualLocal` no horário de virada (UTC × America/Sao_Paulo), não vira antes da hora, virada de mês, e sem `momento` explícito usa "agora".                                                                                                                                                                                                                                                                                                                   |
| `tests/db.test.js`                 | 15  | CHECKs rejeitam: `status` inválido, `duracao_min` 0 e 481, `preco_centavos` < 0 (serviço e produto), `estoque` < 0, `data` mal formatada, `inicio` `99:99`, `fim <= inicio`; `idx_ag_sem_duplicidade` rejeita 2º no mesmo (barbeiro, data, início) e ignora `cancelado`; `expediente` recusa `fecha <= abre`, `dia = 7`, hora `9:00`; `aplicarMigrations` idempotente; banco novo tem **0** barbeiros/serviços/produtos.                                                                     |
| `tests/estado-agendamento.test.js` | 12  | `mudarStatusAgendamento` / `remarcarAgendamento`: transições legais aceitas; `concluido→pendente` recusado; concluir data futura recusado; reabrir `cancelado` com horário ocupado → 409 e nada muda; reabrir com horário livre → ok; status inválido → 400; id inexistente → 404; remarcar p/ horário ocupado → 409 e nada muda; remarcar p/ livre atualiza derivados (`fim`); remarcar não colide consigo; remarcar `concluido`/`cancelado` → 400; remarcar inexistente → 404.             |
| `tests/log-login.test.js`          | 2   | `POST /api/admin/login` de verdade: login falho → 1 linha de log `nivel:'aviso'`, `rota` certa, **sem** a senha em nenhum lugar da linha; login OK → linha `nivel:'info'`, sem a senha.                                                                                                                                                                                                                                                                                                      |
| `tests/log.test.js`                | 6   | `registrarInfo` gera NDJSON com `ts`/`nivel`/`rota`/`msg`; contexto extra (`agendamentoId`) sem PII; `registrarErro` grava só `error.message`; linha "login falho" não contém "senha"; `comLog` deixa passar resultado normal; `comLog` loga o erro real mas devolve **500** genérico.                                                                                                                                                                                                       |
| `tests/requisicao.test.js`         | 3   | `lerCorpoJson`: vazio → `{}`; JSON válido → objeto; malformado → `undefined` (distinto de vazio).                                                                                                                                                                                                                                                                                                                                                                                            |
| `tests/resumo.test.js`             | 2   | `GET /api/admin/resumo` de verdade (com cookie e `senha_hash`): renomear o barbeiro entre dois agendamentos → **1 linha** em `porBarbeiro`, com o nome ATUAL e `quantidade = 2`; os totais da `serie` batem com a soma dos cartões (`realizado + previsto`), sem o `cancelado`.                                                                                                                                                                                                              |
| `tests/slots.test.js`              | 10  | `horariosLivres`: dia fechado → `[]`; grava expediente inválido → CHECK; grade conforme `intervalo_min`; colisão parcial remove os dois slots; atendimento que termina fora da grade libera o slot seguinte; bloqueio `barbeiro_id NULL` afeta todos, específico afeta um; `antecedencia_min` corta hoje mas não amanhã; serviço mais longo que o expediente → `[]`.                                                                                                                         |
| `tests/upload.test.js`             | 3   | `POST /api/admin/upload`: foto grande → WebP `700px` e `< 150 KB`; substituição apaga a imagem anterior; `anterior` forjado (fora do padrão `/uploads/<pasta válida>/<uuid>.webp`) **não** apaga nada.                                                                                                                                                                                                                                                                                       |
| `tests/validacao.test.js`          | 13  | `validar()`/`dataValida`/`horaValida`/`validarExpediente`/`primeiroErro`: `duracao_min = 0` recusado; faixa 5–480; `preco_centavos` < 0 e > 10 M; `estoque` < 0; `ordem` fora de 0–9999; texto acima do limite; `nome` obrigatório no POST mas não no PATCH; `bloqueios` exigem `data`/`inicio`/`fim` e `fim > inicio`, PATCH parcial não dispara o cruzamento; `2024-02-30` inválida; `99:99` inválida; `validarExpediente` acha `fecha <= abre`; `primeiroErro` formata "campo: mensagem". |

---

## 6. Lacunas de teste nos quatro caminhos

Só o que **não** tem cobertura hoje. Sem juízo de severidade.

### a. POST público de agendamento

- Nenhum teste chama o **route handler** `POST /api/agendamentos` de ponta a
  ponta: rate limit → **429**, corpo malformado → **400**, formato da
  resposta (`agendamento.barbearia`, `whatsapp_barbearia`, status **200**).
  Só a função `criarAgendamento()` é testada direto.
- `src/lib/limitador.js` **não tem arquivo de teste**: `limiteAtingido`,
  `limiteGlobalAtingido` (inclusive o re-arme dos 60 s), `limparTentativas`,
  `registrarTentativa`, e a limpeza amostrada — nada coberto. `obterIp` é o
  único, e está em `auth.test.js`.
- `registrarTentativa` contar tentativa **mesmo no sucesso** (fluxo público)
  — comportamento não afirmado por teste.
- `diasDisponiveis()` (varre `expediente`, teto de dias varridos) — sem teste.
- `verificarConflito` no ramo `origem:'publico'` (rejeição por
  `!livres.includes(inicio)` **dentro da transação**, mensagem "acabou de
  ser ocupado") — só indireto via "público respeita o expediente"; não há
  teste de corrida real nesse ramo (o de concorrência usa `painel`).
- `GET /api/public` e `GET /api/horarios` (validação de query, 404 de
  serviço inativo) — sem teste de handler.

### b. Painel (criação / remarcação / status / exclusão)

- Route handlers `POST /api/admin/agendamentos`, `PATCH` e `DELETE`
  `/api/admin/agendamentos/[id]` — testados **só para 401**. O roteamento
  status-vs-remarcação dentro do PATCH, o `{erro:"Nada para atualizar."}`, e
  os `registrarInfo` não têm teste.
- **`excluirAgendamento()` — nenhum teste.** Soft delete: marcar
  `excluido_em`, sumir de listagens / relatórios / `horariosLivres`, e gerar
  linha de auditoria. (Era critério de aceite da Etapa 8.)
- **Auditoria — nenhum teste.** Não se verifica que criar / status /
  remarcar / excluir / `alterar_preco` / `trocar_senha` / `salvar` config
  gravam **exatamente uma** linha em `auditoria`, nem que `antes`/`depois`
  não contêm nome/telefone.
- **`atropelados`** (contagem de agendamentos que um bloqueio atropela, no
  `POST /api/admin/[recurso]` de `bloqueios`) — sem teste. (Era critério de
  aceite da Etapa 8: "bloqueio sobre 2 agendamentos → contagem 2".)
- Check de header **`Origin`** em `exigirSessao` (403 "Origem não
  permitida.") — sem teste.
- `remarcarAgendamento` trocando **`barbeiro_id`/`servico_id`** (não só o
  horário) — os testes só mudam `inicio`.
- Transição válida `confirmado→concluido` com **data passada** (caminho
  feliz) — só o de rejeição (data futura) é testado.
- `PATCH /api/admin/[recurso]/[id]` — auditoria de `alterar_preco`,
  `changes === 0` → 404, re-sync de `servico_barbeiro` — sem teste.

### c. Login, sessão e troca de senha

- **Rate limit do login de ponta a ponta**: 429 após 8 falhas por IP;
  bloqueio global após 50; re-arme de 60 s enquanto as falhas continuam —
  sem teste.
- **`POST /api/admin/senha` no caminho feliz**: troca real, bump de
  `sessao_versao`, cookie reemitido, outras sessões derrubadas — sem teste.
  `trocarSenha()` direto também não é testado.
- `GET /api/admin/sessao` — sem teste (nem `configuracaoInsegura:true`, nem
  o shape `{autenticado, senhaInicial}`).
- `POST /api/admin/logout` / `encerrarSessao()` — sem teste.
- `conferirHash` no **formato legado de 3 partes** (`scrypt$sal$hash`) — só
  o de 6 partes é exercitado.
- Atributos do cookie de `criarSessao` (`httpOnly`, `sameSite:'strict'`,
  `secure` em produção, `maxAge`) — sem teste.
- Ausência de rate limit em `POST /api/admin/senha` — não testada nem
  documentada.

### d. `horariosLivres`

- `GET /api/horarios` (handler): 400 de query malformada, 404 de serviço
  inativo — sem teste.
- `PUT /api/admin/agendamentos` (horários p/ encaixe) — só 401; o
  `{horarios: []}` quando o serviço não existe não é testado.
- `intervalo_min` inválido/`'0'` (o `max(5, …)`) e a interação
  `passo` × candidato de fim de intervalo — parcialmente coberto.
- `agora()` / `diaDaSemana()` / `somarDias()` diretamente sob `TZ` variado —
  coberto só via `datas-cliente` (que é a cópia cliente, não `slots.js`).

---

## 7. Pistas para as próximas etapas

Sem severidade. São pontos que apareceram durante o mapeamento e merecem
decisão nas etapas seguintes.

1. **Ciclo de import ESM `db.js` ↔ `config-ambiente.js`.** Funciona porque
   nenhum dos dois usa o import do outro em nível de módulo, só em runtime.
   Qualquer código de topo em `config-ambiente.js` que chame `lerConfig`
   passaria a ver `undefined`. Confirmável com um teste que importe
   `config-ambiente.js` isolado, antes de `db.js`.
2. **`excluirAgendamento()` usa `conn.transaction(...)()` sem `.immediate()`**,
   enquanto `criarAgendamento` / `remarcarAgendamento` /
   `mudarStatusAgendamento` usam `.immediate()`. Não há leitura-antes-de-
   escrever com decisão de conflito no soft delete, então o risco é baixo,
   mas a inconsistência é real.
3. **`registrarAuditoria` fora de transação em dois pontos:**
   `POST /api/admin/senha` (`acao:'trocar_senha'`) e `PUT /api/admin/config`
   (`acao:'salvar'`) chamam `registrarAuditoria(getDb(), …)` **depois** do
   `salvarConfig`/`trocarSenha` já ter commitado. Se o INSERT de auditoria
   falhar, a mutação fica sem registro. (No `agendamentos.js` e no
   `alterar_preco` a auditoria está dentro da mesma transação — correto.)
4. **`agendamentos.status` não tem índice.** É filtrado sozinho em
   `pendentes/route.js`, `resumo/route.js` (`pendentesTotal`,
   `geralRealizado`, `geralPrevisto` — estes dois **sem filtro de data**,
   varrendo todo o histórico) e no `GET /api/admin/agendamentos?status=`.
   Custo O(n) crescente, em telas abertas o dia todo.
5. **`resumo/route.js` — `recentes`** faz `ORDER BY criado_em DESC LIMIT 8`
   sem índice em `criado_em`: varredura + sort da tabela inteira a cada
   chamada do resumo.
6. **`agendamentos.servico_id` não tem índice.** `DELETE
/api/admin/[recurso]/[id]` de um serviço faz `COUNT(*) WHERE servico_id =
?` em varredura completa. `barbeiro_id` tem (via `idx_ag_barbeiro`),
   `servico_id` não.
7. **`GET /api/admin/agendamentos`** ordena por `data DESC, inicio DESC`
   (não coberto por `idx_ag_data`, que só tem `data`) e faz busca com
   `LIKE '%…%'` (curinga à esquerda). Em ~1 ano (dezenas/dia ≈ 10–15 mil
   linhas) ainda é rápido, mas é varredura + sort a cada abertura da tela.
8. **`listarBloqueios()` lê todos os bloqueios já criados**, sempre, sem
   filtro de data (`ORDER BY data DESC, inicio`). Bloqueios nunca são
   podados — a lista só cresce, e vai inteira para o
   `GET /api/admin/[recurso]?recurso=bloqueios`.
9. **`POST /api/agendamentos` (público) responde 200**, o painel responde 201. Os testes checam `resultado.ok` do objeto de `criarAgendamento`, não
   o status HTTP, então a divergência não aparece na bateria.
10. **`registrarTentativa` no fluxo público conta toda tentativa, inclusive
    sucesso.** 6 agendamentos legítimos em 10 min pelo mesmo IP/rede
    (família no mesmo Wi-Fi, recepção do salão) começam a receber 429.
    `login` só conta falha; `agendar` conta tudo.
11. **`POST /api/admin/senha` não tem rate limit.** Exige sessão válida, mas
    uma sessão sequestrada pode tentar `senhaAtual` à vontade sem custo.
12. **`PUT /api/admin/config` não valida faixa** de `intervalo_min`,
    `antecedencia_min`, `dias_futuros` — só filtra por chave conhecida.
    `horariosLivres`/`diasDisponiveis` se defendem com `max(5, …)` / `|| 30`
    / teto de dias varridos, mas valores absurdos (`intervalo_min='0'`,
    `dias_futuros='99999'`) entram no banco. `validarExpediente` cobre só
    `fecha > abre`.
13. **`schema_version` sem PK nem UNIQUE.** `aplicarMigrations` faz
    `DELETE` + `INSERT`, então na prática há uma linha só; nada estrutural
    impede duas. `versaoDoBanco` lê `LIMIT 1`.
14. **`upload/route.js`: `pasta` fora da whitelist cai em `"geral"`**, que
    **não** está em `PASTAS_VALIDAS` nem casa com `CAMINHO_UPLOAD_VALIDO`.
    Uma imagem salva em `/uploads/geral/…` nunca será apagada como
    "anterior" numa troca futura → órfãs permanentes em
    `public/uploads/geral`. (O front sempre manda uma pasta válida hoje;
    é o caminho de erro que fica solto.)
15. **`data/` tem `app.db` e `barbosa.db` lado a lado** (o segundo com um
    WAL de ~190 KB, mais recente). `db.js` usa `DATABASE_PATH ||
"./data/app.db"`; o comentário de `scripts/migrate.js:1` ainda diz
    "`./data/barbosa.db`". Sinaliza que algo já rodou apontando para o
    arquivo errado. Ambos são git-ignored; só `data/.gitkeep` é versionado.
16. **`comLog` transforma qualquer exceção em 500 genérico** — inclusive o
    `throw` de `getDb()` quando o schema está desatualizado ("rode
    `npm run migrate`"). O cliente final vê só "Algo deu errado"; a pista
    real fica só no log de `stdout`. Relevante para o runbook de deploy.
17. **`agendamentos.criado_em` é `datetime('now')` (UTC)**, assim como
    `limitador.criado_em` e `auditoria.criado_em`. O resto do domínio
    (`data`, `inicio`) é no fuso da barbearia. `resumo` ordena `recentes` por
    esse `criado_em` UTC — ok para ordenação relativa, mas qualquer exibição
    de "criado às HH:MM" a partir dele estaria 3 h adiantada em UTC−3.
18. **`middleware.js` depende do `crypto` global** (`crypto.randomUUID()`)
    e não tem teste de que o header CSP sai correto. O próprio comentário do
    arquivo avisa que `next dev` mascara o comportamento real de produção —
    validar só com `npm run build && npm start`.
