# 07 — Operação: boot, migrations, backup, entrega zerada, health, logs

Escopo: `src/lib/config-ambiente.js`, `src/lib/db.js`, `src/lib/migrations.js`,
`src/lib/log.js`, `src/lib/auditoria.js`, `scripts/migrate.js`,
`src/app/api/health/route.js`, `.env.example`, `next.config.mjs`, mais
`README.md` (seções de deploy/backup) e `VisaoGeral.jsx` (onboarding). Base:
`auditoria/01-mapa.md`.

Verificação: leitura + `npm test` (114/114) + simulação mental do primeiro
acesso. Sem experimento destrutivo (a etapa é de boot/deploy).

---

## 1. Modos de falha no boot

`getDb()` (`db.js:22-48`) faz, **na primeira chamada** (lazy, não no start do
processo):
1. `abrirConexao()` — `mkdirSync` do diretório, `new Database(DB_PATH)`,
   `PRAGMA journal_mode = WAL`, `PRAGMA foreign_keys = ON`.
2. `versaoDoBanco(db) !== versaoEsperada()` → `throw "Banco de dados
   desatualizado (versão X, esperada Y). Rode \"npm run migrate\" antes de
   iniciar o servidor."`
3. Se `NODE_ENV === "production"`: `verificarAmbiente()` → se a lista não for
   vazia → `throw "Configuração insegura para produção — corrija antes de
   continuar:\n  - <problema>"`.

| Cenário | Falha barulhenta ou silenciosa? | A mensagem diz o que fazer? | Onde a mensagem aparece |
|---|---|---|---|
| **Banco desatualizado** | O processo **sobe normalmente**. A 1ª requisição que toca `getDb()` (ex.: `/api/public`) → `throw` → `comLog` → **500 genérico "Algo deu errado."** ao visitante. `/api/health` → 503 `{ok:false}`. | **Sim** — "Rode `npm run migrate` antes de iniciar o servidor." | Só no **stdout** (`registrarErro`). Não no terminal do `npm start`, não no corpo do 500, não no `/api/health`. |
| **Disco cheio** | **Silenciosa.** `abrirConexao` pode lançar `ENOSPC` no `mkdirSync`/`new Database` → 500 genérico. Em operação, um `INSERT` com disco cheio → `SQLITE_FULL` → `tratarErroTransacao` não reconhece (só `SQLITE_CONSTRAINT*`) → rethrow → 500 genérico. **`/api/health` continua `{ok:true}`** — ver F32. | A mensagem crua (`database or disk is full`) vai só pro log. | stdout apenas. |
| **`DATABASE_PATH` inválido** | O processo sobe. 1ª requisição → `new Database` lança `unable to open database file` → 500 genérico. Em produção, `verificarAmbiente()` **pega o caso "diretório pai não gravável"** com `"Diretório do banco (<dir>) não é gravável."` — mas ainda lançado dentro de `getDb()`, não no boot. Fora de produção, `verificarAmbiente` nem roda. | Em produção: **sim** ("... não é gravável"). Fora de produção: só o erro cru do SQLite. | stdout / 500 genérico. |
| **`SESSION_SECRET` ausente (produção)** | O processo sobe. `verificarAmbiente()` retorna `["SESSION_SECRET não está definido."]` → `getDb()` lança em **toda** rota que toca o banco → **o site inteiro cai** (500 genérico), não só o painel. `login`/`sessao` respondem **503 com mensagem clara** ("O painel está indisponível: falta configurar o servidor com segurança (SESSION_SECRET/ADMIN_PASSWORD). Avise quem cuida da hospedagem."). | **Sim**, tanto o `throw` de `getDb()` quanto o 503 do login. | 503 do login: bom, chega ao operador. `throw` de `getDb()`: stdout. |

### Veredito

Todos os quatro **falham fechado** — recusam servir / recusam gravar. É o
instinto certo. Mas:

- **Não há validação no boot.** O processo `next start` sobe "com sucesso" em
  todos os casos; a falha é adiada para a 1ª requisição.
- A falha chega ao **visitante como 500 genérico** e ao operador **só no
  stdout**. Quem faz deploy e não acompanha o log vê um processo no ar e um
  site morto. → **F31**.
- `SESSION_SECRET` ausente em produção derruba **o site público inteiro**
  (agendamento incluso), não só o painel como o README dá a entender
  (README:117 fala em "o painel fica indisponível").
