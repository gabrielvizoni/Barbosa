# 09 — Plano: consolidação da auditoria do back-end

Consolida `auditoria/01` a `08`. 37 achados originais (F1–F37) + 14
inconsistências de contrato (I-1–I-14). Após deduplicação: **33 achados** —
5 P1, 11 P2, 17 P3.

---

## 1. Sumário executivo — posso congelar este back-end?

**Ainda não. Mas falta pouco e é localizado — nenhuma correção mexe em
arquitetura.**

Nenhum achado corrompe dado gravado em silêncio nem dá acesso de admin a
terceiro. O que bloqueia o congelamento são cinco P1, todos com correção
pequena e isolada:

- **F1** — toda exclusão de agendamento pelo painel deixa aquele horário
  **permanentemente não-reservável** (o índice único não enxerga o soft
  delete). Confirmado por experimento. Migration de 3 linhas.
- **F19 / F20** — qualquer pessoa anônima, com um laço de shell, **fecha o
  agendamento público** (~1 req/100 s) ou **tranca a dona fora do painel**
  (8 logins falhos), indefinidamente. Causa: `TRUST_PROXY=0` joga todos na
  mesma chave de rate limit.
- **F5 / F12** — o site oferece combinações serviço×profissional que o
  back-end só rejeita depois do formulário inteiro preenchido.
- **F30 / F33** — o backup documentado ("copie `app.db`") perde os commits
  que estão no WAL, e não há runbook de restauração nem backup pré-migration.
  É a única cópia da agenda.

Estimativa: **1 deploy** fecha os cinco (código: 1–2 dias; backup/runbook:
1 dia). Depois disso o back-end pode congelar. Os 11 P2 e 17 P3 são
melhorias que **não bloqueiam** a reescrita do front — vários entram de
carona quando o arquivo já estiver aberto.

---

## 2. Tabela única de achados (deduplicada, por severidade)

Coluna **Deploy**: A = pré-congelamento (bloqueia o freeze) · B = endurecimento

- contrato · C = upload + ops. Ver §5.

### P1

| ID          | Onde                                                                                                                             | O que está errado                                                                                                                                                                                                                                    | Confirmado                                        | Correção (resumo)                                                                                                                                                                                                     | Deploy    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **F1**      | `migrations.js:276-280` + `agendamentos.js:441-464`                                                                              | Índice `idx_ag_sem_duplicidade` só filtra `status <> 'cancelado'`, não `excluido_em`. Agendamento com soft delete continua ocupando o slot → recriar/ reabrir naquele horário dá 409, com a agenda visualmente vazia.                                | **Sim** (experimento `exp-softdelete-indice.mjs`) | Migration 6: `DROP INDEX` + `CREATE UNIQUE INDEX ... WHERE status <> 'cancelado' AND excluido_em IS NULL`.                                                                                                            | A         |
| **F5+F12**  | `db.js:82-97` (`listarServicos`), `public/route.js:12-15`, `horarios/route.js:20-34`, `admin/agendamentos/route.js:98-119` (PUT) | Desativar um profissional não mexe em `servico_barbeiro`. `/api/public` segue ofertando o serviço; `/api/horarios` e o PUT de encaixe devolvem grade cheia para pares que `criarAgendamento` rejeita. Perda de conversão.                            | Sim (leitura)                                     | `/api/public`: contar só barbeiros **ativos** ao montar `servicos[].barbeiros` e ao filtrar `length > 0`. `/api/horarios` e PUT: validar que o barbeiro existe, está ativo e executa o serviço → 404 / lista vazia.   | A         |
| **F19**     | `limitador.js:92-100`, `agendamentos/route.js:16-32`                                                                             | `obterIp` devolve `"sem-ip"` para todos com `TRUST_PROXY≠1`. 6 POSTs em 10 min (qualquer corpo, tentativa contada antes da validação e em sucesso) fecham o agendamento para todo cliente. ~1 req/100 s mantém fechado.                              | Sim (leitura do fluxo)                            | Não contar tentativa em sucesso; subir muito o teto contando por agendamento **criado**; exigir `TRUST_PROXY=1` + proxy em produção; (médio prazo) CAPTCHA/PoW no formulário. **Requer decisão — §6.1.**              | A         |
| **F20**     | `limitador.js:92-100`, `login/route.js:22-24,43-60`                                                                              | `login:sem-ip` compartilhado; teto por chave (8) < global (50). 8 logins falhos anônimos → a dona recebe 429 por 15 min, renovável para sempre.                                                                                                      | Sim (leitura)                                     | Backoff/CAPTCHA após N falhas em vez de 429 chapado; e/ou passe para quem apresenta cookie de sessão anterior; e/ou `TRUST_PROXY=1` + proxy. **Requer decisão — §6.1.**                                               | A         |
| **F30+F33** | `README.md:180-185`; `scripts/migrate.js:13-16`; `migrations.js` (só `up()`)                                                     | Backup documentado = copiar `app.db` → perde o que está no `-wal` (minutos a dias de agendamento) e pode capturar página rasgada. Restauração não documentada (falta apagar `-wal`/`-shm`). `npm run migrate` não tira cópia antes; não há `down()`. | Sim (leitura)                                     | Backup consistente por cron (`sqlite3 ".backup"` / `VACUUM INTO` / snapshot de volume), off-site; runbook de restauração; `scripts/migrate.js` copia o banco antes de `aplicarMigrations`. **Requer decisão — §6.2.** | A (+ ops) |

