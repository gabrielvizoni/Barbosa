# 06 — Desempenho e crescimento

Escopo: `src/app/api/admin/resumo/route.js`, `src/lib/db.js`, `src/lib/slots.js`,
`src/lib/limitador.js`, seção de índices de `auditoria/01-mapa.md`. Também
`PainelAdmin.jsx` / `VisaoGeral.jsx` (quem chama o quê e quando).

Verificação: leitura + schema real das migrations (não suposição) + `npm test`
(114/114). Sem experimento de carga nesta etapa — as estimativas são
analíticas, com o modelo de dados abaixo declarado.

## Modelo de operação assumido

Uma unidade, **3 profissionais**, **~35 agendamentos/dia** em ~26 dias
úteis/mês → **~11.000 agendamentos/ano**. Bloqueios ~3/dia → ~800/ano.
Auditoria ~2,5 linhas por agendamento (criar + confirmar/concluir/cancelar) →
**~28.000 linhas/ano**.

| Tabela | 1 ano | 2 anos | 5 anos |
|---|---|---|---|
| `agendamentos` (linhas) | ~11 k | ~22 k | ~55 k |
| `auditoria` (linhas) | ~28 k | ~56 k | ~140 k |
| `bloqueios` (linhas) | ~800 | ~1,6 k | ~4 k |
| `limitador` (linhas) | < 1 k (janela de 1 dia) | idem | idem |

Custo de varredura sequencial (cache de página quente, WAL, linhas pequenas):
**~0,15 µs/linha** para `COUNT`/`SUM` com predicado simples. Cache frio
(logo após restart, ou tabela despejada): **×5 a ×10**.

**Premissa central:** better-sqlite3 é síncrono e o Next roda em uma única
thread. **Toda** query bloqueia o event loop pelo tempo que leva — durante
uma query de 30 ms, `/api/public`, `/api/horarios` e `POST /api/agendamentos`
ficam **congelados** para todos os clientes.

---

## 1. Consultas mais caras — começando pelo resumo

### 1.1 `GET /api/admin/resumo`, query a query

Chamado por `VisaoGeral.jsx:54` (`api("resumo")`) e pela tela de Financeiro —
**a cada abertura da tela**, não em timer. Cada abertura = ~30 statements.

| Query (linha) | Índice usado | Linhas tocadas | 1 ano | 2 anos | 5 anos | Cresce? |
|---|---|---|---|---|---|---|
| `doDia` (`:143`) `WHERE data = ? AND excluido_em IS NULL` | `idx_ag_data` | 1 dia ≈ 35 | ~0,05 ms | ~0,05 ms | ~0,05 ms | **não** |
| `agendaHoje` (`:155`) LEFT JOIN por `(barbeiro_id, data)` | `idx_ag_barbeiro` | 3 barbeiros × ~12 | ~0,1 ms | ~0,1 ms | ~0,1 ms | **não** |
| **`recentes` (`:169`)** `WHERE excluido_em IS NULL ORDER BY criado_em DESC LIMIT 8` | **nenhum** (`criado_em` sem índice) | **tabela inteira** + top-8 | ~1,7 ms | ~3,3 ms | **~8 ms** | **sim, linear** |
| **`pendentesTotal` (`:175`)** `WHERE status = 'pendente' AND excluido_em IS NULL` | **nenhum** (`status` sem índice) | **tabela inteira** | ~1,7 ms | ~3,3 ms | **~8 ms** | **sim, linear** |
| `totaisPorMes` (`:53`) janela de 24 meses, `GROUP BY substr(data,1,7)` | `idx_ag_data` (range) | ~24 × 910 ≈ 22 k **fixo** | ~3 ms | ~3 ms | ~3 ms | não (janela fixa) |
| `totaisDoMes(mes)` (`:85`) — 3 queries, janela de 1 mês | `idx_ag_data` (range) | ~910 × 3 | ~0,4 ms | ~0,4 ms | ~0,4 ms | não |
| `totaisDoMes(comparar)` (`:85`) — mais 3 queries | `idx_ag_data` (range) | ~910 × 3 | ~0,4 ms | ~0,4 ms | ~0,4 ms | não |
| `porServico` (`:206`) janela de 1 mês, `GROUP BY CASE` | `idx_ag_data` (range) | ~910 | ~0,4 ms | ~0,4 ms | ~0,4 ms | não |
| `porBarbeiro` (`:218`) janela de 1 mês, `GROUP BY CASE` | `idx_ag_data` (range) | ~910 | ~0,4 ms | ~0,4 ms | ~0,4 ms | não |
| **`geralRealizado` (`:230`)** `WHERE status = 'concluido' AND excluido_em IS NULL` — **sem filtro de data** | **nenhum** | **tabela inteira** | ~1,7 ms | ~3,3 ms | **~8 ms** | **sim, linear** |
| **`geralPrevisto` (`:237`)** `WHERE status IN ('pendente','confirmado') AND excluido_em IS NULL` — **sem filtro de data** | **nenhum** | **tabela inteira** | ~1,7 ms | ~3,3 ms | **~8 ms** | **sim, linear** |
| ~30 × `conn.prepare(...)` (compilação de SQL) | — | — | ~0,5 ms | ~0,5 ms | ~0,5 ms | não |