- As mensagens em si, onde aparecem, são claras e acionáveis.

---

## 2. Migrations

### Idempotentes?

**No nível do runner: sim.** `aplicarMigrations` (`migrations.js:336-360`)
filtra `m.versao > atual` e grava `schema_version` após cada uma. Rodar duas
vezes → `atual = 5` → `pendentes = []` → não faz nada. Coberto por
`tests/db.test.js` ("aplicarMigrations é idempotente").

**Nos corpos individuais: não, e não precisa.** Migration 1 (`CREATE TABLE IF
NOT EXISTS` + `INSERT OR IGNORE`) e 2 (`garantirColuna` checa `PRAGMA
table_info` antes do `ALTER`) são idempotentes por si. As 3, 4 e 5 não são
(migration 3 faz `DROP TABLE` depois de copiar) — mas nunca rodam duas vezes
porque `schema_version` as barra.

### Processo morre no meio?

**Seguro.** Cada migration roda em `conn.transaction(() => { migration.up();
DELETE schema_version; INSERT schema_version })`. Kill do processo (SIGKILL,
OOM, queda de energia) no meio → o WAL/journal do SQLite garante rollback no
próximo open — sem commit parcial. O banco fica na `schema_version` anterior,
e `npm run migrate` de novo retenta aquela migration limpa. Como cada
migration é **um commit atômico próprio**, não existe estado "meio-migrado"
entre elas: se a 3 commitou e a 4 falhou, você fica em `schema_version = 3` e
o re-run começa da 4.

Nuance do `PRAGMA foreign_keys`: `aplicarMigrations` faz `foreign_keys = OFF`
**fora** da transação (antes) e `= ON` depois. Se o processo morre no meio, a
conexão morre junto; `abrirConexao` do próximo processo seta `= ON` de novo.
Sem estado "FK desligada" preso.

### Há backup antes? Há caminho de volta?

**Backup antes: não.** `scripts/migrate.js` chama `aplicarMigrations`
direto; nada copia o `.db` antes. A migration 3 reconstrói 4 tabelas
(drop + recria com CHECK + copia). Um bug na cópia commitaria dados
corrompidos com `schema_version = 3` e **sem snapshot pré-migração**. O
`README` fala em backup ("copie `data/app.db` periodicamente") mas nada no
fluxo de deploy (`npm run build && npm run migrate && npm start`) tira uma
cópia primeiro. → **F33**.

**Caminho de volta: não existe.** `migrations.js` só tem `up()`. Nenhum
`down()`. Voltar o **código** para uma versão que espera `schema_version = 4`
→ `getDb()` lança ("versão 5, esperada 4") e recusa subir → a recuperação é
restaurar de backup (que pode não existir — F30/F33) ou cirurgia manual
(`DELETE FROM schema_version; INSERT ... 4` + desfazer o schema da migration 5
na mão — e `DROP COLUMN` só existe em SQLite ≥ 3.35). → **F33**.

### `scripts/migrate.js` — detalhes

- Abre a **própria** conexão (`abrirConexao()`), não `getDb()` — **correto**,
  a migração precisa rodar contra um banco fora de versão.
- **Sem tratamento de erro.** Se `aplicarMigrations` lança, o script quebra
  com stack no terminal — aceitável para uma CLI (o operador vê). Mas o
  `conn.close()` está **depois** de `aplicarMigrations`, não num `finally` →
  em caso de erro, deixa `-wal`/`-shm` para trás. → **F36**.
- **Comentário obsoleto** (`migrate.js:1`): diz default `./data/barbosa.db`;
  o código usa `./data/app.db`. E `data/` do repo tem **os dois** (`app.db` e
  `barbosa.db` com WAL grande) — sinal de que algo já rodou contra o caminho
  errado (Etapa 1, pista 15). → **F36**.
- **`npm run migrate` com o servidor no ar** não é bloqueado nem avisado. A
  migration 3 (`DROP TABLE` dentro de transação) bloqueia as escritas do
  servidor por até `busy_timeout` (5 s) e pode 500 (`SQLITE_BUSY` / schema
  mudou). A sequência do README roda migrate **antes** do start, então deploy
  limpo está ok; o risco é o hotfix de migration numa caixa viva. → **F34**.

---

