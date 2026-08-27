# 03 — Disponibilidade: `horariosLivres`, conflito, fuso, `diasDisponiveis`

Escopo: `src/lib/slots.js`, `src/lib/datas-cliente.js`,
`src/app/api/horarios/route.js`, `src/app/api/public/route.js`, e
`verificarConflito` em `src/lib/agendamentos.js:51-100`. Base:
`auditoria/01-mapa.md`, `auditoria/02-integridade.md`.

Verificação: leitura + experimento rodado nesta etapa
(`exp-disponibilidade.mjs`, banco temporário migrado, `node --import
./tests/register-hooks.mjs`) + testes existentes em `tests/slots.test.js`
(10/10 passam) + checagens pontuais de `Intl`/SQLite.

---

## 1. `horariosLivres` — cenário a cenário

Recapitulando o algoritmo (`slots.js:112-166`):
`passo = max(5, intervalo_min || 30)`, `antecedencia = max(0, antecedencia_min
|| 0)`, `duracao = max(5, duracaoMin || 30)`. Candidatos = grade fixa
(`for inicio = abre; inicio + duracao <= fecha; inicio += passo`) **mais** o
`fim` de cada agendamento/bloqueio quando `fim >= abre && fim + duracao <=
fecha`. Filtro: descarta `inicio < minimo` (`minimo = hoje.minutos +
antecedencia` só quando `data === agora().data`, senão `-1`) e descarta
`inicio` que sobreponha algum intervalo (`inicio < f && fim > i`).

| # | Cenário | Correto? | Como foi provado |
|---|---|---|---|
| 1 | **Serviço que atravessa o fechamento** | **Sim** | `inicio + duracao <= fecha` na geração da grade e `f + duracao <= fecha` nos candidatos de fim de intervalo impedem oferecer slot que termine depois de `fecha`. Experimento: expediente 09:00–20:00, `dur=60`, `passo=30` → últimos slots `["18:00","18:30","19:00"]`; 19:30 (→ 20:30) não aparece. |
| 2 | **Bloqueio parcial** | **Sim** | Sobreposição meio-aberta `inicio < f && fim > i` trata encostar (fim == início do bloqueio) como livre. Experimento: bloqueio 10:00–11:00 em 09:00–12:00, `dur=30` → `["09:00","09:30","11:00","11:30"]`. |
| 3 | **Bloqueio global (`barbeiro_id NULL`)** | **Sim** | `WHERE data = ? AND (barbeiro_id IS NULL OR barbeiro_id = ?)` casa o bloqueio nulo para todo barbeiro. Experimento: bloqueio nulo 09:00–10:00 → grade `[]` para `b` **e** para `b2`. Também coberto por `tests/slots.test.js`. |
| 4 | **Antecedência mínima** | **Sim** | `minimo = hoje.minutos + antecedencia`, e `hoje` vem de `agora()` (fuso da barbearia). Experimento com `hoje` real: `antecedencia_min=120`, agora=00:33 → limite 02:33 → nenhum slot antes de 02:33 na lista (`["03:00","03:30",...]`). `tests/slots.test.js` confirma que o corte não vaza para o dia seguinte. |
| 5 | **Passo que não divide o expediente** | **Sim, sem oferta indevida** — mas subutiliza o fim do dia | A grade é `abre + k·passo`; nada encosta o último slot no fechamento. Experimento: `passo=25`, 09:00–11:00, `dur=30` → `["09:00","09:25","09:50","10:15"]`. 10:30–11:00 caberia e **não** é oferecido. Nenhum slot conflitante é oferecido; só faltam slots no fim. Ver **F13**. |
| 6 | **Duração maior que o expediente** | **Sim** | O `for` da grade tem a condição de parada já falsa na primeira iteração (`abre + duracao > fecha`); nenhum candidato de fim de intervalo cabe. Experimento: `dur=90` em 09:00–10:00 → `[]`. |
| 7 | **Agendamento terminando fora da grade** | **Sim** | O `fim` de cada intervalo entra como candidato quando cabe. Experimento: agendamento 09:00–09:45, `passo=30`, `dur=15` → `["09:45"]` (a grade sozinha só teria 09:00 e 09:30, ambos em conflito). |
| 8 | **Dia de hoje já passado** | **Sim** | Com `data === agora().data`, todo candidato com `inicio < minimo` é pulado; se `minimo` passou de `fecha - duracao`, sobra `[]`. Experimento: `hoje` com `antecedencia_min = 1440` → `[]`. |
| 9 | **Dia fechado** | **Sim** | `if (!dia || !dia.aberto) return []`. Experimento: `aberto = 0` → `[]`. Também em `tests/slots.test.js`. |
| 10 | **Expediente com `fecha <= abre`** | **Sim, mas por código morto** | `if (fecha <= abre) return []` (`slots.js:126`) é defesa redundante: desde a migration 3 o banco tem `CHECK (fecha > abre)` em `expediente`. Experimento: `UPDATE expediente SET abre='20:00', fecha='09:00'` → `CHECK constraint failed: fecha > abre`. O ramo em `horariosLivres` é inalcançável por caminho normal. |