### P2

| ID             | Onde                                                              | O que está errado                                                                                                                                                                                            | Correção (resumo)                                                                                                                                                                                       | Deploy                    |
| -------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| **F2**         | `db.js:16`, `agendamentos.js:27-36`                               | `busy_timeout` herdado do default (5000 ms) do driver, não setado no código; `SQLITE_BUSY` não tratado → 500 genérico em vez de 409/503.                                                                     | `new Database(DB_PATH, { timeout: 5000 })` explícito; `tratarErroTransacao` reconhece `SQLITE_BUSY`/`SQLITE_BUSY_SNAPSHOT` → 409/503.                                                                   | A                         |
| **F4**         | `agendamentos.js:305,318-334`                                     | Remarcação recota `preco_centavos`/`duracao_min` do serviço atual — snapshot não é imutável; mover a data de um agendamento muda o "previsto" do mês.                                                        | Preservar preço/duração quando `servicoId` não muda; recotar só quando o serviço muda. **Requer decisão — §6.4.**                                                                                       | A                         |
| **F9+F10+F24** | `config/route.js:63-78`, `slots.js:173-185`, `public/route.js:40` | `PUT /api/admin/config` não valida nada. `dias_futuros` negativo zera a agenda pública; alto faz `/api/public` varrer ~300 mil dias (~1,3 MB/visita); textos (`nome_barbearia` etc.) sem teto.               | Esquema `config` em `validacao.js`: `intervalo_min` 5–120, `antecedencia_min` 0–10080, `dias_futuros` 1–365, `confirmacao_automatica` ∈ {"0","1"}, textos com teto. `diasDisponiveis` com teto interno. | B                         |
| **F15**        | `auth.js:210-212` + ausência de store de sessão                   | Logout só apaga o cookie no cliente; token capturado sobrevive ao "Sair" por até 12 h (ou até troca de senha).                                                                                               | `POST /api/admin/logout` incrementa `sessao_versao` (mesmo mecanismo de `trocarSenha`) — derruba todas as sessões, aceitável num painel de um usuário.                                                  | B                         |
| **F21**        | `requisicao.js:11-13`                                             | `lerCorpoJson` faz `request.text()` sem teto; caminho público deixa passar ~6 corpos gigantes por janela global antes do 429 → OOM.                                                                          | `lerCorpoJson` checa `Content-Length` / lê com teto (ex.: 64 KB) → 413.                                                                                                                                 | A                         |
| **F22**        | `upload/route.js:110-121`                                         | `sharp` decodifica imagem até ~268 MP (default `limitInputPixels`) → ~1 GB de RAM por upload; poucas em paralelo → OOM (upload é autenticado).                                                               | `sharp(bytes).metadata()` antes do `.resize()`, rejeitar `width`/`height` acima de ~6000 px; e/ou `limitInputPixels` explícito menor.                                                                   | C                         |
| **F23**        | `upload/route.js:124-126`, `.gitignore`                           | Grava em `public/uploads/` (git-ignored). Serverless: `fs.writeFileSync` falha. Self-host sem volume: some no deploy.                                                                                        | Diretório de dados fora de `public/` num volume persistente + rota `GET /api/imagem/[...]` (ou alias no proxy); migrar caminhos existentes. **Requer decisão — §6.3.**                                  | C                         |
| **F27**        | `agendamentos/route.js:24`, `login/route.js:55`, `log.js:8-11`    | Uma linha de log por request bloqueado; sob F19/F20 vira MB/hora de stdout → enche o disco / custa em log gerenciado.                                                                                        | Amostrar/agregar o log de bloqueio (1ª ocorrência da chave na janela + contador). Runbook: rotação de log no host.                                                                                      | B                         |
| **F28**        | `resumo/route.js:169,175,230,237`, `pendentes/route.js:12`        | 4 varreduras de tabela inteira (`recentes`, `pendentesTotal`, `geralRealizado`, `geralPrevisto`) crescem linearmente; congelam o site público durante cada abertura do painel (~8 ms em 5 anos, ×5–10 frio). | Migration 6: índices parciais `idx_ag_pendentes` e `idx_ag_criado` (de carona no deploy da F1). `geralRealizado`/`geralPrevisto`: limite de data. **Decisão sobre "faturamento geral" — §6.6.**         | A (índices) / B (queries) |
| **F31**        | `db.js:22-48`, `log.js:35-47`                                     | Sem validação no boot; banco não migrado / `SESSION_SECRET` ausente → processo sobe, 1º request 500 genérico, mensagem só no stdout. `SESSION_SECRET` ausente derruba o site público inteiro.                | `instrumentation.ts` chama `getDb()` no start; se lançar, `stderr` + `process.exit(1)`. `/api/health` com `motivo` (ver F32).                                                                           | B                         |
| **F32**        | `health/route.js:12-30`, `config-ambiente.js:42-52`               | `/api/health` faz `SELECT 1` (leitura) + `access(W_OK)` (permissão, não espaço). Disco cheio / FS `ro` → health verde com escrita falhando. 503 sem diagnóstico.                                             | Escrita trivial de verdade (INSERT+rollback numa linha de heartbeat, ou write+unlink de tempfile). Corpo do 503 com `motivo` curto não-sensível.                                                        | B                         |