## 3. Processo único — o código assume um só Node?

**Não, em nenhum ponto que sustente carga.**

| Estado que poderia ser "de processo" | Onde vive de verdade | Multi-processo? |
|---|---|---|
| Rate limit | tabela `limitador` (`limitador.js`) | **compartilhado** ✓ |
| Sessão | token HMAC stateless, sem store no servidor (`auth.js`) | processo B valida token do A (mesmo `SESSION_SECRET`) ✓ |
| `sessao_versao` | tabela `config` | compartilhado ✓ |
| Conexão SQLite | singleton `db` **por processo** (`db.js:9`) | cada processo tem a sua ligação ao mesmo arquivo — WAL suporta 1 writer + N readers ✓ |
| Nonce da CSP | `crypto.randomUUID()` por requisição (`middleware.js:19`) | sem estado ✓ |

**PM2 cluster / 2 containers funciona hoje**, desde que:
- o **arquivo do banco** seja o mesmo (volume compartilhado, não só
  "persistente");
- o **diretório `public/uploads/`** seja compartilhado — o README pede
  "persistente" e admite "outro volume igualmente persistente" (README:163),
  o que permite dois containers com uploads **separados** (split-brain de
  imagens). → nota em **F30/F23**;
- as migrations rodem **antes** do rollout, não durante (F34) — senão os N
  processos 500 durante a transação da migration.

**Risco latente:** qualquer cache em memória adicionado no futuro (ex.: cache
de `lerConfig`, discutido e desaconselhado na Etapa 6) quebra sob multi-
processo — um `salvarConfig` num processo não invalida os outros, e
`sessao_versao`/`senha_hash` obsoletos afetam **correção de auth**. A Etapa 6
já recomenda não adicionar; esta etapa reforça o porquê.

---

## 4. Backup e restauração de SQLite em WAL

**Documentado:** `README.md:180-185` — "Copie `data/app.db` periodicamente" +
"copie `public/uploads/` junto".

**O procedimento documentado está errado para WAL:**

- Em WAL, commits recentes ficam em **`data/app.db-wal`** e ainda não foram
  aplicados ao arquivo principal. Copiar **só `app.db`** num sistema em
  operação captura um banco **sem as transações mais recentes** — de minutos
  a **dias** de agendamentos, dependendo da cadência de checkpoint (o
  auto-checkpoint do SQLite dispara a ~1000 páginas do WAL ≈ 4 MB; numa
  barbearia de pouca escrita o WAL segura muito tempo antes disso).
- Um `cp app.db backup.db` durante uma escrita pode capturar uma **página
  rasgada** (cópia inconsistente).

**Procedimentos corretos (nenhum documentado):**
- `sqlite3 data/app.db ".backup data/backup.db"` (API de backup online,
  consistente, inclui o conteúdo do WAL); ou
- `sqlite3 data/app.db "VACUUM INTO 'data/backup.db'"`; ou
- `better-sqlite3` tem `db.backup(path)`; ou
- parar o app → `PRAGMA wal_checkpoint(TRUNCATE)` → copiar os **três**
  arquivos (`app.db`, `-wal`, `-shm`) → subir; ou
- snapshot atômico de volume/filesystem.

**Restauração: não documentada.** Para restaurar corretamente: parar o app,
substituir `app.db`, e **apagar `app.db-wal` e `app.db-shm`** — um WAL/SHM
obsoleto contra um arquivo principal restaurado dá `database disk image is
malformed`. O README não menciona esse passo. → **F30**.

**Sem restore testado.** O próprio plano de correção lista "Backup com restore
testado" como pendência fora de prompt — mas a auditoria precisa registrar
que o procedimento **atual** produz cópia inconsistente/desatualizada e que
não há runbook de restauração, num sistema que guarda a **única** cópia da
agenda do negócio.

---

## 5. Entrega com banco zerado — primeiro acesso da dona

Seed da migration 1:
- `config`: nome/slogan/whatsapp/endereço/instagram/logo **vazios**;
  `intervalo_min=30`, `antecedencia_min=60`, `dias_futuros=90`,
  `confirmacao_automatica=1`, `sessao_versao=1`.
- `expediente`: 7 linhas — **domingo fechado**, seg–sex 09:00–20:00, sábado
  08:00–18:00. Default operacional brasileiro razoável.
