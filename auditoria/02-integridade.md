# 02 — Integridade do caminho de escrita de agendamento

Escopo: `src/lib/agendamentos.js`, `src/lib/db.js`, `src/lib/migrations.js`,
`src/app/api/agendamentos/route.js`, `src/app/api/admin/agendamentos/route.js`,
`src/app/api/admin/agendamentos/[id]/route.js`,
`src/app/api/admin/[recurso]/[id]/route.js` (exclusão de cadastro),
`src/app/api/admin/resumo/route.js` (definição financeira). Base:
`auditoria/01-mapa.md`.

Verificação: leitura + `npm test` (114/114, seção 5 do mapa) + dois
experimentos rodados nesta etapa (detalhados abaixo).

---

## Respostas diretas às perguntas da etapa

### Atomicidade real: há `await` entre checar e gravar dentro de transação?

**Não.** Todas as callbacks de `conn.transaction(...)` no caminho de escrita
são síncronas — `criarAgendamento` (`agendamentos.js:176-222`),
`remarcarAgendamento` (`:307-350`), `mudarStatusAgendamento` (`:402-423`),
`excluirAgendamento` (`:448-460`), e o `PATCH` de cadastro
(`[recurso]/[id]/route.js:53-70`). better-sqlite3 recusaria uma callback que
devolvesse promise ("Transaction function cannot return a promise"), e
nenhuma delas tem `await`. Dentro da transação de `criarAgendamento`, o
`verificarConflito` (que no ramo `publico` roda `horariosLivres()` com vários
`SELECT`s) executa **com o write lock já preso** — nada de outro processo se
intercala entre checar e gravar.

Ressalva: em `criarAgendamento` as checagens de **existência e atividade** de
serviço/barbeiro/vínculo acontecem **antes** de abrir a transação
(`agendamentos.js:125-144`). Ver **F7**.

### O write lock é imediato?

**Sim para 3 das 4 mutações.** `criarAgendamento`, `remarcarAgendamento` e
`mudarStatusAgendamento` executam a transação via `.immediate()` → `BEGIN
IMMEDIATE` → write lock no início, antes de qualquer leitura interna.
`excluirAgendamento` usa `conn.transaction(...)()` (sem `.immediate()`) →
`BEGIN DEFERRED`; o lock só é pego no primeiro `write`. Como essa transação
não lê nada antes de escrever (o `SELECT` de checagem é feito fora dela), o
efeito prático é o mesmo, mas o estilo destoa e abre uma brecha pequena — ver
**F8**.

O teste `tests/concorrencia.test.js` (dois worker threads, conexões
separadas, mesmo horário) passa: exatamente 1×`201` e 1×`409`, `COUNT = 1`.
O `BEGIN IMMEDIATE` + índice único fazem o trabalho na colisão exata.

### O índice único parcial cobre exatamente os casos que a checagem cobre?

**Não. Duas divergências:**

1. **`excluido_em`.** O índice (`migrations.js:276-280`) tem `WHERE status <>
'cancelado'` e **nada** sobre `excluido_em`. A checagem de conflito
   (`verificarConflito`, `agendamentos.js:76`) e `horariosLivres`
   (`slots.js:131`) filtram `excluido_em IS NULL`. Consequência: um
   agendamento com soft delete **continua ocupando o slot no índice**, mas
   some das checagens da aplicação. Ver **F1** (confirmado por experimento).
2. **Sobreposição parcial.** O índice só pega colisão **exata** de
   `(barbeiro_id, data, inicio)`. Sobreposição parcial (mesmo barbeiro,
   horários que se cruzam mas começam em minutos diferentes) depende
   **inteiramente** de `verificarConflito`. É uma decisão declarada no
   código (`migrations.js:274-275`), não um bug — mas significa que a
   garantia de banco é mais estreita que a regra de negócio. Qualquer
   `INSERT`/`UPDATE` futuro de agendamento que não passe por
   `verificarConflito` pode criar sobreposição parcial sem o banco barrar.

### `busy_timeout` está configurado? O que acontece com dois writers em WAL?

**Não explicitamente** — `db.js:16` faz `new Database(DB_PATH)` sem
`{ timeout }`. Mas o better-sqlite3 aplica um default de **5000 ms**
(confirmado: `PRAGMA busy_timeout` devolve `5000` numa conexão sem opções, e
`0` com `{ timeout: 0 }`). Então:

- **Um processo Node** (o caso normal deste deploy): better-sqlite3 é
  síncrono e bloqueia o event loop, então **não existem** dois writers de
  verdade ao mesmo tempo — as requisições HTTP são serializadas pela thread
  única de JS. O `BEGIN IMMEDIATE` importa para a atomicidade
  checar-então-gravar (nada roda entre as duas etapas) e para o caso
  multi-processo.
- **Dois processos / worker threads / `npm run migrate` com o servidor no
  ar**: o segundo `BEGIN IMMEDIATE` pega `SQLITE_BUSY`, e o `busy_timeout`
  faz re-tentar por até 5 s. Como os `INSERT`s são de microssegundos, o
  segundo prossegue e cai no `409` do índice único — **comportamento
  amigável**.
- **Quando degrada**: se o `busy_timeout` fosse 0 (ex.: alguém passa
  `{ timeout: 0 }`, ou troca de driver), ou se um writer segurasse o lock
  por mais de 5 s (migration 3 copiando a tabela `agendamentos` inteira
  enquanto o site recebe escrita), o segundo writer recebe `SQLITE_BUSY` →
  `tratarErroTransacao` (`agendamentos.js:27-36`) **não reconhece
  `SQLITE_BUSY`** (só `SQLITE_CONSTRAINT*`) → **rethrow → `comLog` → 500
  genérico** "Algo deu errado", não um 409/429. Ver **F2**.

### Soft delete: toda query que conta, soma, lista ou checa conflito

Levantamento completo (grep `FROM agendamentos` / `JOIN agendamentos` /
`INTO agendamentos` / `UPDATE agendamentos` em `src/`):

| #   | Arquivo:linha                                                 | Operação                                                                         | Filtra `excluido_em IS NULL`?                            |
| --- | ------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1   | `slots.js:130-131`                                            | `horariosLivres` — ocupados do barbeiro/dia                                      | **sim**                                                  |
| 2   | `agendamentos.js:75-77`                                       | `verificarConflito` painel — conflito com atendimento                            | **sim**                                                  |
| 3   | `agendamentos.js:187-206`                                     | `criarAgendamento` — `INSERT`                                                    | n/a (escrita)                                            |
| 4   | `agendamentos.js:267`                                         | `remarcarAgendamento` — lê o atual                                               | **sim** (`AND excluido_em IS NULL`)                      |
| 5   | `agendamentos.js:318`                                         | `remarcarAgendamento` — `UPDATE` por id                                          | n/a                                                      |
| 6   | `agendamentos.js:387`                                         | `mudarStatusAgendamento` — lê o atual                                            | **sim**                                                  |
| 7   | `agendamentos.js:414`                                         | `mudarStatusAgendamento` — `UPDATE status` por id                                | n/a                                                      |
| 8   | `agendamentos.js:444`                                         | `excluirAgendamento` — lê o atual                                                | **sim**                                                  |
| 9   | `agendamentos.js:451`                                         | `excluirAgendamento` — `UPDATE excluido_em`                                      | n/a                                                      |
| 10  | `admin/agendamentos/route.js:23`                              | `GET` listagem — `condicoes = ["excluido_em IS NULL"]` (COUNT + itens)           | **sim**                                                  |
| 11  | `admin/agendamentos/route.js:47,51`                           | `GET` — `COUNT(*)` total + página                                                | **sim** (via `where`)                                    |
| 12  | `resumo/route.js:61-63`                                       | `totaisPorMes` — série 24 meses                                                  | **sim**                                                  |
| 13  | `resumo/route.js:88-93`                                       | `totaisDoMes` — realizado                                                        | **sim**                                                  |
| 14  | `resumo/route.js:95-100`                                      | `totaisDoMes` — previsto                                                         | **sim**                                                  |
| 15  | `resumo/route.js:102-106`                                     | `totaisDoMes` — cancelados                                                       | **sim**                                                  |
| 16  | `resumo/route.js:143-153`                                     | `doDia` — `COUNT(*)` + somas do dia                                              | **sim** (mas ver **F6**: `total` não exclui `cancelado`) |
| 17  | `resumo/route.js:155-167`                                     | `agendaHoje` — `LEFT JOIN` por barbeiro                                          | **sim** (`a.excluido_em IS NULL` na cláusula do JOIN)    |
| 18  | `resumo/route.js:169-173`                                     | `recentes` — últimos 8 por `criado_em`                                           | **sim**                                                  |
| 19  | `resumo/route.js:175-179`                                     | `pendentesTotal`                                                                 | **sim**                                                  |
| 20  | `resumo/route.js:206-216`                                     | `porServico` — agrupado                                                          | **sim**                                                  |
| 21  | `resumo/route.js:218-228`                                     | `porBarbeiro` — agrupado                                                         | **sim**                                                  |
| 22  | `resumo/route.js:230-235`                                     | `geralRealizado` — histórico inteiro                                             | **sim**                                                  |
| 23  | `resumo/route.js:237-242`                                     | `geralPrevisto` — histórico inteiro                                              | **sim**                                                  |
| 24  | `pendentes/route.js:12-16`                                    | contador do badge                                                                | **sim**                                                  |
| 25  | `admin/[recurso]/route.js:162-176`                            | `atropelados` — bloqueio sobre agendamentos                                      | **sim**                                                  |
| 26  | **`admin/[recurso]/[id]/route.js:103-105`**                   | **`usos` — `COUNT(*) WHERE barbeiro_id/servico_id = ?` na exclusão de cadastro** | **NÃO** (nem `excluido_em`, nem `status`) → **F3**       |
| 27  | **índice `idx_ag_sem_duplicidade`** (`migrations.js:276-280`) | garante não-duplicação de slot                                                   | **NÃO** (só `status <> 'cancelado'`) → **F1**            |