**Total do `resumo` (cache quente):** **~1 ano ≈ 12 ms · 2 anos ≈ 18 ms ·
5 anos ≈ 40 ms.** Cache frio (logo após deploy/restart): **~5 anos ≈ 150–300 ms.**

Quatro varreduras de tabela inteira (`recentes`, `pendentesTotal`,
`geralRealizado`, `geralPrevisto`) dominam e são as únicas que crescem. As
janelas de mês/24-meses são O(constante) — o trabalho da Etapa 7 (24 queries
→ 1) resolveu a parte que crescia ali.

**Bloqueia requisições concorrentes?** **Sim.** Enquanto a dona abre a Visão
Geral ou o Financeiro, o site público fica congelado por ~12 ms hoje, ~40 ms
em 5 anos (quente) ou ~0,2 s+ frio. Não é catastrófico, mas é trabalho
evitável, e some se as 4 varreduras virarem index scan / ganharem limite de
data.

### 1.2 Outras consultas caras (fora do resumo)

| Query | Arquivo | Índice | 5 anos (quente) | Bloqueia? |
|---|---|---|---|---|
| **`GET /api/admin/pendentes`** `SELECT COUNT(*) WHERE status='pendente' AND excluido_em IS NULL` | `pendentes/route.js:12` | **nenhum** | **~8 ms** | **sim** — e roda **a cada troca de seção do painel** (`PainelAdmin.jsx:144-146`), não em timer, mas várias vezes por sessão de uso. É a mesma varredura do `pendentesTotal`. |
| `GET /api/admin/agendamentos` — `SELECT COUNT(*) FROM agendamentos <where> ` (paginação) | `agendamentos/route.js:46` | depende do filtro; sem filtro → **nenhum** | **~8 ms** sem filtro | **sim** — a cada abertura da lista e a cada busca |
| `GET /api/admin/agendamentos` — `... ORDER BY data DESC, inicio DESC LIMIT ? OFFSET ?` | `agendamentos/route.js:51` | `idx_ag_data` cobre `data`, não `inicio` → sort parcial | ~1–3 ms página 1; pior em páginas fundas | sim |
| `GET /api/admin/agendamentos` com `busca` → `cliente_nome LIKE '%x%'` | `agendamentos/route.js:27` | **nenhum possível** (curinga à esquerda) | **~8–15 ms** por busca, a cada tecla que dispara o efeito | sim |
| `listarBloqueios()` `SELECT b.*, bb.nome … ORDER BY b.data DESC, b.inicio` — **sem WHERE** | `db.js:127-135` | `idx_bloq_data` não ajuda sem WHERE | ~0,6 ms (4 k linhas) | leve, mas 100 % desnecessário — lê todo bloqueio já criado |
| `horariosLivres()` | `slots.js:112` | `idx_ag_barbeiro` + `idx_bloq_data` | **~0,5 ms em qualquer horizonte** — limitado a 1 dia de 1 barbeiro | não é problema |
| `POST /api/agendamentos` (`criarAgendamento`) | `agendamentos.js` | point lookups + `horariosLivres` | **~1–2 ms** | segura o write lock por ~1 ms; ok |
| `GET /api/public` | `public/route.js` | tabelas pequenas + `diasDisponiveis` (loop JS) | ~1 ms **se `dias_futuros` ≤ 90** | ok (ver F9 da Etapa 3 se `dias_futuros` abusado) |