- **Zero** barbeiros, serviços, produtos. Sem `senha_hash` →
  `usandoSenhaInicial() = true`.

Simulação — a dona abre `/admin` pela primeira vez:

1. **Login.** A tela de login lê `/api/public` para mostrar o nome → **vazio**
   → título neutro. Ela entra com o `ADMIN_PASSWORD` do `.env` (que em
   produção **precisa** ser um valor real, senão 503).
2. **Painel travado na troca de senha.** `exigirSessao` devolve 403 para tudo
   exceto `POST /api/admin/senha` e `GET /api/admin/config`. `Configuracoes`
   abre na aba "Senha", com aviso claro: "Você ainda está usando a senha
   inicial… Defina uma senha sua agora."
3. **Troca a senha** → `sessao_versao` sobe, ela segue logada, painel
   destrava.
4. **Visão Geral** — cartões de KPI todos em **zero / R$ 0,00**; "Quem
   trabalha hoje" → `<Vazio>` "Nenhum profissional ativo — cadastre a equipe
   em Profissionais"; "Últimos agendamentos" → `<Vazio>` "Ainda não chegou
   nenhum agendamento". **Mitigado** pelo bloco **"Primeiros passos"**
   (`VisaoGeral.jsx:133-185`, Etapa 9): checklist de 5 itens — senha própria,
   nome+WhatsApp, profissionais, serviços+vínculos, conferir expediente —
   com o recado "sem cadastrar serviços, o site não aceita agendamento" e um
   botão "Já conferi" para o expediente. Some sozinho quando os 5 estão
   feitos.
5. **Serviços / Profissionais** vazios, com `<Vazio>` explicando a
   consequência ("Enquanto não houver serviço, o agendamento fica fechado").
   A ordem é imposta: não dá para salvar serviço sem ≥ 1 profissional
   vinculado.
6. **Site público com zero serviços:** `/api/public` → `servicos: []` →
   `FluxoAgendamento` mostra "Agenda ainda não está aberta / … fale com a
   barbearia direto pelo WhatsApp" — **mas `whatsapp` é `""`**, então a frase
   promete um canal que não existe (sem link, sem número). Rugosidade menor.
7. **Home `/`** renderiza sem nome, sem slogan, sem endereço, sem logo — a
   Etapa 5 do plano ("white-label") era para deixar isso "digno"; é front-end,
   fora do escopo desta etapa, mas vale a conferência visual.

**Coerente?** **Sim, no essencial.** O seed produz um estado vazio *usável*:
troca de senha forçada, checklist de onboarding com boa cópia, `<Vazio>` em
toda tela, defaults operacionais sãos. Arestas: a frase "fale pelo WhatsApp"
sem número quando `whatsapp` está vazio, e o mural de zeros na Visão Geral
(atenuado pelo checklist). Nada **quebrado** — nada lança, nada fica num
estado incoerente. → **F37 (P3)** para a frase do WhatsApp sem link.

---

## 6. `/api/health`

```
GET → try { getDb().prepare("SELECT 1").get() } catch → problemas.push("banco")
      if (!diretorioGravavel(public/uploads)) problemas.push("uploads")
      problemas.length ? 503 {ok:false} : 200 {ok:true}
```

**Entrega o que um monitor precisa?** Para um probe up/down (UptimeRobot,
health check de load balancer): **sim** — um 200/503 limpo, sem corpo
sensível. **Não expõe detalhe** (sem versão, sem caminho, sem config). ✓

**Pontos cegos:**

- **Disco cheio → não detecta.** `SELECT 1` é leitura (funciona em WAL mesmo
  com disco cheio); `diretorioGravavel` faz `fs.accessSync(W_OK)`, que é
  checagem de **permissão**, não de **espaço**. Resultado: `{ok:true}`
  enquanto toda escrita 500. → **F32**.
- **Filesystem somente-leitura (EROFS) → não detecta.** Mesmo motivo — só
  lê. Um volume montado `ro`, ou a Vercel, passam no health.
- **Sem diagnóstico.** Um 503 real (banco não migrado, config insegura,
  arquivo ausente) volta só `{ok:false}`. O monitor/operador não distingue
  "rode a migration" de "disco cheio" de "arquivo não existe". → **F32**.
- **Schema desatualizado / `verificarAmbiente` → é detectado** (o `throw` de
  `getDb()` cai no `catch` → 503). Isso está certo.