### P3

| ID      | Onde                                                             | O que está errado                                                                                                                                                    | Correção (resumo)                                                                                                                             | Deploy        |
| ------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| **F3**  | `[recurso]/[id]/route.js:103-105`                                | `usos` (contagem para decidir apagar × desativar) não filtra `excluido_em`/status.                                                                                   | **Ver §3 (Não corrigir).** Só comentar a intenção.                                                                                            | —             |
| **F6**  | `resumo/route.js:145-153`                                        | `hoje.total` conta cancelados; as somas na mesma resposta não. = I-14.                                                                                               | `AND status <> 'cancelado'` no `COUNT(*)`, ou renomear. **Decisão — §6.5.**                                                                   | B             |
| **F7**  | `agendamentos.js:125-144`                                        | Checagens de existência/atividade de serviço/barbeiro fora da transação `.immediate()`.                                                                              | **Ver §3 (Não corrigir).**                                                                                                                    | —             |
| **F8**  | `agendamentos.js:441-463`                                        | `excluirAgendamento` usa transação `deferred`; 2 DELETEs concorrentes do mesmo id → 2 linhas de auditoria.                                                           | Se `agendamentos.js` for aberto no Deploy A: `.immediate()` + `registrarAuditoria` condicionado a `changes > 0`. Senão, não corrigir isolado. | A (de carona) |
| **F11** | `admin/agendamentos/route.js:98-119` vs `agendamentos.js:70-99`  | Grade de encaixe (via `horariosLivres`) mais estreita que o `POST` aceita.                                                                                           | **Ver §3 (Não corrigir).** Decisão de UX do front.                                                                                            | —             |
| **F13** | `slots.js:148-152`                                               | Passo que não divide o expediente deixa a sobra do fim do dia sem oferta. Nenhum slot errado é oferecido.                                                            | **Ver §3 (Não corrigir).** Documentar que `intervalo_min` deve dividir o expediente. **Decisão — §6.11.**                                     | —             |
| **F14** | `migrations.js:92,257,304`, `agendamentos.js:451`                | `criado_em`/`excluido_em`/`auditoria.criado_em` em UTC; qualquer exibição como hora local erra 3 h e a data perto da meia-noite. = I-9. Latente (só ordenação hoje). | Documentar como UTC no contrato + converter na borda do front; ou gravar no fuso (migration). **Decisão — §6.7.**                             | B (doc)       |
| **F16** | `senha/route.js`                                                 | `POST /api/admin/senha` sem rate limit (pré-condição: sessão válida).                                                                                                | Aplicar o `limitador` com chave `senha:<ip>`, limite baixo. **Decisão — §6.9.**                                                               | B             |
| **F17** | `login/route.js:34-41`, `sessao/route.js:11-13`                  | 503 detalhado + `configuracaoInsegura` contam a não autenticado que o servidor está mal configurado.                                                                 | Mensagem detalhada só no log; 503 genérico; `/sessao` sem o campo. **Decisão — §6.10.**                                                       | B             |
| **F18** | `auth.js:269,65-70,225`                                          | Origin não checado sem header `Host`; `iguais` vaza comprimento; `Number("abc") <= Date.now()` é `false` (não expira).                                               | `tokenValido`: rejeitar `!Number.isFinite`. Exigir `Origin` em mutação. `iguais`: aceitar (é o mínimo com `timingSafeEqual`).                 | B             |
| **F25** | `[recurso]/route.js:65-85,144-149`, `[recurso]/[id]/route.js:34` | Lixo numérico → `0` silencioso (`ativo`, `ordem`); `barbeiro_id` textual e `PATCH` parcial de bloqueio → 500 em vez de 400.                                          | `try/catch` traduz `SQLITE_CONSTRAINT*` → 400 com campo; validador de `ativo`; `filtrarCampos` distingue ausente de lixo.                     | B             |
| **F26** | `validacao.js:58,70,81`, `config/route.js`                       | `logo_url`/`foto`/`imagem` aceitam qualquer string ≤ 300; renderizados como `<img src>`.                                                                             | Validar contra `^/uploads/[\w-]+/[0-9a-f-]{36}\.webp$` ou `""`.                                                                               | B/C           |
| **F29** | `auth.js:162,228,287`, `db.js:127-135`                           | `exigirSessao` lê `config` 3×/request; `listarBloqueios` sem filtro de data.                                                                                         | `exigirSessao` lê 1× e reusa. `listarBloqueios` com `WHERE data >= date('now','-30 days')`.                                                   | B             |
| **F34** | `scripts/migrate.js`                                             | `npm run migrate` num servidor vivo bloqueia escritas por até 5 s / 500.                                                                                             | Aviso/abort se detectar servidor no ar; ou nota no README.                                                                                    | B/ops         |
| **F35** | `migrations.js:296-307`, `config/route.js:69-77`                 | `auditoria` sem retenção (~9 MB/ano); audit de config grava WhatsApp/endereço do negócio.                                                                            | Janela de retenção + job. Marcador em vez do valor no audit de config. **Decisão — §6.8.**                                                    | ops           |
| **F36** | `scripts/migrate.js:1-2,13-16`                                   | Comentário obsoleto (`./data/barbosa.db`); `close()` fora de `finally`. Repo tem `data/barbosa.db` órfão.                                                            | Corrigir comentário; `try/finally`; apagar o `.db` órfão local.                                                                               | A (de carona) |
| **F37** | `agendar/FluxoAgendamento.jsx:453-464`                           | Config vazia → "fale pelo WhatsApp" sem número/link.                                                                                                                 | Condicionar a frase ao `whatsapp` preenchido. Front-end.                                                                                      | front         |