**Resumo do bloqueio:** o caminho público quente (`/api/public`,
`/api/horarios`, `POST /api/agendamentos`) **permanece rápido em todos os
horizontes** porque tudo ali é indexado por `(barbeiro_id, data)` ou `data` e
limitado a um dia. O que degrada e congela o público é **o painel**: o
resumo, o badge de pendentes e a lista de agendamentos, todos com varredura
de tabela que cresce linearmente.

---

## 2. Trabalho repetido por requisição — `lerConfig()` e expediente

### `lerConfig()`

`lerConfig()` = `SELECT chave, valor FROM config` (~13 linhas) + montar
objeto + 1 `prepare()`. Custo isolado: **~0,05 ms**.

| Caminho crítico | Chamadas a `lerConfig()` | Onde |
|---|---|---|
| **`exigirSessao()`** (todo request admin) | **3×** | `usandoSenhaInicial()` (`auth.js:162`) via `autenticacaoConfiguradaComSeguranca`; `tokenValido()` (`auth.js:228`) para `sessao_versao`; `usandoSenhaInicial()` de novo (`auth.js:287`) |
| `GET /api/horarios` | 1× | `horariosLivres` → `lerConfig()` (`slots.js:114`) |
| `POST /api/agendamentos` (público) | **3×** | `criarAgendamento` (`confirmacao_automatica`) + `verificarConflito`→`horariosLivres`→`lerConfig` + a rota no fim (`nome_barbearia`/`whatsapp`) |
| `GET /api/public` | 1× | `public/route.js:11` |
| `GET /api/admin/resumo` | 3× (só do `exigirSessao`) | — |

### Leitura de expediente

- `horariosLivres`: **1 linha** (`SELECT * FROM expediente WHERE dia = ?`) —
  `idx` de PK. Barato.
- `diasDisponiveis`: **7 linhas** (`SELECT * FROM expediente`), 1×/`/api/public`.
- `GET /api/admin/config`: 7 linhas (`lerExpediente`).

Nenhuma leitura de expediente é cara (tabela de 7 linhas, PK).

### Vale cache em memória?

**Para desempenho puro nesta escala: não.** A tabela `config` tem 13 linhas;
3 leituras extras por request admin custam < 0,15 ms somadas, e ~200
requests admin/dia → ~30 ms/dia de trabalho evitável. Irrelevante.

**O ganho real e sem risco é desduplicar dentro do request:** `exigirSessao`
deveria ler `lerConfig()` **uma vez** e reusar `senha_hash` e `sessao_versao`
nas duas checagens — elimina 2 das 3 chamadas sem cache nenhum, sem
invalidação, sem risco.

**Se ainda quiserem um cache de módulo** (para também pular o `prepare()`):

- Seguro **só com processo único**. Um segundo worker Node, ou um
  `npm run migrate`/script rodando em paralelo, deixa o cache obsoleto sem
  aviso.
- A invalidação correta precisa cobrir **todo escritor de `config`**:
  `salvarConfig()` (usado pelo `PUT /api/admin/config` e por `trocarSenha()`)
  e `salvarExpediente()`. Marcar um flag `configObsoleto = true` nesses
  pontos e reler na próxima chamada.
- **O risco é de correção de auth, não de performance:** um `sessao_versao`
  em cache obsoleto continuaria aceitando sessões que já deviam ter caído
  numa troca de senha; um `senha_hash` obsoleto rejeitaria a senha nova. Por
  isso, se um cache for adicionado, **dar um TTL curto (ex.: 5 s)** como rede
  contra invalidação esquecida, além dos hooks nos escritores.
- **Recomendação:** desduplicar no request (item acima) e **não** adicionar
  cache. O custo não justifica pôr a expiração de sessão na mão de uma
  invalidação de cache.

---

## 3. Índices ausentes — confirmados contra o schema

Índices que **existem** hoje (migrations 1, 3, 4, 5):
`idx_ag_data (data)`, `idx_ag_barbeiro (barbeiro_id, data)`,
`idx_ag_sem_duplicidade UNIQUE (barbeiro_id, data, inicio) WHERE status <> 'cancelado'`,
`idx_bloq_data (data)`, `idx_limitador_chave (chave, criado_em)`,
`idx_auditoria_tabela_registro (tabela, registro_id)`.