**Correção sugerida:** o check de gravabilidade deveria **tentar uma escrita
trivial** (INSERT + rollback numa linha de heartbeat, ou write+unlink de um
tempfile no diretório do banco) para pegar ENOSPC/EROFS; e o 503 poderia
carregar um campo `motivo` curto e não-sensível (`"migracao"` / `"disco"` /
`"config"`) — o suficiente para o operador agir sem expor nada.

---

## 7. Logs e auditoria — PII, retenção, volume

### PII nos logs — **limpo**

`log.js` escreve `{ ts, nivel, rota, msg, ...contexto }` no stdout. Todo
`contexto` passado no código:

| Chamada | Contexto | PII? |
|---|---|---|
| `registrarInfo(ROTA, "agendamento criado", { agendamentoId })` | só o id | não |
| `registrarInfo(ROTA_PATCH, 'status … mudou para "X"', { agendamentoId })` | id + status | não |
| `registrarInfo(..., "agendamento remarcado"/"excluído", { agendamentoId })` | id | não |
| `registrarAviso(ROTA, "login falho" / "login bem-sucedido")` | — | não (senha nunca; testado em `tests/log-login.test.js`) |
| `registrarAviso(ROTA, "bloqueado por limite de tentativas")` | — | não (nem o IP) |
| `registrarErro(ROTA, "banco indisponível", erro)` | `error.message` | pode conter **caminho de arquivo** (`unable to open database file: /data/app.db`) — dado operacional, não PII |
| `comLog` catch → `registrarErro(rota, "erro não tratado", erro)` | `error.message` **sem stack** (`log.js:22-28`) | as mensagens de conflito com nome de cliente (`"X já atende Fulano…"`) são **capturadas por `tratarErroTransacao`** e viram `{ok:false}`, não são lançadas — não chegam aqui |

**Nome ou telefone de cliente não aparece em log nenhum.** Disciplina boa:
id em vez de nome, senha nunca, stack nunca.

### PII na auditoria — **limpo para dado de cliente**

`snapshotAgendamento` (`auditoria.js:25-35`) devolve só `{barbeiro_id,
servico_id, data, inicio, fim, status, preco_centavos}` — **sem
`cliente_nome`, sem `cliente_telefone`**. Verificado nos 6 pontos de chamada
de `registrarAuditoria` (criar / remarcar / status / excluir / alterar_preco
/ trocar_senha / config). O `trocar_senha` não grava `antes`/`depois`.

Exceção menor: o audit de `PUT /api/admin/config` grava `whatsapp`,
`endereco`, `nome_barbearia` nos campos `antes`/`depois` — dado **do
negócio**, público, não PII de cliente. → nota em **F35**.

### Retenção

| Fonte | Retenção hoje | Sustentável? |
|---|---|---|
| **Logs (stdout)** | nenhuma no app; 100 % do host | ~7 MB/ano em regime normal (Etapa 6). **Sob ataque F19/F20, MB/hora** — cada request bloqueado gera uma linha (F27). Rotação no host não é mencionada no README. |
| **`auditoria`** | **nenhuma** — nunca é podada, nenhuma tela lê | ~9 MB/ano, ~45 MB em 5 anos. Não atrapalha performance (nenhum caminho quente consulta; `idx_auditoria_tabela_registro` cobre busca por registro). Mas é uma tabela que só cresce, sem plano. → **F35** |
| **`limitador`** | janela de 1 dia, limpeza amostrada a 1 % | sim — Etapa 6 §5 |
| **Uploads** | `anterior`-delete cobre a troca; **não** cobre a pasta `"geral"`, nem imagem de cadastro excluído, nem troca sem `anterior` | poucos MB/ano de órfãos; o problema real é F23 (não sobrevive a deploy) |

**O que precisa de política de retenção, em ordem:** (1) logs — rotação no
host no runbook + amostrar o log de bloqueio no código (F27); (2)
`auditoria` — decidir janela (ex.: 24 meses on-line, resto arquivado em
NDJSON) — F35; (3) uploads órfãos — job de limpeza, depois de F23.

---

## 8. Achados

Formato: `ID | Severidade | Arquivo:linha | O que está errado | Quando quebra | Método de correção | Esforço | Risco de mexer`