### Inconsistências de contrato (08) — decisões para a reescrita do front

Não são defeitos do back-end; são divergências que o front-end vai consumir.
As baratas (1 linha no back-end) valem entrar no deploy que já toca o arquivo.

| ID   | Divergência                                                                       | Forma canônica                                                                         | Custo back-end     |
| ---- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------ |
| I-1  | criação 200 (`POST /api/agendamentos`) vs 201                                     | 201 sempre                                                                             | 1 linha (Deploy A) |
| I-2  | criação devolve objeto completo vs só `{id}`                                      | `{ id, <recurso> }` com shape da listagem                                              | médio              |
| I-3  | `"Não consegui ler os dados enviados."` vs `"JSON inválido."`                     | frase amigável em todo lugar                                                           | 1 linha/arquivo    |
| I-4  | 3 mensagens de 404 + `{erro}` vs `{erro,erros}`                                   | separar "cadastro desconhecido" de "registro não achado"; `erros` opcional documentado | baixo              |
| I-5  | senha errada 401 (login) vs 400 (troca)                                           | 401 para credencial que não confere                                                    | 1 linha (Deploy B) |
| I-6  | `/api/health` sem campo `erro`                                                    | `{ ok, motivo? }`                                                                      | junto de F32       |
| I-7  | `/sessao` shape condicional incompleto                                            | sempre `{ autenticado, senhaInicial, configuracaoInsegura }`                           | baixo (Deploy B)   |
| I-8  | `cliente`/`telefone`/... vs `cliente_nome`/...; `total` ora contagem ora dinheiro | chaves de `AgendamentoRow`; `total`=contagem, dinheiro=`faturamento`                   | médio (Deploy A/B) |
| I-9  | timestamps UTC                                                                    | = F14                                                                                  | ver §6.7           |
| I-10 | `atropelados` omitido para não-bloqueios                                          | `[]` quando aplica; ausente quando não                                                 | baixo (Deploy A)   |
| I-11 | `PUT /api/admin/config` não espelha o `GET`                                       | PUT devolve `{ config, expediente, senhaInicial, fuso }`                               | 1 linha (Deploy B) |
| I-12 | 429 sem `Retry-After`                                                             | header `Retry-After` + `{ erro, retryAfter }`                                          | baixo (Deploy A)   |
| I-13 | serviço inexistente: 404 vs `{horarios:[]}`                                       | 404 nas duas rotas                                                                     | = F12 (Deploy A)   |
| I-14 | `resumo.hoje.total` conta cancelados                                              | = F6                                                                                   | ver §6.5           |