**Conclusão da seção:** `horariosLivres` está **correto** em todos os 10
cenários. Não há oferta de horário que resulte em sobreposição. As duas
ressalvas são de aproveitamento e de código, não de correção: **F13** (passo
que não divide deixa sobra) e o ramo morto do cenário 10.

Observações menores, sem finding:

- O guard `partes.hour === "24" ? "00"` em `agora()` (`slots.js:33`) é **código
  morto** no Node 22 / ICU atual: `Intl.DateTimeFormat("en-CA", { …,
  hour12: false })` usa hourCycle `h23` e devolve `"00"` à meia-noite, nunca
  `"24"`. Testado em `2026-08-27T03:00:00Z` (= 00:00 em América/São_Paulo):
  hora `"00"`, dia `"2026-08-27"`. Não há bug de virada de dia — `agora()`
  retorna a data certa do fuso na primeira hora depois da meia-noite
  (confirmado ao vivo: 00:33 BRT → `{ data: "2026-08-27", minutos: 33 }`).
- `datas-cliente.js` (`hojeLocal`/`mesAtualLocal`) espelha a mesma técnica de
  `agora()` (Intl com `timeZone` explícito), recebendo o fuso por parâmetro
  em vez de `process.env.TZ`. Consistente. Coberto por
  `tests/datas-cliente.test.js` (5/5).

---

## 2. Público: revalidação de conflito × geração de horários — divergem?

### Caminho público: uma fonte de verdade só

`POST /api/agendamentos` → `criarAgendamento({ origem: "publico" })` → dentro
da transação `.immediate()` → `verificarConflito(conn, { origem: "publico",
… })` que, no ramo `publico` (`agendamentos.js:55-68`), **chama o próprio
`horariosLivres`** e testa `livres.includes(inicio)`. É a mesma função que
`GET /api/horarios` usa para montar a grade. `duracaoMin` passado é
`servico.duracao_min` nos dois pontos. **Não há uma segunda implementação de
regra no caminho público** — a grade exibida e a revalidação são o mesmo
código.

### Onde divergem, mesmo assim: camada de aplicação × camada de banco

`horariosLivres` (`slots.js:131`) e o ramo painel de `verificarConflito`
(`agendamentos.js:76`) filtram **`AND excluido_em IS NULL`**. O índice único
parcial `idx_ag_sem_duplicidade` (`migrations.js:279`) filtra **só `WHERE
status <> 'cancelado'`**, sem `excluido_em`. Um agendamento com soft delete
some das checagens de aplicação (slot aparece livre) mas continua na chave
única → o `INSERT` estoura `UNIQUE` → 409.

- **Linha onde divergem:** `src/lib/slots.js:131` (`… AND excluido_em IS
  NULL`) versus `src/lib/migrations.js:279` (`WHERE status <> 'cancelado'`).
- Isto é o **F1** de `auditoria/02-integridade.md` (confirmado por
  experimento lá). A "geração" e a "revalidação" da aplicação concordam entre
  si; quem discorda é o banco.