### F30 — Procedimento de backup documentado é errado para WAL; restauração não documentada

| Campo | Conteúdo |
|---|---|
| **Severidade** | **P1** |
| **Arquivo:linha** | `README.md:180-185` (seção "Backup"); ausência de rotina de backup no código / deploy |
| **O que está errado** | O README manda "copie `data/app.db` periodicamente". Em WAL, os commits recentes vivem em `data/app.db-wal` e ainda não estão no arquivo principal — copiar só `app.db` num sistema vivo perde de minutos a dias de agendamentos, e um `cp` durante uma escrita pode capturar página rasgada. A restauração não é documentada — em especial, o passo obrigatório de **apagar `-wal`/`-shm` obsoletos** ao restaurar (senão: `database disk image is malformed`). É a única cópia da agenda do negócio. |
| **Quando quebra** | O servidor morre, a dona (ou o cron) tem só um `app.db` copiado ao vivo → faltam as últimas horas/dias de agendamento, ou o arquivo está corrompido. Ou ela restaura o `app.db` sem remover o `-wal` antigo → o banco não abre. |
| **Método de correção** | Documentar e automatizar UM procedimento consistente: `sqlite3 data/app.db ".backup <destino>"` ou `VACUUM INTO`, ou snapshot de volume, rodado por cron; incluir `public/uploads/` no mesmo backup. Escrever o runbook de **restauração** (parar o app → substituir `app.db` → apagar `app.db-wal` e `app.db-shm` → subir → conferir). Testar o restore num banco de verdade antes do go-live. |
| **Esforço** | Baixo (script + doc) — o valor está no restore testado. |
| **Risco de mexer** | Baixo (é doc + script à parte, não toca o app). |

### F31 — Sem validação no boot; banco/config quebrado só aparece no 1º request como 500 genérico

| Campo | Conteúdo |
|---|---|
| **Severidade** | **P2** |
| **Arquivo:linha** | `src/lib/db.js:22-48` (checagem lazy dentro de `getDb()`); `src/lib/log.js:35-47` (`comLog` transforma o `throw` em 500 genérico); `src/app/api/health/route.js` |
| **O que está errado** | `next start` sobe "com sucesso" mesmo com banco não migrado, `SESSION_SECRET` ausente ou `DATABASE_PATH` inválido. A falha é adiada para a 1ª requisição, chega ao visitante como "Algo deu errado." e ao operador só no stdout. Em produção, `SESSION_SECRET` ausente derruba o site público inteiro, não só o painel. |
| **Quando quebra** | Deploy em que se esqueceu `npm run migrate` (ou uma migration nova foi adicionada e o operador redeployou sem rodar); ou a variável de ambiente não foi setada no host. Processo no ar, site 500, e ninguém percebe até um cliente reclamar — a menos que alguém esteja com o `tail -f` aberto. |
| **Método de correção** | Um hook de startup (Next 14: `instrumentation.ts` / `register()`) que chama `getDb()` uma vez e, se lançar, escreve a mensagem no stderr e `process.exit(1)` — falha no boot, não no 1º request. Alternativa/adicional: o script de deploy roda `node -e "require('./src/lib/db.js').getDb()"` como pré-flight depois do `migrate`. E fazer `/api/health` distinguir os motivos (F32). |
| **Esforço** | Baixo. |
| **Risco de mexer** | Baixo — `instrumentation` roda 1×/processo; não muda o caminho de requisição. |

### F32 — `/api/health` não detecta disco cheio nem filesystem somente-leitura, e não diz por que está 503

| Campo | Conteúdo |
|---|---|
| **Severidade** | **P2** |
| **Arquivo:linha** | `src/app/api/health/route.js:12-30`; `src/lib/config-ambiente.js:42-52` (`diretorioGravavel` usa `fs.accessSync(W_OK)` — permissão, não espaço) |
| **O que está errado** | O health faz `SELECT 1` (leitura) + `access(W_OK)` (permissão). Um disco cheio ou um volume montado `ro` deixam a leitura passar e a permissão intacta → health responde `{ok:true}` enquanto toda escrita 500. E um 503 legítimo (banco não migrado, config insegura) volta só `{ok:false}` — o monitor não sabe se é migração, disco ou arquivo ausente. |
| **Quando quebra** | O disco enche (logs sem rotação — F27 — são um jeito plausível de encher). O monitoramento continua verde. A dona descobre que o site parou de gravar agendamento quando um cliente liga reclamando. |
| **Método de correção** | Trocar o check de gravabilidade por uma **escrita trivial** de verdade: INSERT + rollback numa linha de heartbeat, ou write+unlink de um tempfile no diretório do banco — pega `ENOSPC`/`EROFS`. Adicionar ao corpo do 503 um campo `motivo` curto e não-sensível (`"migracao"`/`"disco"`/`"config"`/`"banco"`). |
| **Esforço** | Baixo. |
| **Risco de mexer** | Baixo. |