---

## 3. Não corrigir — decisões conscientes, adequadas ao porte

Estas coisas **parecem** problema mas são a escolha certa para uma unidade,
um administrador, um processo. Corrigi-las custaria mais do que vale.

1. **Sem ORM, SQL cru, dependências mínimas.** Filosofia declarada do
   projeto. Para este tamanho, um ORM adiciona superfície de bug e peso sem
   benefício. As queries são poucas e legíveis. **Manter.**

2. **Sessão stateless sem tabela de sessões** (`auth.js`, README:36). O
   preço — não dá para revogar uma sessão específica — é real (F15), mas a
   correção da F15 (bump de `sessao_versao` no logout) resolve o caso
   concreto **dentro** do design stateless. Uma tabela de sessões com `jti` e
   revogação individual seria peso morto para um painel de um usuário.
   **Manter o design; aplicar só a F15.**

3. **better-sqlite3 síncrono + um único arquivo SQLite.** Bloqueia o event
   loop, sim — mas a Etapa 6 mediu: o caminho público quente fica < 1 ms em
   qualquer horizonte. O que degrada (F28) resolve com **índice**, não com
   troca de driver ou de banco. Postgres/Turso/worker threads seriam uma
   reescrita enorme para zero ganho nesta escala. **Manter.**

4. **Soft delete que mantém a linha para sempre** (Etapa 8 do plano). É o
   livro-caixa do negócio — apagar de verdade destruiria o Financeiro e a
   responsabilização (senha compartilhada pela equipe). A F35 adiciona um
   _plano de retenção_ para a `auditoria`; não desfaz o soft delete.
   **Manter.**

5. **`agendamentos` cresce sem teto.** É o registro do negócio, não lixo. Não
   precisa de política de retenção — precisa dos índices da F28 para as
   varreduras não crescerem junto. **Manter sem poda.**

6. **F7 — checagens de existência/atividade fora da transação.** O
   `verificarConflito` (a checagem que importa) **está** na transação. O que
   fica fora é "o barbeiro existe e está ativo". A corrida exige a dona
   desativar um barbeiro no exato milissegundo em que um agendamento público
   chega, no mesmo processo. Num deploy de processo único, uma unidade, um
   admin: impossível na prática. Reorganizar o caminho crítico de escrita
   para fechar isso tem alto custo de regressão. **Não corrigir; documentar
   o racional em comentário.**

7. **F3 — `usos` não filtra `excluido_em`.** O efeito é **conservador na
   direção segura**: um cadastro com qualquer histórico (mesmo excluído) é
   _desativado_ em vez de apagado fisicamente — que é provavelmente o
   comportamento desejado (preserva o Financeiro, evita `ON DELETE CASCADE`
   apagando bloqueios). **Manter; só comentar a intenção.**

8. **F11 — grade de encaixe do painel mais estreita que o `POST` aceita.**
   Intencional: o painel permite encaixe fora do expediente. Não é bug de
   correção (o `POST` aceita tudo que a grade mostra e mais). Se a grade
   completa fizer falta, é decisão da **reescrita do front**, não do
   back-end. **Não corrigir no back-end.**

9. **F13 — passo que não divide o expediente.** Só acontece com
   `intervalo_min` ∈ {25, 40, 45}; a UI só oferece {15, 20, 30, 60}, todos
   divisores dos expedientes comuns. **Nenhum horário errado é oferecido** —
   só faltam slots no fim do dia. A "grade fixa" é a especificação.
   **Não corrigir; documentar que o passo deve dividir o expediente.**

10. **F18(b) — `iguais` vaza o comprimento.** É inerente ao
    `timingSafeEqual` (que lança em comprimentos diferentes — você **tem** de
    checar antes). O vazamento é sobre `ADMIN_PASSWORD`, um segredo de
    primeiro acesso substituído por hash no primeiro login. **Não corrigir
    essa parte** (corrigir só o `Number.isFinite` do `expiraEm`).

Se esta seção estivesse vazia, a lista de achados estaria inflada. Ela tem
10 itens — a lista está calibrada.

---

## 4. Testes que provariam a correção de cada P0/P1

Sem código — nome + cenário.

### F1 — `slot de agendamento excluído volta a ser reservável`