### Divergência secundária (corrida, não "duas verdades")

`horariosLivres` lê `lerConfig()` a cada chamada. Entre o `GET /api/horarios`
(grade que o cliente vê) e o `POST` (revalidação), se a dona mudar
`intervalo_min`, `antecedencia_min` ou o expediente, a grade vista e a grade
revalidada diferem. É a **mesma regra em dois instantes**, e o `POST` é quem
decide — auto-corrige, não trava nada. Sem finding.

### E o painel? (fora do escopo da pergunta, mas relevante)

`PUT /api/admin/agendamentos` (horários para encaixe) usa `horariosLivres`
(respeita expediente, antecedência e corte de hoje). `POST
/api/admin/agendamentos` valida pelo **ramo painel** de `verificarConflito`
(`agendamentos.js:70-99`): SQL cru de sobreposição contra `agendamentos` e
`bloqueios`, **sem** expediente nem antecedência. A grade mostrada é mais
estreita do que o `POST` aceita. Intencional (encaixe), mas são duas regras.
Ver **F11**.

---

## 3. Fuso: `datetime('now')` (UTC) × `agora()` (fuso da barbearia)

Fato base (confirmado nesta etapa): `SELECT datetime('now')` do SQLite
devolve **UTC** (`2026-08-27 03:34`); `agora()` devolve o relógio de parede da
barbearia (`2026-08-27 00:34` em América/São_Paulo). Brasil não tem horário
de verão desde 2019 → offset fixo de **−3 h**. Entre 21:00 e 23:59 no horário
da barbearia, UTC já está no **dia seguinte**.

### 3.1 Todo ponto que usa `datetime('now')` (UTC)

| Ponto | Arquivo:linha | Compara com quê | Janela errada? |
|---|---|---|---|
| Default de `agendamentos.criado_em` | `migrations.js:92` (e `:257`) | Só `ORDER BY criado_em DESC` em `resumo` `recentes` (`resumo/route.js:171`) | **Não.** Ordenação por UTC preserva a ordem cronológica real; "8 mais recentes" continua certo. Nunca é comparado a `agora()` nem a uma coluna `data`. |
| Default de `limitador.criado_em` | `migrations.js:103` | `datetime('now', ?)` em `limitador.js:19,28,77` | **Não.** UTC dos dois lados. Janela deslizante ("últimos N minutos / 1 dia / N segundos") mede o mesmo intervalo real independentemente do fuso. |
| `INSERT INTO limitador … datetime('now')` | `limitador.js:35` | idem acima | **Não.** Grava UTC, lê UTC. |
| `DELETE FROM limitador WHERE criado_em < datetime('now','-1 day')` | `limitador.js:19-24` | UTC × UTC | **Não.** Só poda linhas com mais de 24 h; a poda é amostrada (1 %) e não depende de "meia-noite". |
| `UPDATE agendamentos SET excluido_em = datetime('now')` | `agendamentos.js:451` | Em nenhum lugar — `excluido_em` só é testado com `IS NULL` | **Não.** Marcador, não instante comparável. |
| Default de `auditoria.criado_em` | `migrations.js:304` | Nenhuma rota lê a tabela `auditoria` hoje | **Não** (hoje). |

### 3.2 Todo ponto que usa `agora()` (fuso da barbearia)