### F33 — Migração roda sem backup automático e sem caminho de rollback

| Campo | Conteúdo |
|---|---|
| **Severidade** | **P2** |
| **Arquivo:linha** | `scripts/migrate.js:13-16` (chama `aplicarMigrations` direto, sem cópia prévia); `src/lib/migrations.js` (só `up()`, nenhum `down()`); `README.md:172-178` (sequência de build sem passo de backup) |
| **O que está errado** | Nada copia o `.db` antes de aplicar migrations. A migration 3 reconstrói 4 tabelas (drop + copia). Um bug ali commitaria dados corrompidos sem snapshot para voltar. Não há `down()` — voltar o código para antes de uma migration faz `getDb()` recusar subir ("versão X, esperada Y"), e a recuperação vira restore-de-backup (que pode não existir — F30) ou SQL manual. |
| **Quando quebra** | Uma migration futura com bug, ou um rollback de deploy emergencial: o banco fica preso numa versão que o código não aceita, sem cópia anterior. |
| **Método de correção** | `scripts/migrate.js` faz `sqlite3 ... ".backup"` (ou copia os 3 arquivos após `wal_checkpoint(TRUNCATE)`) para `data/pre-migracao-<timestamp>.db` **antes** de `aplicarMigrations`, e mantém as N últimas. Documentar que rollback = parar, restaurar o snapshot pré-migração, voltar o código. Opcional: escrever `down()` para as migrations reversíveis (2, 4, 5). |
| **Esforço** | Baixo (backup no script) a médio (`down()`). |
| **Risco de mexer** | Baixo. |

### F34 — `npm run migrate` num servidor vivo é possível e sem aviso

| Campo | Conteúdo |
|---|---|
| **Severidade** | **P3** |
| **Arquivo:linha** | `scripts/migrate.js` (abre 2ª conexão ao mesmo arquivo, sem checar se o servidor está rodando) |
| **O que está errado** | A migration 3 (`DROP TABLE` dentro de transação) pega o write lock e bloqueia as escritas do servidor por até `busy_timeout` (5 s); pode fazer o servidor 500 (`SQLITE_BUSY` não tratado — Etapa 2 F2 — ou "schema mudou"). Nada avisa contra rodar migrate com tráfego. |
| **Quando quebra** | Operador aplica uma migration nova numa caixa em produção sem parar o serviço primeiro. Alguns segundos de 500 no agendamento público durante a transação. |
| **Método de correção** | `scripts/migrate.js` avisa/aborta se detectar o servidor no ar (ex.: um lockfile que o app cria, ou checar a porta), ou o README deixa explícito "pare o app antes de `npm run migrate`". Amarra com a correção de `SQLITE_BUSY → 409/503` da Etapa 2 (F2). |
| **Esforço** | Baixo. |
| **Risco de mexer** | Baixo. |

### F35 — `auditoria` sem política de retenção; audit de config carrega telefone/endereço do negócio

| Campo | Conteúdo |
|---|---|
| **Severidade** | **P3** |
| **Arquivo:linha** | `src/lib/migrations.js:296-307` (tabela `auditoria`, nunca podada); `src/app/api/admin/config/route.js:69-77` (`antes`/`depois` incluem `whatsapp`/`endereco`/`nome_barbearia`) |
| **O que está errado** | `auditoria` só cresce (~9 MB/ano), nenhuma tela lê, nenhum plano de arquivamento. Não é problema de performance, mas é uma tabela sem ciclo de vida. O audit de `PUT /api/admin/config` grava o WhatsApp e o endereço da barbearia em texto claro em `antes`/`depois` — dado do negócio (público), não PII de cliente, mas fica registrado em cada alteração. |
| **Quando quebra** | Não "quebra" — acumula. Em 5+ anos, dezenas de MB de trilha que ninguém consulta e nunca foi arquivada. |
| **Método de correção** | Definir janela de retenção (ex.: 24 meses on-line; export NDJSON do resto antes de apagar) e um job que a aplica. Se o WhatsApp/endereço não precisam estar no audit, trocar por um marcador ("config alterada: whatsapp, endereco") em vez do valor. |
| **Esforço** | Baixo. |
| **Risco de mexer** | Baixo. |