### Ausentes, por prioridade

| # | Índice sugerido | Query(s) beneficiada(s) | Ganho |
|---|---|---|---|
| 1 | `CREATE INDEX idx_ag_pendentes ON agendamentos(id) WHERE status = 'pendente' AND excluido_em IS NULL` (parcial) | `resumo` `pendentesTotal` (`resumo/route.js:175`); **`GET /api/admin/pendentes`** (`pendentes/route.js:12`) | de varredura de tabela inteira (~8 ms em 5 anos) para **~0,1 ms constante** — pendentes são sempre dezenas. É o badge que roda a cada troca de seção do painel. |
| 2 | `CREATE INDEX idx_ag_criado ON agendamentos(criado_em) WHERE excluido_em IS NULL` (parcial) | `resumo` `recentes` `ORDER BY criado_em DESC LIMIT 8` (`resumo/route.js:169`) | de varredura + top-8 (~8 ms em 5 anos) para **caminhar 8 entradas do índice — ~0,05 ms constante**. |
| 3 | `CREATE INDEX idx_ag_data_inicio ON agendamentos(data, inicio)` | `GET /api/admin/agendamentos` `ORDER BY data DESC, inicio DESC` (`agendamentos/route.js:51`); e o `atropelados` do `POST bloqueios` (`[recurso]/route.js:162`) | ordenação vira index-only; sort parcial some. Ganho médio; a lista tem outros custos (o `COUNT(*)`, o `LIKE`). |
| 4 | `CREATE INDEX idx_ag_servico ON agendamentos(servico_id)` | `DELETE /api/admin/[recurso]/[id]` de serviço: `SELECT COUNT(*) WHERE servico_id = ?` (`[recurso]/[id]/route.js:104`) | `barbeiro_id` já é coberto por `idx_ag_barbeiro`; `servico_id` não tem nada → varredura. Operação rara (excluir serviço), mas o índice é barato. Baixa prioridade. |

### Não resolvem com índice — precisam de mudança de query