Criar um agendamento pelo painel às 10:00 num dia futuro. Excluí-lo (soft
delete). Afirmar: (a) `horariosLivres` para aquele barbeiro/dia inclui
"10:00"; (b) um novo `criarAgendamento` no mesmo barbeiro/data/10:00 retorna
`ok: true` (201), **não** 409. **Variante:** com um agendamento _excluído_ às
10:00, reabrir (`cancelado → confirmado`) um outro agendamento cancelado que
estava nesse mesmo horário — deve funcionar, não dar 409.

### F5+F12 — `combinação serviço×profissional inválida não é oferecida`

Cadastrar 1 serviço com 1 profissional vinculado; desativar o profissional.
Afirmar: (a) `GET /api/public` não lista o serviço (ou o lista sem esse
profissional em `barbeiros[]`); (b) `GET /api/horarios?barbeiro=<inativo>&
servico=<que ele fazia>&data=...` retorna 404 (ou `{horarios:[]}`), não uma
grade cheia; (c) `PUT /api/admin/agendamentos` para o mesmo par retorna lista
vazia. **Variante:** profissional ativo mas **não vinculado** ao serviço →
mesma rejeição em `/api/horarios`, sem precisar chegar ao `POST`.

### F19 — `tráfego de um cliente não fecha o agendamento para os outros`

Enviar 6 `POST /api/agendamentos` com corpo inválido dentro da janela. Depois,
um `POST` **válido** ainda cria o agendamento (201). **E:** 6 agendamentos
**válidos** consecutivos da mesma origem → todos os 6 criam (sucesso não
consome cota); o 7º ainda passa se dentro de um limite razoável para uso
legítimo.

### F20 — `login legítimo sobrevive a uma rajada de senhas erradas`

Enviar 8+ `POST /api/admin/login` com senha errada. Em seguida, um `POST` com
a senha **correta** autentica (200 + `Set-Cookie`). O mecanismo de proteção
contra força bruta não pode negar o acesso do dono — deve degradar para
desafio/atraso, não para negação total. (Forma exata depende da decisão
§6.1.)

### F30+F33 — `restauração de backup produz banco íntegro e atual` (runbook, manual)

Com o app rodando e gravando agendamentos, executar o procedimento de backup
documentado. Anotar o último agendamento criado antes do backup. Parar o app.
Restaurar a cópia num diretório limpo, **incluindo apagar `-wal`/`-shm`**.
Subir. Afirmar: (a) o banco abre sem `malformed`; (b) todos os agendamentos
até o instante do backup estão presentes; (c) `npm test` passa contra o banco
restaurado. Repetir uma vez a partir de um backup **pré-migration** para
provar o caminho de rollback.

---

## 5. Ordem de correção — por arquivo, minimizando deploys

Regra: **cada arquivo é tocado uma vez por deploy**; cada deploy é uma
revisão e um risco. Três deploys. O A é o único que bloqueia o
congelamento.

### Pré-requisito (antes do Deploy A)

- Decisões §6.1, §6.2, §6.3, §6.4 tomadas.
- Rede de teste já existe (114 testes verdes). Cada correção abaixo entra com
  seu teste da §4.

### Deploy A — fecha os 5 P1 + carona barata (1 migration, 1 `npm run migrate`, 1 deploy)

| Arquivo                                   | Mudanças                                                                                                                                                                                                                                                        | Achados               |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `src/lib/migrations.js`                   | **Migration 6**: `DROP`/`CREATE` de `idx_ag_sem_duplicidade` com `AND excluido_em IS NULL`; `CREATE INDEX idx_ag_pendentes` parcial; `CREATE INDEX idx_ag_criado` parcial; `idx_ag_data_inicio`; `idx_ag_servico`. Tudo `CREATE INDEX` — sem rebuild de tabela. | **F1**, F28 (índices) |
| `src/lib/db.js`                           | `new Database(DB_PATH, { timeout: 5000 })`; `listarServicos` cruza vínculos com barbeiros ativos (ou a rota faz — decidir 1 lugar).                                                                                                                             | F2, **F5**            |
| `src/lib/agendamentos.js`                 | `tratarErroTransacao` reconhece `SQLITE_BUSY*` → 409/503; `verificarConflito` continua igual; `excluirAgendamento` → `.immediate()` + audit condicionado a `changes>0`; F4 (se decidido: não recotar preço sem troca de serviço).                               | F2, F8, F4            |
| `src/lib/requisicao.js`                   | `lerCorpoJson` com teto de bytes → 413.                                                                                                                                                                                                                         | **F21**               |
| `src/lib/limitador.js`                    | Ajuste da estratégia de chave/contagem conforme §6.1.                                                                                                                                                                                                           | **F19**, **F20**      |
| `src/app/api/agendamentos/route.js`       | Não `registrarTentativa` em sucesso; teto novo; **201** (I-1); mensagem de JSON (I-3); renomear campos de `agendamento` (I-8a); `Retry-After` (I-12).                                                                                                           | **F19**, I-1/3/8a/12  |
| `src/app/api/admin/login/route.js`        | Estratégia §6.1; `Retry-After` (I-12); mensagem de JSON (I-3).                                                                                                                                                                                                  | **F20**, I-3/12       |
| `src/app/api/public/route.js`             | `servicos[].barbeiros` só ativos; filtro `length>0` só ativos.                                                                                                                                                                                                  | **F5**                |
| `src/app/api/horarios/route.js`           | Validar barbeiro existe/ativo/vinculado → 404; alinhar com o PUT (I-13).                                                                                                                                                                                        | **F12**, I-13         |
| `src/app/api/admin/agendamentos/route.js` | PUT valida o par → lista vazia coerente; POST devolve `{ id, agendamento }` (I-2); mensagem de JSON (I-3).                                                                                                                                                      | **F12**, I-2/3        |
| `scripts/migrate.js`                      | Backup do `.db` antes de `aplicarMigrations`; `try/finally`; comentário.                                                                                                                                                                                        | **F33**, F36          |
| _(fora do código)_                        | Script de backup consistente + runbook de restauração + restore testado.                                                                                                                                                                                        | **F30**               |