Só **dois** pontos esquecem `excluido_em IS NULL`: a contagem `usos` da
exclusão de cadastro (#26, efeito conservador — ver F3) e a cláusula `WHERE`
do índice único parcial (#27, este quebra o fluxo de reserva — ver F1).

### Vocabulário de status

- **CHECK constraint: sim.** `migrations.js:256` —
  `CHECK (status IN ('pendente', 'confirmado', 'concluido', 'cancelado'))`.
  `tests/db.test.js` confirma que `'qualquer_coisa'` é rejeitado na escrita.
- **`TRANSICOES_LEGAIS`** (`agendamentos.js:365-370`) e `STATUS_VALIDOS`
  (`:372`) usam exatamente esses 4. `mudarStatusAgendamento` valida contra a
  lista antes de gravar.
- **Nenhuma query usa status inexistente.** Grep de literais de status em
  `src/` só encontra os 4 (sem `'concluído'` com acento, sem `'realizado'`
  como status — "realizado"/"previsto" são rótulos de saída, não valores de
  coluna).
- **Comparação com o resumo financeiro** (`resumo/route.js`):
  - `realizado` = `status = 'concluido'`
  - `previsto` = `status IN ('pendente', 'confirmado')`
  - `cancelado` = contado à parte; excluído de série, `porServico`,
    `porBarbeiro`, `agendaHoje` via `status <> 'cancelado'`.
  - `serie`/`totaisPorMes` = `realizado + previsto`, filtrando `status <>
'cancelado'` — cobre os mesmos 3 status.
  - Todo status tem destino, e os destinos são mutuamente exclusivos e
    completos. **Consistente.**
  - **Única exceção**: `doDia.total` (`:146`) é `COUNT(*)` **sem** `status
<> 'cancelado'` — conta cancelados do dia, ao contrário das somas na
    mesma query. Ver **F6**.

### FKs e ON DELETE: barbeiro/serviço órfão ou incoerente?

FKs (do mapa, seção 1.1):
`agendamentos.barbeiro_id → barbeiros(id) ON DELETE SET NULL`;
`agendamentos.servico_id → servicos(id) ON DELETE SET NULL`;
`servico_barbeiro.{servico_id,barbeiro_id} → ON DELETE CASCADE`;
`bloqueios.barbeiro_id → barbeiros(id) ON DELETE CASCADE`.
`foreign_keys = ON` é setado em toda conexão (`db.js:18`).

- **Remover (DELETE físico)**: só acontece quando `usos == 0`
  (`[recurso]/[id]/route.js:103-108`), e `usos` conta **qualquer**
  agendamento com aquele `barbeiro_id`/`servico_id` (inclusive cancelado e
  excluído — F3). Logo, no momento do DELETE físico não há nenhuma linha de
  `agendamentos` para o `SET NULL` afetar. **O ramo `ON DELETE SET NULL` de
  `agendamentos` é, na prática, inalcançável pela aplicação** → sem órfão.
  (Se alcançado por SQL cru, o agendamento ficaria com `barbeiro_id = NULL` +
  `barbeiro_nome` congelado; o resumo lida com isso via `COALESCE(b.nome,
a.barbeiro_nome)` e `GROUP BY CASE ...`, mas `horariosLivres` e
  `verificarConflito` filtram `WHERE barbeiro_id = ?` e passariam a **ignorar
  esse agendamento nas checagens de conflito**.)
- **Efeito colateral do DELETE físico**: um barbeiro sem agendamentos mas com
  **bloqueios futuros** pode ser apagado; `ON DELETE CASCADE` apaga os
  bloqueios junto, silenciosamente. Plausível só nas primeiras semanas.
  Severidade baixa; anotado aqui, sem finding próprio.
- **Desativar (`ativo = 0`)**: agendamentos mantêm o `barbeiro_id`/`servico_id`
  apontando para o cadastro inativo. Leituras e checagens de conflito seguem
  funcionando por id. `criarAgendamento` recusa novo agendamento em
  barbeiro/serviço inativo (`:134-135`). `remarcarAgendamento` **também
  recusa** (`:289-290`) — então um agendamento já existente num barbeiro que
  foi desativado **não pode ser remarcado** sem reativar o barbeiro antes.
  `mudarStatusAgendamento` **não** checa `ativo` — dá para cancelar/concluir
  normalmente (desejável, para fechar o caixa). Sem órfão nem incoerência de
  dado; a limitação de remarcação é de produto.
- **Incoerência real ao desativar**: `servico_barbeiro` não é tocado, então
  um serviço cujo único profissional foi desativado continua "completo" para
  o `GET /api/public` → ver **F5**.

### Snapshot de preço/duração: mudar o preço de um serviço altera o histórico?

- **Não, para agendamentos já criados.** `criarAgendamento` grava
  `servico.preco_centavos` e `servico.duracao_min` na linha do agendamento
  (`agendamentos.js:202-205`); todas as somas do financeiro usam
  `a.preco_centavos` da própria linha. Um `PATCH` em `servicos.preco_centavos`
  não toca `agendamentos` — e é auditado (`acao:'alterar_preco'`,
  `[recurso]/[id]/route.js:60-68`). `tests/resumo.test.js` exercita o
  agrupamento por id; o snapshot de preço em si não tem teste dedicado.
- **Sim, se o agendamento for remarcado depois.** `remarcarAgendamento`
  **recalcula** `preco_centavos`, `duracao_min` e `fim` a partir do serviço
  **atual** (`:305, :330-331`) — o snapshot não é imutável. Ver **F4**.

### Remarcação e reabertura de cancelado podem criar sobreposição?

- **Sobreposição nova que escape das checagens: não**, desde que todo
  caminho de escrita passe por `verificarConflito` — e hoje passa
  (`remarcarAgendamento` e `mudarStatusAgendamento` chamam, dentro de
  `.immediate()`, com `ignorarId`). O `PATCH` genérico de `[recurso]/[id]`
  **não** trata `agendamentos` (não está em `RECURSOS`), então não há atalho.
- **O banco não garante não-sobreposição**, só não-duplicação exata (índice
  único). A proteção contra cruzamento parcial é 100% aplicação.
- **Reabertura de cancelado pode ser bloqueada indevidamente** por um
  agendamento com soft delete no mesmo slot exato (mesmo mecanismo do F1): o
  `verificarConflito` libera (ignora o excluído), o `UPDATE status` tenta
  entrar no índice único e colide com a entrada do excluído → `409`.
  `tests/estado-agendamento.test.js` cobre reabertura contra **cancelado
  ocupado** e contra **horário livre**, mas não contra um **excluído** no
  mesmo slot.

---

## Experimentos rodados nesta etapa

### E1 — soft delete × índice único (confirma F1)

`node --import ./tests/register-hooks.mjs exp-softdelete-indice.mjs` num banco
temporário migrado:

```
1) criar 10:00       => { ok:true, id:1, status:"confirmado" }
2) soft delete       => { ok:true }
3) linha no banco    => { id:1, status:"confirmado", excluido_em:"2026-08-27 03:22:46" }
4) horariosLivres tem 10:00? => true   (lista: ["09:00","09:30","10:00"])
5) recriar 10:00     => { ok:false, status:409, erro:"Esse horário já está ocupado. Escolha outro, por favor." }
6) linhas nesse slot => [ { id:1, status:"confirmado", excluido:1 } ]
```

O passo 4 mostra o slot livre; o passo 5 mostra que não dá para reservá-lo.
A única linha nesse slot (passo 6) é a excluída, com `status` intacto —
por isso ainda está no índice parcial.

### E2 — `busy_timeout` default (confirma F2)

```
busy_timeout default          = 5000
busy_timeout com {timeout:0}   = 0
```

`new Database(path)` sem opções já vem com 5000 ms; o valor não está no
código do projeto.

---

## Achados

Formato: `ID | Severidade | Arquivo:linha | O que está errado | Quando quebra | Método de correção | Esforço | Risco de mexer`

### F1 — Índice único parcial não exclui `excluido_em`: todo agendamento excluído deixa o slot permanentemente não-reservável

| Campo                  | Conteúdo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severidade**         | **P1** (argumentável P0 — "perde agendamento")                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Arquivo:linha**      | `src/lib/migrations.js:276-280` (índice `idx_ag_sem_duplicidade`, `WHERE status <> 'cancelado'`), em conflito com `src/lib/agendamentos.js:441-464` (`excluirAgendamento` seta só `excluido_em`, mantém `status`) e `src/lib/slots.js:130-131` / `agendamentos.js:75-77` (checagens filtram `excluido_em IS NULL`)                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **O que está errado**  | A cláusula do índice parcial é só `WHERE status <> 'cancelado'`. Um agendamento com soft delete (`excluido_em` setado, `status` continua `confirmado`/`pendente`) permanece na chave única `(barbeiro_id, data, inicio)`. As checagens da aplicação e `horariosLivres` filtram `excluido_em IS NULL` e enxergam o slot como livre; o `INSERT`/`UPDATE` seguinte estoura `UNIQUE constraint`.                                                                                                                                                                                                                                                                                                                                                        |
| **Quando quebra**      | Toda vez que a dona exclui um agendamento pelo painel (botão de lixeira → `DELETE /api/admin/agendamentos/[id]` → soft delete). Cenário: terça, ela exclui por engano o corte das 10:00 do Heitor; o cliente liga querendo manter as 10:00; ela tenta recadastrar (ou o cliente tenta pelo site) e recebe **409 "Esse horário já está ocupado"**, com a agenda visual mostrando as 10:00 **vazias**. Idem para reabrir um cancelado cujo slot exato tenha um excluído. O slot fica morto até editar o banco na mão. Confirmado por E1.                                                                                                                                                                                                              |
| **Método de correção** | Migration nova: `DROP INDEX idx_ag_sem_duplicidade; CREATE UNIQUE INDEX idx_ag_sem_duplicidade ON agendamentos(barbeiro_id, data, inicio) WHERE status <> 'cancelado' AND excluido_em IS NULL;` — SQLite faz `DROP`/`CREATE INDEX` sem rebuild de tabela. Rodar dentro do `BEGIN` da migration; se o `CREATE UNIQUE` falhar por duplicidade real pré-existente (dois vivos no mesmo slot — improvável, o índice antigo já barrava), a migration deve abortar e apontar as linhas. Regra geral: a `WHERE` do índice tem de enxergar o mesmo conjunto "vivo" que `verificarConflito`. Não resolver isso mexendo em `excluirAgendamento` para também gravar `status='cancelado'` — isso contamina o relatório de cancelados e não corrige a estrutura. |
| **Esforço**            | Baixo — 1 migration curta + 1 teste (`db.test.js`: excluir e reinserir no mesmo slot deve funcionar; reabrir cancelado com um excluído no slot deve funcionar).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Risco de mexer**     | Baixo. Reversível. Único risco: duplicidade real pré-existente no banco de produção travar o `CREATE UNIQUE` — mitigado rodando a migration numa transação com verificação prévia.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### F2 — `busy_timeout` não é setado no código; `SQLITE_BUSY` vira 500 genérico em vez de conflito amigável

| Campo                  | Conteúdo                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severidade**         | **P2**                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Arquivo:linha**      | `src/lib/db.js:16` (`new Database(DB_PATH)` sem `{ timeout }`); `src/lib/agendamentos.js:27-36` (`tratarErroTransacao` só reconhece `SQLITE_CONSTRAINT*`)                                                                                                                                                                                                                                                                                                |
| **O que está errado**  | O sistema depende do default implícito de 5000 ms do better-sqlite3 (confirmado em E2) para segurar contenção de writers. Se esse default mudar (`{ timeout: 0 }`, troca de driver) ou um writer segurar o lock > 5 s, o segundo writer recebe `SQLITE_BUSY`, que `tratarErroTransacao` não trata → rethrow → `comLog` → **500 "Algo deu errado"**, não 409/429.                                                                                         |
| **Quando quebra**      | (a) `npm run migrate` rodando com o servidor no ar durante a migration 3 (rebuild de `agendamentos`, copia a tabela inteira): escritas concorrentes do site bloqueiam e podem estourar 5 s → 500 para o cliente no meio de um agendamento. (b) Deploy multi-processo (dois `next start`, PM2 cluster) sob pico: contenção real, e qualquer `SQLITE_BUSY` que escape do timeout vira 500. Hoje, num processo só e sem migration concorrente, não dispara. |
| **Método de correção** | (1) `abrirConexao()`: `new Database(DB_PATH, { timeout: 5000 })` — tornar o valor explícito. (2) `tratarErroTransacao`: reconhecer `e.code === 'SQLITE_BUSY'` / `'SQLITE_BUSY_SNAPSHOT'` e devolver 409 (ou 503 "tente de novo em instantes") em vez de deixar virar 500. (3) Runbook de deploy: parar o servidor antes de `npm run migrate`, subir depois — nunca migrar com tráfego.                                                                   |
| **Esforço**            | Baixo.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Risco de mexer**     | Baixo — só amplia o tratamento de erro e fixa um default que já é o vigente.                                                                                                                                                                                                                                                                                                                                                                             |

### F3 — `usos` na exclusão de cadastro não filtra `excluido_em` nem `status`

| Campo                  | Conteúdo                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severidade**         | **P3**                                                                                                                                                                                                                                                                                                                                                                                |
| **Arquivo:linha**      | `src/app/api/admin/[recurso]/[id]/route.js:103-105`                                                                                                                                                                                                                                                                                                                                   |
| **O que está errado**  | `SELECT COUNT(*) FROM agendamentos WHERE barbeiro_id = ?` (ou `servico_id`) conta agendamentos de qualquer status e inclusive os com soft delete. O efeito é **conservador** (protege o cadastro → desativa em vez de apagar), mas é inconsistente com o modelo de soft delete usado em todo o resto, e a fronteira "apagar de vez × desativar" passa a depender de linhas excluídas. |
| **Quando quebra**      | Não corrompe. Um barbeiro cadastrado por engano, com um único agendamento de teste que depois foi excluído, não pode mais ser apagado de vez — vira "desativado". Ruído de cadastro nas primeiras semanas.                                                                                                                                                                            |
| **Método de correção** | Decidir e documentar a política. Recomendação: **manter** (qualquer histórico, mesmo excluído, protege o cadastro) e deixar um comentário explicando. Se a decisão for "só agendamento vivo protege", adicionar `AND excluido_em IS NULL` — mas **não** filtrar `status`, porque um cancelado ainda é histórico que o financeiro conta.                                               |
| **Esforço**            | Trivial (comentário) ou baixo (um `AND`).                                                                                                                                                                                                                                                                                                                                             |
| **Risco de mexer**     | Passar a filtrar `excluido_em IS NULL` faria apagar fisicamente cadastros hoje preservados → aí `ON DELETE CASCADE` remove bloqueios do barbeiro e `ON DELETE SET NULL` pode agir sobre agendamentos excluídos. Preferir **não** mexer, só comentar.                                                                                                                                  |

### F4 — Remarcação re-fotografa preço/duração do serviço atual; o snapshot não é imutável

| Campo                  | Conteúdo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severidade**         | **P2** (rebaixável a P3 se for decisão de produto explícita)                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Arquivo:linha**      | `src/lib/agendamentos.js:305` (`novoFim` a partir de `servico.duracao_min` atual) e `:318-334` (`UPDATE ... duracao_min = ?, preco_centavos = ?` com valores do serviço atual)                                                                                                                                                                                                                                                                                                                                |
| **O que está errado**  | `criarAgendamento` congela preço/duração na linha (correto). `remarcarAgendamento` **recalcula** esses campos a partir do serviço atual, mesmo quando só a data/horário mudam e o serviço é o mesmo. Uma remarcação, que a dona entende como "só mexer no horário", altera o valor gravado do agendamento.                                                                                                                                                                                                    |
| **Quando quebra**      | A dona sobe "Corte" de R$ 30 → R$ 40. Um agendamento confirmado da semana que vem, criado a R$ 30, é remarcado a pedido do cliente. Depois da remarcação ele vale R$ 40; o "previsto" do mês muda sem ninguém ter mexido em preço naquele agendamento. Só atinge "previsto" (remarcação recusa `concluido`/`cancelado`), nunca "realizado".                                                                                                                                                                   |
| **Método de correção** | Decisão de produto. Opção B (recomendada, respeita o snapshot já adotado na criação): quando `servicoId` **não** vem no `PATCH` (serviço inalterado), preservar `preco_centavos`/`duracao_min` da linha e recalcular só `fim` a partir do `duracao_min` já gravado; recotar apenas quando o `servico_id` muda. Opção A (mínima): manter, mas a tela de remarcar avisa "o valor passa a ser o preço atual do serviço (R$ X)". A auditoria de `remarcar` já grava `antes`/`depois` com preço — a trilha existe. |
| **Esforço**            | Baixo (Opção B: retirar 3 colunas do `UPDATE` quando `servicoId === undefined`).                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Risco de mexer**     | Baixo — caminho coberto por `tests/estado-agendamento.test.js`; adicionar caso para "remarcar sem trocar serviço preserva preço".                                                                                                                                                                                                                                                                                                                                                                             |

### F5 — Serviço sem profissional ativo continua ofertado no site; o erro só aparece no fim do formulário

| Campo                  | Conteúdo                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severidade**         | **P1**                                                                                                                                                                                                                                                                                                                                                                                         |
| **Arquivo:linha**      | `src/app/api/public/route.js:12-15` (filtra `servicos` por `s.barbeiros.length > 0`, mas `s.barbeiros` vem de `servico_barbeiro` sem cruzar com `ativo`); `src/lib/db.js:82-97` (`listarServicos` não filtra vínculo por barbeiro ativo); `src/lib/agendamentos.js:135` (rejeição tardia `!barbeiro.ativo` → 400); `src/app/api/horarios/route.js` (não checa `ativo` do barbeiro)             |
| **O que está errado**  | Desativar um barbeiro não mexe em `servico_barbeiro`. Um serviço cujo único executante foi desativado ainda passa no filtro `barbeiros.length > 0` do `/api/public` e é listado, com esse barbeiro em `barbeiros[]`. `GET /api/horarios` devolve grade normalmente para o par. Só `criarAgendamento` barra, depois de tudo preenchido.                                                         |
| **Quando quebra**      | Barbearia com 2 profissionais; um entra de férias e é desativado; era o único que fazia "Barba". O site segue oferecendo "Barba" com ele; o cliente escolhe dia e horário, confirma e recebe "Esse profissional está desativado.". Perde-se o agendamento que teria sido feito com o outro profissional se a combinação tivesse sido escondida.                                                |
| **Método de correção** | No `GET /api/public`, ao montar `servicos[].barbeiros`, cruzar os vínculos com a lista de barbeiros **ativos** já carregada na mesma rota; descartar serviço que fique sem nenhum ativo (o filtro `length > 0` passa a contar só ativos). Em `GET /api/horarios` e no `PUT` de encaixe, rejeitar (404 / lista vazia) par serviço×barbeiro inativo. Regra final continua em `criarAgendamento`. |
| **Esforço**            | Baixo.                                                                                                                                                                                                                                                                                                                                                                                         |
| **Risco de mexer**     | Baixo — restringe o que o site oferece, não muda regra de gravação.                                                                                                                                                                                                                                                                                                                            |

### F6 — `doDia.total` no resumo conta agendamentos cancelados do dia

| Campo                  | Conteúdo                                                                                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Severidade**         | **P3** (P1 se a dona usa esse número para conferência do dia)                                                                                                                                                                        |
| **Arquivo:linha**      | `src/app/api/admin/resumo/route.js:145-153` (`COUNT(*) AS total ... WHERE data = ? AND excluido_em IS NULL`, sem `status <> 'cancelado'`)                                                                                            |
| **O que está errado**  | Na mesma query, `realizado`/`previsto`/`confirmados`/`pendentes` ignoram cancelado (via `CASE`), mas `total` é `COUNT(*)` cru. O card "hoje" conta cancelados; a agenda visual logo abaixo (que filtra cancelado) não.               |
| **Quando quebra**      | Dia com 8 marcações, 3 canceladas: visão geral diz "8 hoje", a lista mostra 5. Números da mesma tela não batem. Não corrompe nada.                                                                                                   |
| **Método de correção** | Definir "total do dia". Se for "o que vai acontecer", adicionar `AND status <> 'cancelado'` ao `COUNT(*)`. Se for "tudo que foi marcado", manter e rotular assim na UI. Documentar em comentário, como as outras queries do arquivo. |
| **Esforço**            | Trivial.                                                                                                                                                                                                                             |
| **Risco de mexer**     | Baixo.                                                                                                                                                                                                                               |

### F7 — Checagens de existência/atividade de serviço e barbeiro ficam fora da transação de escrita

| Campo                  | Conteúdo                                                                                                                                                                                                                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severidade**         | **P3** (teórico nesta escala)                                                                                                                                                                                                                                                                                                   |
| **Arquivo:linha**      | `src/lib/agendamentos.js:125-144` (SELECTs de `servicos`, `barbeiros`, `servico_barbeiro`) antes do `conn.transaction(...).immediate()` em `:176`                                                                                                                                                                               |
| **O que está errado**  | Existência e `ativo` de serviço/barbeiro, e o vínculo entre eles, são lidos antes de o write lock ser preso. A transação só revalida o **conflito de horário**, não esses pré-requisitos. Janela de corrida entre "li que está ativo" e "gravei".                                                                               |
| **Quando quebra**      | Precisaria a dona desativar o barbeiro no exato intervalo de ms entre as duas etapas, com um agendamento chegando junto. Num processo só, uma unidade, um admin: praticamente impossível. Com múltiplos processos, deixa de ser zero. Listado por completude — a etapa perguntou explicitamente por checagem fora de transação. |
| **Método de correção** | Mover os SELECTs de serviço/barbeiro/vínculo para dentro da callback de `conn.transaction`, ou aceitar e documentar o risco. Nesta escala, documentar é defensável — reorganizar o caminho crítico não se paga.                                                                                                                 |
| **Esforço**            | Médio (reorganiza o corpo de `criarAgendamento`/`remarcarAgendamento`).                                                                                                                                                                                                                                                         |
| **Risco de mexer**     | Médio — caminho crítico de escrita; exige bateria de regressão sólida.                                                                                                                                                                                                                                                          |

### F8 — `excluirAgendamento` usa transação `deferred` e pode gravar duas linhas de auditoria numa exclusão concorrente

| Campo                  | Conteúdo                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severidade**         | **P3**                                                                                                                                                                                                                                                                                                                                                                        |
| **Arquivo:linha**      | `src/lib/agendamentos.js:441-463` — `SELECT ... WHERE id=? AND excluido_em IS NULL` fora da transação (`:444`); `conn.transaction(...)` chamado como `executarExclusao()` (BEGIN DEFERRED), enquanto criar/remarcar/status usam `.immediate()`                                                                                                                                |
| **O que está errado**  | A checagem "ainda não excluído" acontece fora da transação. Dois `DELETE` no mesmo id quase simultâneos (dois cliques, duas abas): ambos leem `excluido_em IS NULL`, ambos entram, ambos fazem `UPDATE` (o 2º re-grava `excluido_em` com timestamp posterior) e ambos chamam `registrarAuditoria(acao:'excluir')`. Resultado: 2 linhas de auditoria para uma exclusão lógica. |
| **Quando quebra**      | Improvável com um admin; possível com o painel aberto em dois lugares. Não perde dado; polui a trilha que a Etapa 8 do plano original criou justamente para responsabilização.                                                                                                                                                                                                |
| **Método de correção** | Re-verificar `excluido_em IS NULL` **dentro** da transação e sair cedo se já excluído; e/ou condicionar `registrarAuditoria` a `resultado.changes > 0` (padrão que o `PATCH` de `alterar_preco` já usa). Trocar para `.immediate()` por consistência com as outras três mutações — não há custo.                                                                              |
| **Esforço**            | Baixo.                                                                                                                                                                                                                                                                                                                                                                        |
| **Risco de mexer**     | Baixo.                                                                                                                                                                                                                                                                                                                                                                        |

---

## O que está correto (para contraste)

- **Atomicidade da criação e da remarcação**: `BEGIN IMMEDIATE` + checagem +
  `INSERT`/`UPDATE` na mesma transação síncrona, sem `await` no meio.
  `tests/concorrencia.test.js` prova a serialização na colisão exata
  (1×201, 1×409, `COUNT=1`).
- **Índice único parcial como rede**: mesmo se `verificarConflito` deixasse
  passar uma colisão exata, o `idx_ag_sem_duplicidade` barra o `INSERT`, e
  `tratarErroTransacao` traduz `SQLITE_CONSTRAINT*` em 409 amigável.
- **Soft delete nas leituras**: 24 das 25 queries de leitura/contagem/soma
  filtram `excluido_em IS NULL` (a exceção, `usos`, erra para o lado seguro).
- **Vocabulário de status**: CHECK no banco + `TRANSICOES_LEGAIS` na
  aplicação + destinos completos e exclusivos no financeiro.
- **Snapshot na criação**: preço/duração congelados na linha; alterar preço
  de serviço não reescreve histórico (só a remarcação recota — F4).
- **Máquina de estados**: `mudarStatusAgendamento` recusa transição ilegal,
  recusa concluir data futura, e revalida conflito ao reabrir cancelado,
  tudo dentro de `.immediate()`.
- **`foreign_keys = ON`** em toda conexão de runtime; desligado só durante
  cada migration (obrigatório para o rebuild) e religado logo depois.