| Ponto | Arquivo:linha | O que faz | Correto? |
|---|---|---|---|
| `horariosLivres` — corte de antecedência / "hoje" | `slots.js:145-146` | `minimo = data === agora().data ? agora().minutos + antecedencia : -1` | **Sim.** `data` é string de data escolhida pelo cliente; comparação com a data/hora de parede da barbearia. |
| `diasDisponiveis` — data inicial | `slots.js:177` | `const hoje = agora().data` | **Sim.** |
| `mudarStatusAgendamento` — barra concluir data futura | `agendamentos.js:398` | `atual.data > agora().data` | **Sim.** Duas strings de data no fuso da barbearia. |
| `resumo` — "hoje" e mês corrente | `resumo/route.js:134-137` | `hoje = agora().data`; `mes = param || hoje.slice(0,7)`; `doDia` usa `WHERE data = ? [hoje]` | **Sim.** A coluna `data` guarda a data da barbearia (entrada validada `AAAA-MM-DD`); "hoje" e o recorte mensal são calculados no mesmo fuso. É **exatamente o bug que foi evitado**: com `datetime('now')` (UTC), às 23:30 BRT o resumo abriria no dia/mês seguinte. |
| `resumo` — aritmética de meses (`ultimosDozeMeses`, `limitesDoMes`, `somarMeses`) | `resumo/route.js:9-44` | `Date.UTC(ano, m-1+delta, 1)` sobre a **string** `AAAA-MM` | **Sim.** É cálculo de calendário sobre um valor já no fuso certo; nenhum "now" envolvido; produz limites `AAAA-MM-01` para `WHERE data >= ? AND data < ?`. Sem mistura. |

### 3.3 Conclusão do fuso

**Nenhuma janela errada ativa hoje.** O limitador é UTC-internamente-
consistente. O resumo e `horariosLivres` usam `agora()` de forma consistente
sobre a coluna `data` (que é data no fuso da barbearia). O ponto onde
timestamps UTC são de fato consumidos (`recentes`, `ORDER BY criado_em`) só
precisa de ordenação, que UTC preserva.

**Latente** (vira problema só se código novo for adicionado): `criado_em` de
`agendamentos`, `criado_em` de `auditoria` e `excluido_em` estão em UTC. `SELECT
*` de `recentes` (`resumo/route.js:171`) já devolve `criado_em` no corpo da
resposta. Qualquer tela que renderize "criado às {criado_em}" / "excluído
em…" / um visualizador de auditoria vai mostrar **3 h adiantado** e, entre
21:00 e 23:59, **a data errada**. Ver **F14**.

---

## 4. `diasDisponiveis`

`slots.js:173-185`. `quantidade` vem de `/api/public`:
`diasDisponiveis(Number(config.dias_futuros) || 30)` (`public/route.js:40`).
Loop: `for (i = 0; datas.length < quantidade && i < tetoDeDiasVarridos; i++)`,
`tetoDeDiasVarridos = Math.max(quantidade * 3, 180)`.

### Semana inteira fechada

`abertoNoDia` todo `0` → o `if` nunca empurra data → devolve `[]` depois de
`tetoDeDiasVarridos` iterações (baratas: `somarDias` + lookup). **Sem loop
infinito.** Experimento: `diasDisponiveis(90)` com os 7 dias fechados → `[]`
em 1 ms. `/api/public` então devolve `dias: []` e a tela de agendamento fica
sem datas — degradação limpa.

### `dias_futuros` alto

`tetoDeDiasVarridos = max(quantidade*3, 180)` limita o **loop**, não o
**resultado**: com a semana normal (maioria dos dias aberta), o loop acha
`quantidade` datas antes do teto e devolve todas. Experimento:

| `quantidade` | datas devolvidas | tempo | JSON |
|---|---|---|---|
| 90 (default) | 90 | ~1 ms | ~1 KB |
| 5 000 | 5 000 | ~13 ms | ~63 KB |
| 99 999 | 99 999 | ~189 ms | ~1 270 KB |

`/api/public` é `force-dynamic` — roda a cada visita ao fluxo de agendamento.
`dias_futuros` é gravado pelo `PUT /api/admin/config` **sem validação de
faixa** (mapa, pista 12). Uma dona digitando "9999" no campo "dias no futuro"
→ toda visita varre ~30 k dias, bloqueia o event loop (better-sqlite3 síncrono
+ thread única) por dezenas de ms e manda ~110 KB de array de datas. Ver
**F9**.

### `dias_futuros` negativo / zero / não-numérico

- `Number("0") || 30` → `30` (o `0` é falsy). OK.
- `Number("abc") || 30` → `30`. OK.
- `Number("-5") || 30` → `-5` (truthy!) → `diasDisponiveis(-5)` → `datas.length
  < -5` nunca verdadeiro → `[]`. **A agenda pública some inteira, sem erro.**
  Experimento confirma: `diasDisponiveis(-5) => []`. Ver **F10**.