- **`geralRealizado` / `geralPrevisto`** (`resumo/route.js:230,237`): `WHERE
  status = 'concluido'` **sem filtro de data**. Um índice em `status` não
  ajuda de verdade — `'concluido'` vira a maioria da tabela com o tempo, e o
  index scan ≈ varredura. A correção é **dar um limite de data** ("faturamento
  geral" = últimos 24 meses, como a série já faz) ou computar
  incrementalmente. Sem isso, cada abertura do Financeiro relê **todo
  atendimento concluído da história** — duas vezes.
- **`GET /api/admin/agendamentos` — `SELECT COUNT(*)` sem filtro**
  (`agendamentos/route.js:46`): necessário para a UI de paginação, mas
  full-scan a cada abertura da lista. Opções: contagem aproximada, ou cache
  do total invalidado nas mutações de agendamento, ou aceitar (~8 ms em 5
  anos).
- **`cliente_nome LIKE '%x%'`** (`agendamentos/route.js:27`): curinga à
  esquerda nunca usa índice. Se a busca incomodar em 5 anos, é caso de FTS5
  (tabela virtual de busca) — provavelmente exagero para uma unidade.
- **`listarBloqueios()`** (`db.js:127`): sem WHERE. A correção é limitar
  (`WHERE data >= date('now','-30 days')` ou similar) + política de retenção
  (ver §6), não um índice.

---

## 4. Statements preparados recriados a cada chamada — mede algo?

Todo acesso faz `conn.prepare("…").get(…)` inline; nada é cacheado. Custo de
`prepare()` (compilar o SQL): **~15–25 µs** por statement simples.

| Caminho | Prepares/request | Custo |
|---|---|---|
| `GET /api/admin/resumo` | ~30 | **~0,5 ms** |
| `exigirSessao` (via 3× `lerConfig`) | 3 | ~0,05 ms |
| `horariosLivres` | 3 (expediente, agendamentos, bloqueios) | ~0,06 ms |
| `criarAgendamento` | ~8 | ~0,15 ms |

**Veredito:** mensurável, **não é o gargalo**. No resumo custa ~0,5 ms/chamada
— contra ~24 ms de varredura de linha em 5 anos, é ruído. Cachear os
statements em escopo de módulo (o `db` de `db.js` é uma conexão única e
longeva, então statements de módulo são seguros) economiza ~0,5 ms/resumo e
limpa o código, mas é higiene, não correção de desempenho. Fazer **junto** da
correção dos índices, não antes.

---

## 5. Limpeza amostrada do limitador a 1% — suficiente no pior caso?

`contarTentativas` (`limitador.js:15-30`): `if (Math.random() < 0.01)
DELETE FROM limitador WHERE criado_em < datetime('now','-1 day')`. Chamado 1×
por `limiteAtingido` / `limiteGlobalAtingido`, ou seja **~1× por request que
toca o limitador** (agendamento público e login).

### A conta

Seja `R` = requests/dia que tocam o limitador. Chances de limpeza/dia =
`R × 0,01`. Intervalo esperado entre limpezas = `1 / (R × 0,01)` dias.

| Cenário | `R` (req/dia) | Limpezas/dia | Intervalo entre limpezas | Inserções acumuladas nesse intervalo | Tamanho |
|---|---|---|---|---|---|
| Barbearia parada | 5 | 0,05 | **~20 dias** | ~5/dia × 20 = ~100 linhas | ~4 KB |
| Movimento normal | 80 | 0,8 | ~1,25 dia | ~80 linhas | ~3 KB |
| Movimento alto | 500 | 5 | ~0,2 dia | ~100 linhas | ~4 KB |
| Ataque sustentado (F19+F20) | milhares (o atacante martela; requests bloqueados **também** rodam `contarTentativas` antes do 429) | dezenas–centenas | minutos | — | limpeza acompanha |

**Por que o pior caso não dói:**

1. A tabela é **auto-limitada pelos próprios rate limits**: uma vez atingido
   o limite, a rota devolve 429 **antes** de `registrarTentativa`
   (`agendamentos/route.js:18-32`), então as inserções param. O teto de
   inserções é ~6/10 min (`agendar`) + ~8/15 min ×2 (`login` + global) ≈
   algumas centenas de linhas/dia no pior caso realista.
2. `SELECT COUNT(*) … WHERE chave = ? AND criado_em >= ?` usa
   `idx_limitador_chave (chave, criado_em)` → só varre as linhas **recentes
   daquela chave**, independentemente do tamanho total da tabela. Linhas
   velhas não atrasam a contagem.
3. O único cenário que acumula rápido — tráfego alto — é também o que dispara
   limpezas com frequência.

**Veredito: suficiente na prática.** O resíduo é cosmético (algumas centenas
a poucos milhares de linhas mortas, < 200 KB, sem impacto em query, numa
barbearia parada e depois atacada). **P3.** Vale trocar por limpeza
**gatilhada por tempo** (rodar o DELETE se a última limpeza foi há > 1 h,
guardando o instante num módulo ou numa linha de `config`) — determinística e
não depende de volume de tráfego.

---

## 6. Crescimento sem teto — projeção de 1 ano e política de retenção

| Fonte | Taxa | 1 ano | 5 anos | Precisa de retenção? |
|---|---|---|---|---|
| **`agendamentos`** | ~11 k linhas/ano × ~250 B + índices | **~3,5 MB** | ~18 MB | **Não** — é o livro-caixa do negócio; linhas com soft delete ficam de propósito (Etapa 8). O problema não é tamanho em disco, é **as varreduras do painel crescerem** → resolver com os índices da §3, não apagando dados. |
| **`auditoria`** | ~28 k linhas/ano × ~280 B + índice | **~9 MB** | ~45 MB | **Sim, decisão de retenção.** Nunca é podada, nenhuma tela lê hoje. Não atrapalha performance (nenhum caminho quente consulta; `idx_auditoria_tabela_registro` cobre busca por registro). Definir: manter N anos e então arquivar (export NDJSON) ou apagar. Baixa urgência. |
| **`limitador`** | auto-limitado (§5) | < 1 MB | < 1 MB | **Não** — a limpeza de 1 dia já resolve; só trocar amostragem por tempo (P3). |
| **Logs (NDJSON em stdout)** | ~100 linhas/dia × ~200 B em regime normal | **~7 MB/ano** | ~35 MB | **Sim, mas é do host.** O app só escreve em `process.stdout` — rotação/retenção é 100 % da plataforma (PM2, Docker json-file, journald, Railway/Fly). Sem rotação configurada, cresce sem teto e enche o disco em meses. **Amplificação por ataque:** sob F19/F20, `registrarAviso(ROTA, "bloqueado por limite de tentativas")` loga **em cada request bloqueado** → milhares de linhas/hora → MB/hora de stdout → enche o disco rápido e/ou custa caro num serviço de log gerenciado. Ver **F27**. |
| **Uploads (`public/uploads/`)** | ~15–60 imagens ×  ≤ 150 KB | **~2–9 MB**, quase estático | ~5–15 MB | **Retenção mínima (limpeza de órfãos).** O `anterior`-delete cobre a troca de imagem, mas não: (a) imagens na pasta `"geral"` (fallback), que `CAMINHO_UPLOAD_VALIDO` nunca casa → nunca apagadas; (b) a imagem de um barbeiro/serviço/produto **excluído** (o arquivo fica); (c) troca sem `anterior`. Acúmulo lento, poucos MB/ano. O problema maior é **F23 da Etapa 5** (não sobrevivem a deploy), não o volume. |

### O que precisa de política de retenção, em ordem

1. **Logs** — configurar rotação no host **antes do deploy** (runbook), e
   **limitar/amostrar o log de bloqueio por rate limit** no código para o
   ataque não virar enchente de disco. **F27.**
2. **`auditoria`** — decidir janela de retenção (ex.: 24 meses on-line, resto
   arquivado). Sem urgência de performance; é conformidade/operacional.
3. **Uploads órfãos** — job de limpeza que apaga arquivos em
   `public/uploads/**` não referenciados por nenhum `logo_url`/`foto`/`imagem`.
   Amarra com F23 (mover para volume persistente primeiro).

`agendamentos` e `limitador` **não** precisam de retenção — o primeiro é o
registro do negócio (resolver com índice), o segundo já se limpa.

---

## 7. Achados

Formato: `ID | Severidade | Arquivo:linha | O que está errado | Quando quebra | Método de correção | Esforço | Risco de mexer`

### F27 — Log de bloqueio por rate limit é uma linha por request bloqueado; sob ataque vira enchente de disco

| Campo | Conteúdo |
|---|---|
| **Severidade** | **P2** |
| **Arquivo:linha** | `src/app/api/agendamentos/route.js:24` e `src/app/api/admin/login/route.js:55` (`registrarAviso(ROTA, "bloqueado por limite de tentativas")` sem amostragem); `src/lib/log.js:8-11` (escreve direto em `process.stdout`, sem rotação no app) |
| **O que está errado** | Cada request que bate no rate limit gera uma linha NDJSON. Sob o ataque descrito nos F19/F20 da Etapa 5 (milhares de requests/hora, todos bloqueados), são milhares de linhas/hora — MB/hora de stdout. Sem rotação de log configurada no host, enche o disco em horas/dias; num serviço de log gerenciado, custa. |
| **Quando quebra** | Um atacante mantém o agendamento público e/ou o login bloqueados (F19/F20) — de graça já derruba a função; de brinde, enche o disco do servidor e/ou a cota de logs. |
| **Método de correção** | (1) Amostrar/agregar o log de bloqueio: logar o primeiro bloqueio de uma chave numa janela e depois só a cada N, ou um contador agregado por minuto, em vez de linha-a-linha. (2) Runbook: exigir rotação de log no host (PM2 `max_size`/`retain`, Docker `json-file` `max-size`/`max-file`, ou logrotate) antes do deploy. (3) Documentar um teto de tamanho para o volume de logs. |
| **Esforço** | Baixo (amostragem) + item de runbook. |
| **Risco de mexer** | Baixo. |

### F28 — Quatro varreduras de tabela inteira no `resumo` e no badge de pendentes crescem linearmente e congelam o site público

| Campo | Conteúdo |
|---|---|
| **Severidade** | **P2** |
| **Arquivo:linha** | `src/app/api/admin/resumo/route.js:169` (`recentes`), `:175` (`pendentesTotal`), `:230` (`geralRealizado`), `:237` (`geralPrevisto`); `src/app/api/admin/pendentes/route.js:12` (mesma varredura de pendentes, roda a cada troca de seção do painel — `PainelAdmin.jsx:144-146`) |
| **O que está errado** | Nenhum índice cobre `criado_em` nem `status`; `geralRealizado`/`geralPrevisto` não têm filtro de data. Cada abertura da Visão Geral / Financeiro faz 4 varreduras da tabela `agendamentos` inteira; cada troca de seção do painel faz 1. Custo por varredura: ~1,7 ms em 1 ano → ~8 ms em 5 anos (quente), ×5–10 frio. Como better-sqlite3 é síncrono, esse tempo congela `/api/public`, `/api/horarios` e `POST /api/agendamentos` para todos os clientes. |
| **Quando quebra** | Em 2–5 anos de operação, com a dona navegando o painel durante o horário de pico da barbearia: cada abertura de tela do painel injeta uma pausa de 20–40 ms (quente) ou 0,1–0,3 s (frio, logo após um deploy) no site de agendamento. Some com o F19 e o site já lento fica pior. |
| **Método de correção** | Índices parciais: `idx_ag_pendentes ON agendamentos(id) WHERE status='pendente' AND excluido_em IS NULL` e `idx_ag_criado ON agendamentos(criado_em) WHERE excluido_em IS NULL` (migration numerada, `CREATE INDEX` sem rebuild). Para `geralRealizado`/`geralPrevisto`: adicionar limite de data (últimos 24 meses, como a série) ou computar incrementalmente. Opcional: `idx_ag_data_inicio (data, inicio)` para a ordenação da listagem. |
| **Esforço** | Baixo (índices) + baixo (limite de data nas duas queries `geral`). |
| **Risco de mexer** | Baixo — `CREATE INDEX` é barato e reversível; a mudança nas queries `geral` altera o número exibido ("faturamento geral" passa a ser "dos últimos 24 meses"), o que é decisão de produto e deve ser rotulado na tela. |

### F29 — `exigirSessao` lê `config` 3× por request; `listarBloqueios` lê a tabela inteira sem filtro

| Campo | Conteúdo |
|---|---|
| **Severidade** | **P3** |
| **Arquivo:linha** | `src/lib/auth.js:162`, `:228`, `:287` (3× `lerConfig()` por chamada de `exigirSessao`); `src/lib/db.js:127-135` (`listarBloqueios()` sem `WHERE`) |
| **O que está errado** | `exigirSessao` roda em todo request admin e relê a tabela `config` três vezes para pegar `senha_hash` e `sessao_versao` — trabalho puro repetido, ~0,15 ms/request somados. `listarBloqueios()` lê todo bloqueio já criado (`ORDER BY data DESC`), sem limite de data — ~0,6 ms em 5 anos e crescendo, para exibir só os relevantes. |
| **Quando quebra** | Não "quebra" — degrada. Em 5 anos, ~4 mil bloqueios lidos a cada abertura da tela de Horários; o custo de `lerConfig` é invisível mas multiplicado por todo request admin. |
| **Método de correção** | `exigirSessao`: ler `lerConfig()` uma vez e reusar nos dois checks (sem cache, sem invalidação — ver §2). `listarBloqueios()`: adicionar `WHERE data >= date('now','-30 days') OR data >= date('now')` (ou parâmetro de intervalo) + política de retenção de bloqueios antigos. |
| **Esforço** | Baixo. |
| **Risco de mexer** | Baixo — a mudança em `listarBloqueios` esconde bloqueios antigos da tela; confirmar que nenhuma outra tela depende do histórico completo. |

---

## 8. O que está correto (para contraste)

- **Caminho público quente** (`/api/public`, `/api/horarios`, `POST
  /api/agendamentos`): rápido em 1, 2 e 5 anos — tudo indexado por
  `(barbeiro_id, data)` ou `data` e limitado a um dia. `horariosLivres` ≈
  0,5 ms em qualquer horizonte.
- **`totaisPorMes`** (Etapa 7): as 24 queries mensais viraram uma só, com
  range `data >= ? AND data < ?` que usa `idx_ag_data` — O(janela fixa), não
  cresce com o histórico.
- **`idx_ag_barbeiro (barbeiro_id, data)`** serve bem a checagem de conflito,
  `horariosLivres` e o `agendaHoje` do resumo.
- **`limitador`**: `idx_limitador_chave (chave, criado_em)` mantém a contagem
  O(linhas recentes da chave) mesmo com a tabela cheia; a limpeza amostrada é
  suficiente na prática (§5).
- **`criarAgendamento`** segura o write lock por ~1 ms — transação curta, sem
  varredura.