### Deploy B — endurecimento + contrato (sem migration)

| Arquivo                                                            | Mudanças                                                                                                                                         | Achados               |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| `src/lib/validacao.js`                                             | Esquema `config` (faixas + tetos de texto).                                                                                                      | **F9/F10/F24**        |
| `src/lib/auth.js`                                                  | `exigirSessao` lê `config` 1×; `tokenValido` rejeita `!Number.isFinite(expiraEm)`; Origin exigido em mutação; helper de bump de `sessao_versao`. | F29, F18, F15         |
| `src/lib/log.js` + rotas de rate limit                             | Amostragem do log de bloqueio.                                                                                                                   | **F27**               |
| `src/app/api/admin/config/route.js`                                | Aplica o esquema no PUT; PUT devolve shape do GET (I-11); mensagem JSON (I-3).                                                                   | **F24**, I-3/11       |
| `src/app/api/admin/logout/route.js`                                | Bump de `sessao_versao`.                                                                                                                         | **F15**               |
| `src/app/api/admin/senha/route.js`                                 | Rate limit (§6.9); 401 para senha atual errada (I-5); mensagem JSON (I-3).                                                                       | F16, I-3/5            |
| `src/app/api/admin/sessao/route.js`                                | Sempre 3 campos (I-7); esconder `configuracaoInsegura` (§6.10).                                                                                  | F17, I-7              |
| `src/app/api/admin/resumo/route.js`                                | `geralRealizado`/`geralPrevisto` com limite de data (§6.6); `hoje.total` (§6.5); renomear `total`→`faturamento` nas séries (I-8b).               | **F28**, F6, I-8/14   |
| `src/app/api/admin/health/route.js`                                | Escrita trivial real; `motivo` no 503 (I-6).                                                                                                     | **F32**, I-6          |
| `src/app/api/admin/[recurso]/route.js` + `[recurso]/[id]/route.js` | `try/catch` → 400 com campo (F25); mensagem JSON (I-3); mensagens 404 (I-4); `atropelados: []` (I-10); validar `ativo`.                          | F25, I-3/4/10         |
| `src/lib/db.js`                                                    | `listarBloqueios` com filtro de data.                                                                                                            | F29                   |
| `src/lib/slots.js`                                                 | `diasDisponiveis` com teto interno (reforço da F9).                                                                                              | F9                    |
| `instrumentation.ts` (**novo**)                                    | `getDb()` no boot; falha alta.                                                                                                                   | **F31**               |
| `README.md`                                                        | Backup/restore/rollback; rotação de log; `TRUST_PROXY=1`; não migrar com o app no ar (F34).                                                      | F30/F33/F34/F27 (doc) |

### Deploy C — upload + retenção (envolve decisão de infra)

| Arquivo                                                           | Mudanças                                                                                                         | Achados               |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------- |
| `src/app/api/admin/upload/route.js`                               | `metadata()` antes do `resize` (F22); caminho fora de `public/` (F23); validar `foto`/`imagem`/`logo_url` (F26). | **F22**, **F23**, F26 |
| `src/app/api/imagem/[...]/route.js` (**novo**) ou config do proxy | Servir imagens do volume de dados.                                                                               | **F23**               |
| Migration 7 (se necessária)                                       | Reescrever caminhos `foto`/`imagem`/`logo_url` existentes.                                                       | F23                   |
| Job de retenção (`scripts/` + cron)                               | Poda de `auditoria` (§6.8); limpeza de uploads órfãos.                                                           | F35                   |