---

## 5. Achados

Formato: `ID | Severidade | Arquivo:linha | O que está errado | Quando quebra | Método de correção | Esforço | Risco de mexer`

### F9 — `dias_futuros` sem teto: `/api/public` varre até ~300 mil dias e devolve ~1,3 MB por visita

| Campo | Conteúdo |
|---|---|
| **Severidade** | **P2** |
| **Arquivo:linha** | `src/lib/slots.js:173-185` (`tetoDeDiasVarridos` limita o loop, não o resultado); `src/app/api/public/route.js:40` (`diasDisponiveis(Number(config.dias_futuros) || 30)`); `src/app/api/admin/config/route.js:54-102` (`PUT` não valida faixa de `dias_futuros`) |
| **O que está errado** | `dias_futuros` não tem limite superior nem na gravação nem no uso. `diasDisponiveis(N)` devolve N datas e as serializa inteiras na resposta pública. |
| **Quando quebra** | Dona digita "9999" (ou mais) no campo "dias no futuro" das configurações. Cada carregamento da tela de agendamento (`/api/public`, uma requisição por visitante) passa a varrer ~30 k dias, bloquear o event loop por ~50 ms (com "99999", ~190 ms) e transferir ~110 KB–1,3 MB de JSON. Sob qualquer concorrência de visitantes, o site trava em rajadas. Confirmado por experimento (189 ms / 1 270 KB para 99 999). |
| **Método de correção** | (1) No `PUT /api/admin/config`, validar `dias_futuros` como inteiro em faixa (ex.: 1–365), junto de `intervalo_min` (ex.: 5–120) e `antecedencia_min` (ex.: 0–10080), que têm a mesma lacuna. (2) Defesa em profundidade: `diasDisponiveis` aplicar teto rígido interno no **resultado** — `quantidade = Math.min(Math.max(1, quantidade), 365)`. |
| **Esforço** | Baixo. |
| **Risco de mexer** | Baixo. |

### F10 — `dias_futuros` negativo zera a agenda pública silenciosamente

| Campo | Conteúdo |
|---|---|
| **Severidade** | **P2** |
| **Arquivo:linha** | `src/app/api/public/route.js:40` (`Number(config.dias_futuros) || 30`); `src/lib/slots.js:180` (`datas.length < quantidade`) |
| **O que está errado** | `Number("-5")` é `-5`, que é truthy, então o fallback `|| 30` não pega; `diasDisponiveis(-5)` devolve `[]` porque `datas.length < -5` já começa falso. |
| **Quando quebra** | `dias_futuros` gravado como negativo (dona digita "-5", ou uma máscara de campo insere um sinal). O site inteiro para de oferecer qualquer data para agendamento, sem nenhuma mensagem de erro — parece que "não tem horário". `0` e texto não-numérico caem no fallback de 30 e não têm o problema; só o negativo passa. Confirmado por experimento. |
| **Método de correção** | A validação de faixa do **F9** já resolve (rejeita `< 1`). Correção mínima isolada: `Math.max(1, Number(config.dias_futuros) || 30)` no ponto de uso. |
| **Esforço** | Trivial. |
| **Risco de mexer** | Baixo. |

### F11 — Grade de encaixe do painel mostra menos horários do que o `POST` aceita (duas regras para o painel)