### F36 — `scripts/migrate.js`: comentário obsoleto, `close()` fora de `finally`

| Campo | Conteúdo |
|---|---|
| **Severidade** | **P3** |
| **Arquivo:linha** | `scripts/migrate.js:1-2` (comentário diz `./data/barbosa.db`; código usa `./data/app.db`); `:13-16` (`conn.close()` não está em `finally`) |
| **O que está errado** | O comentário mente sobre o caminho default — e `data/` do repo tem `app.db` **e** `barbosa.db` (com WAL grande), indício de que algo rodou contra o caminho errado em algum momento. Em erro de migração, o `conn.close()` não roda e sobram `-wal`/`-shm`. |
| **Quando quebra** | Confusão do operador sobre qual arquivo é o banco de verdade; arquivos `-wal`/`-shm` órfãos depois de uma migração que falhou. |
| **Método de correção** | Corrigir o comentário para `./data/app.db`. Pôr `aplicarMigrations` num `try` e `conn.close()` num `finally`. Apagar/renomear o `data/barbosa.db` obsoleto do repo (é git-ignored — só limpeza local). |
| **Esforço** | Trivial. |
| **Risco de mexer** | Nenhum. |

### F37 — Site público com config vazia convida "fale pelo WhatsApp" sem número

| Campo | Conteúdo |
|---|---|
| **Severidade** | **P3** |
| **Arquivo:linha** | `src/app/agendar/FluxoAgendamento.jsx:453-464` (estado "sem serviços" sugere WhatsApp) — depende de `dados.barbearia.whatsapp`, que no banco zerado é `""` |
| **O que está errado** | No dia 1 (sem serviços cadastrados), o fluxo de agendamento mostra "Agenda ainda não está aberta… fale com a barbearia direto pelo WhatsApp" — mas `whatsapp` está vazio, então não há link nem número. A frase promete um canal inexistente. |
| **Quando quebra** | Entre a entrega e o primeiro cadastro completo, qualquer visitante do site vê a mensagem sem ação possível. Some assim que a dona cadastra serviços. |
| **Método de correção** | Condicionar a frase ao `whatsapp` estar preenchido (mostrar o link só quando houver número; texto neutro quando não houver). É front-end — anotar para a reescrita. |
| **Esforço** | Trivial. |
| **Risco de mexer** | Nenhum (front-end). |

---

## 9. O que está correto (para contraste)

- **Os quatro modos de falha de boot falham fechado** — recusam servir /
  gravar em vez de subir inseguro. As mensagens, onde aparecem, são claras e
  acionáveis.
- **Migrations são crash-safe:** runner idempotente (testado), cada migration
  é um commit atômico próprio → kill do processo no meio → rollback limpo →
  re-run continua de onde parou.
- **Nenhuma suposição de processo único sustenta carga:** rate limit na
  tabela `limitador`, sessão em token HMAC stateless. PM2 cluster / 2
  containers funciona com banco e uploads compartilhados.
- **Logs limpos de PII de cliente:** id em vez de nome, senha nunca (testado),
  stack trace nunca (`error.message` apenas).
- **`auditoria` limpa de PII de cliente:** `snapshotAgendamento` exclui
  `cliente_nome`/`cliente_telefone` por construção, verificado em todos os
  pontos de chamada.
- **Entrega zerada é coerente:** troca de senha forçada, checklist de
  primeiros passos em `VisaoGeral` (5 passos, boa cópia, some sozinho),
  `<Vazio>` explicando a consequência em cada tela, defaults operacionais
  sãos (expediente, antecedência, janela de dias).
- **`/api/health` não vaza detalhe** — `{ok:true|false}` e nada mais; adequado
  para um probe up/down.
- **`scripts/migrate.js` usa a própria conexão** (não `getDb()`), então roda
  contra um banco fora de versão sem esbarrar na checagem — correto.