**Por que esta ordem minimiza rodadas:** os 5 P1 + os itens baratos que
tocam os mesmos 11 arquivos vão juntos no Deploy A — uma revisão, um
`npm run migrate`, um deploy. Os índices da F28 pegam carona na migration da
F1 (custam milissegundos, são reversíveis), então o Deploy B não toca o
banco. O Deploy C fica isolado porque depende da decisão de onde os uploads
vão morar.

---

## 6. Decisões que dependem de você antes de qualquer patch

### 6.1 — Estratégia de rate limit (bloqueia F19 e F20)

Com `TRUST_PROXY=0`, todos caem na mesma chave. Escolher a combinação:

- **(a)** Exigir `TRUST_PROXY=1` + proxy reverso real em produção (nginx/
  Caddy/Cloudflare) e voltar ao limite por IP. _É a solução mais limpa;
  precisa que você controle o proxy._
- **(b)** CAPTCHA / proof-of-work no formulário de agendamento; login com
  backoff exponencial + desafio após N falhas, em vez de 429 chapado.
- **(c)** Login com passe livre para quem apresenta um cookie de sessão
  anterior (mesmo com `sessao_versao` velha).
  Recomendo **(a) + backoff no login** como mínimo. Qual você adota?

### 6.2 — Mecanismo de backup (bloqueia F30)

`sqlite3 ".backup"` por cron? `VACUUM INTO`? Snapshot de volume do host?
Frequência? **Onde os backups ficam** — outro disco, outra máquina, bucket?
(Backup no mesmo disco não protege contra o disco morrer.)

### 6.3 — Onde os uploads moram (bloqueia F23, define se é código ou config)

Qual o host de produção? Se for Vercel, o SQLite já está errado (README:167).
Se for VPS/Railway/Fly com volume: os uploads vão para o mesmo volume do
banco, servidos por rota do Next, ou por alias do proxy?

### 6.4 — Remarcação recota o preço? (F4)

Mover a data de um agendamento também atualiza o preço para o preço atual do
serviço? Recomendo: **só recotar quando o `servico_id` muda**; manter o
snapshot quando só a data/horário mudam.

### 6.5 — `resumo.hoje.total` conta cancelados? (F6 / I-14)

"N agendamentos hoje" inclui os cancelados do dia (hoje inclui) ou não (a
lista logo abaixo não inclui)? E confirmar a renomeação
`serie[].total` → `faturamento` (I-8) — muda uma chave que o front consome.

### 6.6 — Definição de "faturamento geral" (F28)

`geral.realizado`/`geral.previsto` no resumo hoje somam **todo o histórico**.
Manter assim (e cachear / aceitar a varredura crescente) ou limitar aos
**últimos 24 meses** como a série? Muda um número no painel.

### 6.7 — Timestamps: corrigir na fonte ou converter no front? (F14 / I-9)

`criado_em`/`excluido_em` em UTC. Opção barata: contrato declara UTC, front
converte. Opção limpa: migration grava no fuso da barbearia. Qual?

### 6.8 — Janela de retenção da `auditoria` (F35)

12, 24, 36 meses on-line? Arquivar (export NDJSON) antes de apagar, ou só
apagar? O WhatsApp/endereço do negócio precisam ficar gravados no audit de
`config`, ou basta um marcador ("config alterada: whatsapp")?

### 6.9 — Rate limit no `POST /api/admin/senha`? (F16)

Barato de adicionar; pré-condição já é sessão válida. Adiciona?

### 6.10 — Esconder o aviso de "config insegura" de quem não está logado? (F17)

Trade-off: o operador legítimo perde um sinal na tela (passa a depender do
log). Esconder?

### 6.11 — `intervalo_min` que não divide o expediente (F13)

Só documentar que o passo deve dividir o expediente (recomendado), ou também
adicionar o slot de fim de expediente como candidato em `horariosLivres`?

### 6.12 — Inconsistências de contrato (I-1 a I-14)

O front-end será reescrito e pode se adaptar a algumas. Confirmar quais
entram no back-end (recomendo as de 1 linha: I-1, I-3, I-7, I-10, I-11, I-12,
I-13) e quais o front absorve (I-2, I-8 podem ficar como estão se o custo
incomodar).

### 6.13 — Premissa de escala

A auditoria assumiu ~11k agendamentos/ano (3 profissionais, ~35/dia). Se o
volume real for muito diferente (fusão de unidades, salão de alto fluxo), os
P2 de desempenho (F28) sobem de prioridade. Confere?