| Campo | Conteúdo |
|---|---|
| **Severidade** | **P3** |
| **Arquivo:linha** | `src/app/api/admin/agendamentos/route.js:98-119` (`PUT` de encaixe chama `horariosLivres` — respeita expediente, antecedência, corte de hoje) versus `src/lib/agendamentos.js:70-99` (ramo painel de `verificarConflito` — SQL cru de sobreposição, sem expediente nem antecedência) |
| **O que está errado** | No painel, a lista de horários oferecida para o encaixe é gerada por uma regra (mais restrita) e a gravação é validada por outra (mais permissiva). Não é bug de correção — o `POST` aceita tudo que a grade oferece e mais — mas são "duas verdades" para a mesma ação. |
| **Quando quebra** | A barbeira abre o modal de encaixe às 19:00, quer encaixar um cliente às 20:30 (fora do expediente 09:00–20:00). A lista não oferece 20:30; ela precisa saber, por fora, que dá para digitar/forçar o horário. Confirmado por leitura + `tests/agendamentos.test.js` "painel permite encaixe fora do expediente" (o `POST` aceita 21:00). |
| **Método de correção** | Decisão de produto. (a) O `PUT` de encaixe, quando `origem` é painel, devolve a grade do dia inteiro filtrando **só** sobreposição real (sem expediente/antecedência), alinhando com o que o `POST` aceita; ou (b) manter a grade restrita e a tela deixar explícito "para encaixar fora do expediente, digite o horário". Documentar a escolha em comentário. |
| **Esforço** | Baixo a médio. |
| **Risco de mexer** | Baixo. |

### F12 — `GET /api/horarios` e o `PUT` de encaixe não validam o par barbeiro↔serviço; a grade sai para combinações que o `POST` rejeita

| Campo | Conteúdo |
|---|---|
| **Severidade** | **P1** |
| **Arquivo:linha** | `src/app/api/horarios/route.js:20-34` (só checa `servico` ativo; não checa se o barbeiro existe, se está ativo, nem `servico_barbeiro`); `src/lib/slots.js:112-166` (`horariosLivres` não toca `barbeiros` nem `servico_barbeiro`); `src/lib/agendamentos.js:128-144` (é o `POST` quem rejeita: 404 barbeiro inexistente, 400 inativo, 400 par não-vinculado) |
| **O que está errado** | A grade é calculada para qualquer `barbeiroId` — inclusive um que não existe (nenhum agendamento dele → grade cheia), está inativo, ou não executa aquele serviço. A rejeição só acontece no `POST`, depois do formulário todo preenchido. |
| **Quando quebra** | Liga com **F5** de `02-integridade.md` (mesma causa raiz, ponto de manifestação diferente). Barbearia com 2 profissionais; um sai de férias e é desativado; era o único que fazia "Barba". `/api/public` ainda oferece "Barba" com ele (F5), `/api/horarios` devolve grade normal, o cliente escolhe dia e horário, e só no `POST` recebe "Esse profissional está desativado.". Perde-se o agendamento que teria sido feito com o outro profissional. |
| **Método de correção** | Em `GET /api/horarios` e no `PUT` de encaixe, antes de chamar `horariosLivres`: validar que o barbeiro existe e (fluxo público) está ativo, e `SELECT 1 FROM servico_barbeiro WHERE servico_id = ? AND barbeiro_id = ?`. Sem vínculo → 404 / `{ horarios: [] }`. Corrigir junto com F5. Regra final continua em `criarAgendamento`. |
| **Esforço** | Baixo. |
| **Risco de mexer** | Baixo. |

### F13 — Passo (`intervalo_min`) que não divide o expediente deixa a sobra do fim do dia sem oferta

| Campo | Conteúdo |
|---|---|
| **Severidade** | **P3** |
| **Arquivo:linha** | `src/lib/slots.js:148-152` (grade só `abre + k·passo`, mais fins de intervalo; nada encosta o último slot em `fecha - duracao`) |
| **O que está errado** | Quando `passo` não divide `fecha - abre`, sempre sobra uma janela livre no fim do dia que caberia um atendimento mas não está na grade. Nenhum horário conflitante é oferecido — só faltam horários válidos. |
| **Quando quebra** | `intervalo_min` = 25, 40, 45 (qualquer valor que não divida a janela do expediente). Experimento: `passo=25`, 09:00–11:00, `dur=30` → `["09:00","09:25","09:50","10:15"]`; 10:30–11:00 caberia e não aparece. Com `intervalo_min = 30` e expediente em horas cheias/meias (default e caso comum) não acontece. |
| **Método de correção** | Se quiser aproveitar a sobra: adicionar `fecha - duracao` como candidato quando `>= abre` e não coincidir com a grade — do mesmo jeito que os fins de agendamento/bloqueio já entram (`slots.js:151-152`). Alternativa: validar no `PUT /api/admin/config` que `intervalo_min` divide o expediente e avisar (não bloquear). |
| **Esforço** | Baixo. |
| **Risco de mexer** | Baixo, mas mexe em `horariosLivres` (caminho crítico) — exige teste de regressão para todos os 10 cenários da seção 1. |

### F14 — `criado_em` / `excluido_em` / `auditoria.criado_em` gravados em UTC; qualquer exibição como hora local erra em 3 h (e a data perto da meia-noite)

| Campo | Conteúdo |
|---|---|
| **Severidade** | **P3** (latente — não há janela errada hoje; vira P1 no dia em que uma tela renderizar esses campos) |
| **Arquivo:linha** | `src/lib/migrations.js:92` / `:257` (`agendamentos.criado_em DEFAULT datetime('now')`), `:103` (`limitador`), `:304` (`auditoria`); `src/lib/agendamentos.js:451` (`excluido_em = datetime('now')`); consumidor atual: `src/app/api/admin/resumo/route.js:171` (`SELECT *` de `recentes` devolve `criado_em` no corpo) |
| **O que está errado** | Todo o domínio de horário (`data`, `inicio`, `fim`, cálculos de "hoje"/mês) trabalha no fuso da barbearia via `agora()`; esses quatro timestamps são a exceção, em UTC (−3 h em relação ao relógio de parede). Hoje só são usados para **ordenação** (`ORDER BY criado_em`), que UTC preserva — por isso não há bug ativo. |
| **Quando quebra** | Assim que qualquer tela renderizar "criado às {criado_em}", "excluído em…", ou um visualizador da tabela `auditoria`: mostra 3 h adiantado, e para eventos entre 21:00 e 23:59 no horário da barbearia mostra **o dia seguinte**. Ex.: agendamento criado 22:00 BRT aparece como "criado 01:00" do dia seguinte. O `recentes` do resumo já expõe `criado_em` no JSON. |
| **Método de correção** | Escolher uma convenção e documentá-la. Opção A: manter UTC no banco (padrão) e converter para o fuso da barbearia **na borda de exibição**, reaproveitando a técnica de `agora()`/`datas-cliente.js` (Intl com `timeZone`). Opção B: gravar esses timestamps já no fuso da barbearia, como as colunas `data`/`inicio` — coerente com o resto do schema, mas exige um helper em vez de `datetime('now')` no `DEFAULT`. Enquanto não houver tela, deixar um comentário em `migrations.js` marcando a dívida. |
| **Esforço** | Baixo (comentário agora) a médio (conversão na borda quando a tela existir). |
| **Risco de mexer** | Baixo agora; médio se optar por trocar o `DEFAULT` das colunas (migration + revisão de todo consumidor). |

---

## 6. O que está correto (para contraste)

- **`horariosLivres`**: os 10 cenários da seção 1 passam; nenhuma oferta
  resulta em sobreposição; a sobreposição meio-aberta trata "encostar" como
  livre corretamente; serviço que cruza o fechamento, duração maior que o
  expediente, dia fechado e antecedência estão todos certos.
- **Público**: grade e revalidação são a **mesma função** (`horariosLivres`);
  não há segunda implementação de regra no fluxo do cliente. A única
  discordância é aplicação × índice de banco (F1, já registrado).
- **Fuso no servidor**: `agora()` é usado de forma consistente para "hoje",
  corte de antecedência, "não concluir data futura" e recorte mensal do
  resumo — sobre a coluna `data`, que já está no fuso da barbearia. O
  limitador é UTC-internamente-consistente. **Nenhuma janela errada hoje.**
- **`agora()` na virada da meia-noite**: retorna a data certa do fuso na
  primeira hora após 00:00 (confirmado ao vivo e com instante forçado). O
  guard `"24" → "00"` é redundante mas inofensivo.
- **`diasDisponiveis` com semana toda fechada**: devolve `[]` em ~1 ms, sem
  loop infinito — o teto `Math.max(quantidade*3, 180)` segura o loop.
