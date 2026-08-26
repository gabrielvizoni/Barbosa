# Prompts de correção — The Barbosa

Sequência de 9 etapas, na ordem em que devem ser executadas. Cobre o P0 inteiro e boa parte do P1 — tudo que é resolvível por código.

## Como usar

1. **Uma etapa por sessão.** Contexto limpo a cada uma. Misturar etapas produz diffs grandes demais para revisar, e diff que você não revisa é código que não é seu.
2. **Rode os testes entre etapas.** A partir da Etapa 0 você tem uma rede; use.
3. **Um commit por etapa**, com a mensagem sugerida. Se algo quebrar duas etapas depois, você sabe onde voltar.
4. **Leia o diff inteiro** antes de aceitar. Onde a decisão for não óbvia (transação, constraint, fuso), peça para explicar o porquê e confira se a explicação faz sentido — é isso que você vai defender numa entrevista.
5. Anexe o arquivo `auditoria-the-barbosa.md` ao contexto sempre que a etapa citar um número de item (2.1, 4.5 etc.).

**Ordem não é negociável em três pontos:** a Etapa 0 vem antes de tudo (rede de segurança). A Etapa 2 (constraints) precisa vir antes de o banco ter dados reais. A Etapa 3 depende das constraints da Etapa 2.

---

## Etapa 0 — Rede de segurança: testes e ambiente

> Objetivo: ter como saber se as próximas 8 etapas quebraram algo. Nenhuma linha de código de produção muda aqui, exceto `package.json`.

```
Este projeto é um sistema de agendamento de barbearia em Next.js 14 (App Router) + React 18 + better-sqlite3, sem ORM. Não existe nenhum teste hoje. Vou fazer uma série de correções nos próximos dias e preciso de uma rede de segurança antes.

Crie a infraestrutura de teste e a primeira bateria, usando o runner nativo do Node (`node --test`) — sem Jest, sem Vitest, sem nenhuma dependência nova de teste. O projeto tem a filosofia de dependências mínimas e quero mantê-la.

ESTRUTURA
- Crie `tests/` na raiz.
- Crie `tests/ajuda.js` com um helper que monta um banco SQLite em memória (`:memory:`) aplicando o mesmo schema de `src/lib/db.js`, e permite injetar dados de fixture. Se for preciso refatorar `src/lib/db.js` para permitir isso (ex.: extrair a função `migrate` e aceitar um caminho de banco por parâmetro), faça — mas mantenha o comportamento atual de `getDb()` exatamente igual.
- Adicione em package.json: `"test": "node --test tests/"`, o campo `"engines": { "node": ">=18.17" }`, e crie um `.nvmrc` com a versão maior de Node que você usar.

TESTES A ESCREVER

1. `tests/slots.test.js` — cobrindo `horariosLivres()` de src/lib/slots.js:
   - dia sem expediente devolve lista vazia
   - `fecha <= abre` devolve lista vazia
   - dia livre devolve a grade completa conforme `intervalo_min`
   - agendamento existente remove os horários que colidem, incluindo colisão parcial
   - agendamento que termina fora da grade (ex.: 09:45 com passo de 30min) libera o horário logo em seguida
   - bloqueio com `barbeiro_id IS NULL` afeta todos os profissionais
   - bloqueio com `barbeiro_id` específico só afeta aquele profissional
   - `antecedencia_min` corta os horários de hoje que já passaram do limite
   - serviço com duração maior que o expediente devolve lista vazia

2. `tests/auth.test.js` — cobrindo src/lib/auth.js:
   - cookie com assinatura inválida é rejeitado
   - cookie expirado é rejeitado
   - cookie com `sessao_versao` antiga é rejeitado depois de uma troca de senha
   - `conferirHash` aceita a senha correta e rejeita a errada
   - um cookie assinado com o valor `troque-este-segredo` (o placeholder do .env.example) NÃO deve ser aceito quando NODE_ENV=production
     → este último teste vai FALHAR agora. Deixe-o escrito e marcado com `{ skip: 'corrigir na Etapa 1' }`. Ele é o alvo da próxima etapa.

3. `tests/autorizacao.test.js` — o teste de maior custo-benefício do projeto:
   - percorra a lista de todas as rotas sob `/api/admin/*` (incluindo os métodos que cada uma expõe) e verifique que TODAS respondem 401 sem cookie de sessão válido
   - escreva a lista de rotas de forma explícita no arquivo, para que uma rota nova adicionada no futuro e esquecida fique visivelmente ausente daqui

RESTRIÇÕES
- Não altere nenhuma regra de negócio nesta etapa.
- Se algum teste revelar um bug, NÃO corrija: deixe o teste falhando com um comentário apontando qual item da auditoria ele expõe.
- Ao terminar, rode `npm test` e me mostre exatamente quais passam e quais falham.
```

**Commit:** `Adiciona infraestrutura de teste e primeira bateria`

---

## Etapa 1 — Autenticação e sessão

> Corrige os dois itens críticos. Se o sistema estiver no ar, faça esta etapa hoje.

```
Contexto: sistema de agendamento em Next.js 14 + better-sqlite3, autenticação artesanal em src/lib/auth.js e src/lib/limitador.js. Existe uma bateria de testes em tests/ — rode `npm test` antes e depois.

Corrija as seguintes falhas de autenticação. Todas estão descritas em detalhe nos itens 2.1, 2.2, 2.4 e 4.1 da auditoria em anexo.

1. SEGREDO DE SESSÃO PLACEHOLDER ACEITO (crítico) — src/lib/auth.js:14-16
   `sessaoConfiguradaComSeguranca()` só verifica presença de SESSION_SECRET. O README manda `cp .env.example .env`, e o .env.example traz `SESSION_SECRET=troque-este-segredo`, que está publicado no repositório. Com esse valor, qualquer pessoa forja um cookie de admin.
   Corrija exigindo: valor presente, comprimento mínimo de 32 caracteres, e não pertencente a uma lista de placeholders conhecidos (inclua no mínimo 'troque-este-segredo', 'changeme', 'secret', 'segredo-de-desenvolvimento-troque-em-producao').
   Mantenha o comportamento permissivo quando NODE_ENV !== 'production'.

2. SENHA HARDCODED (crítico) — src/lib/auth.js:73
   `return iguais(texto, process.env.ADMIN_PASSWORD || 'barbosa')` coloca uma senha literal no código público. Remova o literal.
   Se não houver `senha_hash` no banco E `ADMIN_PASSWORD` não estiver definido (ou for um placeholder conhecido, mesma lista do item 1), o login deve ser recusado com 503 e a mesma mensagem de configuração já usada para SESSION_SECRET — nunca aceito.

3. VALIDAÇÃO DE BOOT
   Crie `src/lib/config-ambiente.js` com uma função `verificarAmbiente()` que retorna a lista de problemas de configuração (segredo ausente/fraco, senha inicial ausente/fraca, DATABASE_PATH em diretório não gravável, diretório de uploads não gravável). Chame-a de `getDb()` na primeira inicialização e, em produção, faça o processo falhar alto e claro com a lista de problemas — melhor não subir do que subir inseguro.

4. RATE LIMIT CONTORNÁVEL — src/lib/limitador.js:46-50
   `obterIp()` confia cegamente no primeiro valor de `X-Forwarded-For`, que é enviado pelo cliente. Só use esse header quando a variável de ambiente `TRUST_PROXY=1` estiver definida; caso contrário, use o IP da conexão.
   Adicione também um contador global de falhas de login (chave fixa, ex.: `login:global`) como rede de segurança contra rotação de IP: após 50 falhas em 15 minutos, o login inteiro fica bloqueado por 60 segundos. Isso é aceitável porque só existe um usuário administrativo.

5. scryptSync BLOQUEANDO O EVENT LOOP — src/lib/auth.js:53,60
   `crypto.scryptSync` bloqueia o único thread do Node por ~100ms por tentativa, o que derruba o site inteiro sob carga de login. Troque por `crypto.scrypt` assíncrono (via `promisify`) em `gerarHash` e `conferirHash`, propagando `async` para `senhaConfere`, `trocarSenha` e os handlers que as chamam.
   Grave os parâmetros de custo dentro da string do hash (formato `scrypt$N$r$p$sal$hash`), mantendo compatibilidade de leitura com os hashes no formato antigo `scrypt$sal$hash`, para não invalidar a senha já definida.

6. TRAVA DA SENHA INICIAL SÓ NO FRONTEND — src/app/admin/PainelAdmin.jsx:173
   O README anuncia como medida de segurança que o painel fica travado até a senha ser trocada, mas isso é só um `if` na renderização — a API responde normalmente via curl.
   Implemente no backend: enquanto `usandoSenhaInicial()` for verdadeiro, `exigirSessao()` deve retornar 403 para tudo, exceto `/api/admin/senha`, `/api/admin/sessao` e o GET de `/api/admin/config`. Mantenha a trava visual do frontend como está.

7. COOKIE E CSRF — src/lib/auth.js:99-105
   Troque `sameSite: 'lax'` por `'strict'` no cookie do admin (não existe fluxo de navegação externa para o painel, então nada quebra) e adicione verificação do header `Origin` nos handlers de mutação de `/api/admin/*`, rejeitando origens diferentes da do host.

8. Atualize `.env.example` deixando explícito que os valores são inválidos de propósito e que o boot vai recusar subir com eles.

CRITÉRIOS DE ACEITE
- `npm test` passa, e o teste marcado como skip em tests/auth.test.js ("cookie assinado com o placeholder") deve ser reativado e passar.
- Acrescente testes para: senha rejeitada quando ADMIN_PASSWORD ausente; 403 em rota de admin com senha inicial; rate limit não afetado por X-Forwarded-For forjado quando TRUST_PROXY não está definido.
- Nenhuma mudança de comportamento no fluxo público de agendamento.
```

**Commit:** `Corrige falhas críticas de autenticação e sessão`

---

## Etapa 2 — Banco: constraints, migrations e seed

> Precisa acontecer **antes** de o banco ter dados reais. SQLite não permite adicionar `CHECK` com `ALTER TABLE`.

```
Contexto: schema em src/lib/db.js, SQLite via better-sqlite3. O banco será entregue vazio ao cliente e ainda não tem dados de produção — este é o momento de mexer na estrutura.

1. CONSTRAINTS DE INTEGRIDADE (item 5 da auditoria)
   O banco hoje não tem um único CHECK. Aceita `duracao_min = -30`, `preco_centavos = -5000`, `status = 'qualquer_coisa'`, `data = 'amanhã'`, `inicio = '99:99'`.
   Adicione:
   - agendamentos.status: CHECK IN ('pendente','confirmado','concluido','cancelado')
   - duracao_min: CHECK BETWEEN 5 AND 480 (em servicos e agendamentos)
   - preco_centavos: CHECK >= 0 (em servicos, produtos e agendamentos)
   - produtos.estoque: CHECK >= 0
   - data (agendamentos, bloqueios): CHECK com GLOB de formato AAAA-MM-DD
   - inicio/fim (agendamentos, bloqueios): CHECK com GLOB de formato HH:MM, e CHECK (fim > inicio)
   - expediente.dia: CHECK BETWEEN 0 AND 6
   - expediente.abre/fecha: GLOB HH:MM e CHECK (fecha > abre)
   Como SQLite não permite ALTER TABLE ADD CONSTRAINT, use o procedimento oficial: criar tabela nova, copiar dados, dropar a antiga, renomear — tudo dentro de uma transação, com `PRAGMA foreign_keys` desligado durante a operação e religado depois.

2. PREVENÇÃO DE AGENDAMENTO DUPLICADO
   Adicione um índice parcial único: UNIQUE(barbeiro_id, data, inicio) WHERE status <> 'cancelado'.
   Não cobre sobreposição parcial (isso fica na lógica da aplicação, Etapa 3), mas cobre a colisão exata, que é o caso comum.

3. MIGRATIONS VERSIONADAS (item 5)
   Hoje `garantirColuna()` é ad hoc, as migrations rodam dentro de `getDb()` — ou seja, no primeiro request HTTP — e não há registro de o que já rodou.
   Substitua por: tabela `schema_version(versao INTEGER NOT NULL)`, um array ordenado de migrations numeradas em `src/lib/migrations.js`, e um script `npm run migrate` que as aplica.
   `getDb()` passa a apenas VERIFICAR se a versão do arquivo bate com a esperada, e a recusar-se a subir se não bater, com mensagem clara mandando rodar a migration.
   Preserve a migration existente que adiciona a coluna `imagem` em servicos e produtos, como migration numerada.

4. REMOÇÃO DO SEED DE DADOS DO CLIENTE ATUAL (item 2.10)
   src/lib/db.js:149-166 insere os barbeiros 'Heitor Lampa' e 'Ana Donegá' em qualquer banco vazio, e db.js:121 define um endereço de Maringá como padrão. Isso contradiz a premissa de entregar o banco zerado a um novo cliente.
   Remova o seed de barbeiros por completo. Troque o endereço, o nome da barbearia e o slogan padrão por strings vazias.
   Mantenha o seed de `expediente` e das chaves de configuração operacional (intervalo_min, antecedencia_min, dias_futuros, confirmacao_automatica, sessao_versao) — esses são defaults legítimos.

5. LIMPEZA DO LIMITADOR — src/lib/limitador.js:13
   O DELETE de registros antigos roda a cada verificação, ou seja, em toda tentativa de login e todo agendamento público. Faça rodar de forma amostrada (1 em cada 100 chamadas) ou por intervalo de tempo, em vez de sempre.

CRITÉRIOS DE ACEITE
- `npm test` continua passando.
- Adicione testes verificando que o banco REJEITA: status inválido, duracao_min = 0, preco negativo, data em formato errado, fim <= inicio, e o segundo agendamento no mesmo (barbeiro, data, inicio).
- Adicione um teste que cria um banco do zero e verifica que ele contém ZERO barbeiros, ZERO serviços e ZERO produtos.
- Apague seu data/barbosa.db local e confirme que a aplicação sobe limpa.
```

**Commit:** `Adiciona constraints, migrations versionadas e remove seed do cliente`

---

## Etapa 3 — Lógica de negócio: validação, estados e atomicidade

> A etapa mais densa. Se preferir dividir, quebre entre os itens 1-2 e 3-5.

```
Contexto: Next.js 14 App Router, rotas em src/app/api/. A criação de agendamento existe duplicada em dois fluxos com regras divergentes: público (src/app/api/agendamentos/route.js) e painel (src/app/api/admin/agendamentos/route.js). Não há camada de validação nem máquina de estados. Itens 2.5, 2.6, 3 e 4.6 da auditoria em anexo.

1. CAMADA DE VALIDAÇÃO — sem dependências novas
   Crie `src/lib/validacao.js` com esquemas por recurso e uma função `validar(recurso, campos)` que devolve `{ ok, erros }`.
   `filtrarCampos()` em src/app/api/admin/[recurso]/route.js hoje faz whitelist de coluna e coerção de tipo, mas não valida faixa nem formato de nada. Consequência real: `duracao_min = 0` é aceito, o agendamento fica com `fim === inicio`, e a checagem de conflito (`inicio < f && fim > i`) nunca dispara — permitindo infinitos agendamentos no mesmo minuto.
   Faixas: duracao_min 5–480, preco_centavos 0–10.000.000, ordem 0–9999, estoque >= 0, data no formato AAAA-MM-DD com parse real, inicio/fim HH:MM com fim > inicio, textos com limite de comprimento.
   Aplique tanto no POST quanto no PATCH de `/api/admin/[recurso]` — hoje o POST valida `fim > inicio` para bloqueios e o PATCH não valida nada.
   Valide também `fecha > abre` no PUT de /api/admin/config, que hoje só checa o formato HH:MM: salvar 20:00→09:00 faz a agenda daquele dia ficar vazia sem nenhum erro visível.

2. UNIFICAR A CRIAÇÃO DE AGENDAMENTO
   Extraia `src/lib/agendamentos.js` com uma função única `criarAgendamento({ origem: 'publico' | 'painel', ... })` contendo validação, checagem de conflito e insert.
   As diferenças legítimas entre os fluxos viram parâmetros, não código separado:
   - público respeita expediente e antecedência mínima (via horariosLivres); painel permite encaixe fora do expediente, mas nunca sobre outro atendimento ou bloqueio
   - status inicial: público segue `confirmacao_automatica`; painel entra como 'confirmado'
   Unifique a validação de telefone, que hoje diverge: o público exige 10–11 dígitos, o painel aceita qualquer coisa inclusive vazio. Escolha: obrigatório com 10–11 dígitos no público, opcional mas validado quando presente no painel.
   Os dois route handlers viram cascas finas chamando essa função.

3. ATOMICIDADE REAL
   Hoje a reserva não quebra apenas porque não existe `await` entre `horariosLivres()` e o INSERT e better-sqlite3 é síncrono — é uma garantia acidental de runtime, que some com múltiplos processos ou com um `await` inserido numa manutenção futura.
   Envolva checagem + insert em `conn.transaction(...)` executada com `.immediate()` (BEGIN IMMEDIATE, para pegar o write lock antes de ler). Trate a violação do índice único adicionado na Etapa 2 como conflito, devolvendo 409 com a mesma mensagem amigável já usada hoje.

4. MÁQUINA DE ESTADOS DE STATUS — src/app/api/admin/agendamentos/[id]/route.js:18-22
   O endpoint aceita qualquer transição. Cenário real que quebra: cliente cancela → o horário volta a ser oferecido → outro cliente marca → o barbeiro clica em "Confirmar" na linha do cancelado (a UI oferece esse botão) → dois agendamentos confirmados no mesmo horário, sem aviso.
   Implemente as transições legais: pendente→confirmado|cancelado; confirmado→concluido|cancelado; concluido→(nenhuma); cancelado→pendente|confirmado APENAS se o horário ainda estiver livre, revalidado dentro da mesma transação.
   Bloqueie marcar como 'concluido' um agendamento com data futura.
   Ajuste src/components/admin/Agendamentos.jsx para só oferecer os botões das transições legais — mas a regra mora no backend.

5. REMARCAÇÃO DE AGENDAMENTO (item 4.6)
   Hoje só existe mutação de status. Remarcar obriga o barbeiro a excluir (irreversível) e recriar.
   Estenda o PATCH de /api/admin/agendamentos/[id] para aceitar `data`, `inicio`, `barbeiro_id` e `servico_id`, reaproveitando a mesma validação de conflito e a mesma transação da criação. Atualize os campos derivados (fim, duracao_min, preco_centavos, barbeiro_nome, servico_nome) conforme a política de snapshot já existente.
   Adicione o botão de remarcar na tela de Agendamentos.

CRITÉRIOS DE ACEITE
- `npm test` passa.
- Novos testes: duracao_min = 0 rejeitado na criação de serviço; dois agendamentos concorrentes no mesmo horário → um 201 e um 409; transição concluido→pendente rejeitada; reabertura de cancelado cujo horário já foi ocupado rejeitada; remarcação para horário ocupado rejeitada.
- Os dois fluxos de criação passam pela mesma função — não deve sobrar lógica de conflito duplicada.
```

**Commit:** `Unifica criação de agendamento, adiciona validação e máquina de estados`

---

## Etapa 4 — Fuso horário e bugs de data

> Pequena, isolada, e corrige três bugs visíveis ao usuário.

```
Contexto: o backend calcula datas corretamente no fuso da barbearia (src/lib/slots.js:19-37, usando Intl.DateTimeFormat com a env TZ). O frontend NÃO usa isso: existem cinco cópias de `new Date().toISOString().slice(0,10)`, que devolve a data em UTC. Item 2.9 da auditoria.

Ocorrências:
- src/components/admin/Horarios.jsx:11 (`hoje()`)
- src/components/admin/base.jsx:138 (`hojeChave()`)
- src/components/admin/AgendaVisual.jsx:32 e :73
- src/components/admin/Financeiro.jsx:24 (`mesAtual()`)
- src/app/agendar/FluxoAgendamento.jsx:39 (`hojeISO()`)

Efeitos concretos em UTC-3, a partir das 21:00:
- Horarios.jsx é o pior caso: `BLOQUEIO_VAZIO` (linha 26-32) mistura `hoje()` em UTC com `agoraArredondado()` (linha 14) em hora LOCAL. Às 21:30 de terça, o botão "Saí por 1 hora" cria um bloqueio das 21:30 às 22:30 de QUARTA. O barbeiro sai achando que fechou a agenda; ela continua aberta.
- AgendaVisual: depois das 21:00, "Agenda do dia" abre no dia seguinte.
- Financeiro: no último dia do mês, depois das 21:00, o painel pula para o mês seguinte e mostra R$ 0,00.

TAREFAS
1. Exponha o fuso configurado (env TZ) na resposta de /api/public e num novo campo do GET de /api/admin/config.
2. Crie `src/lib/datas-cliente.js` com `hojeLocal(fuso)` e `mesAtualLocal(fuso)` usando Intl.DateTimeFormat, espelhando a lógica de `agora()` em src/lib/slots.js. Não duplique a lógica de formatação de rótulos que já existe.
3. Substitua as cinco ocorrências. Onde o componente não tiver acesso ao fuso, propague-o por props ou por um contexto React simples.
4. `BLOQUEIO_VAZIO` em Horarios.jsx:26 é uma constante de módulo, avaliada uma única vez no carregamento do JS — um painel deixado aberto o dia inteiro (o normal numa barbearia) pré-preenche o formulário com a data e a hora de quando a aba foi aberta. Transforme em função `bloqueioVazio()`, chamada no momento de abrir o modal.
5. Bug independente: src/app/admin/PainelAdmin.jsx:206 testa `id === 'agendamentos'`, mas o id da seção definido na linha 29 é `'agenda'`. O contador de pendentes é calculado, transmitido e nunca renderizado. Corrija.

CRITÉRIOS DE ACEITE
- Adicione um teste que rode com TZ=UTC e outro com TZ=America/Sao_Paulo verificando que `hojeLocal` devolve a data correta do fuso da barbearia, incluindo o horário de virada.
- Verifique manualmente, ajustando o relógio do sistema para 21:30, que "Saí por 1 hora" cria o bloqueio no dia certo.
```

**Commit:** `Unifica cálculo de datas no fuso da barbearia e corrige badge de pendentes`

---

## Etapa 5 — White-label: remover a marca do código

```
Contexto: existe um campo `nome_barbearia` em Configurações, usado apenas no rodapé e no link de WhatsApp do cliente. Em todo o resto, "The Barbosa" está escrito no código. Item 2.10 da auditoria.

Ocorrências a eliminar:
- src/app/layout.jsx:4-6 (title e description)
- src/app/page.jsx:64 (prop `nome` do Header) e :312 (marca do rodapé)
- src/app/admin/page.jsx:4 (title)
- src/app/admin/PainelAdmin.jsx:124, :144, :182 (cabeçalhos do painel)
- src/app/agendar/page.jsx:11 (title) e :20 (prop `nome`)
- src/components/admin/Agendamentos.jsx:152 — o mais visível para o cliente final: a mensagem de confirmação enviada por WhatsApp diz "na The Barbosa" literalmente, e também assume o prefixo 55 fixo no número

TAREFAS
1. Substitua os títulos estáticos por `generateMetadata()` do Next lendo `lerConfig()`. Use um fallback neutro ("Agendamento online") quando o nome não estiver preenchido — nunca o nome de um cliente específico.
2. Os componentes de painel são client components e não podem ler o banco: exponha o nome via /api/admin/config (já existe) e propague. Evite prop drilling profundo — um contexto React simples resolve.
3. Na mensagem de WhatsApp de Agendamentos.jsx:152, use o nome vindo de config. Extraia essa montagem de mensagem para src/lib/format.js, junto de `linkWhatsapp`, que já faz algo equivalente para o lado do cliente — hoje existem duas construções de mensagem quase iguais em lugares diferentes.
4. Trate o caso de configuração vazia: com o banco zerado (Etapa 2), o site precisa renderizar de forma digna sem nome, sem endereço, sem slogan e sem logo. Confira cada tela.

CRITÉRIOS DE ACEITE
- `grep -ri "barbosa" src/` não deve retornar nada além do nome do pacote em package.json e de eventuais comentários.
- Suba a aplicação com o banco vazio e navegue por home, /agendar e /admin sem nenhum texto quebrado ou placeholder feio.
```

**Commit:** `Remove marca hardcoded; identidade passa a vir das configurações`

---

## Etapa 6 — Observabilidade e headers de segurança

```
Contexto: o projeto não tem UMA ÚNICA chamada de log — varredura confirma zero `console.*` e nenhuma biblioteca. Além disso, há ~20 blocos catch e vários engolem erro silenciosamente. Se um comprometimento acontecer, é indetectável; se o cliente reclamar de um erro de ontem, não há o que consultar. Itens A3 e A5 da auditoria.

1. LOGGING ESTRUTURADO — sem dependências novas
   Crie `src/lib/log.js` escrevendo NDJSON em stdout: `{ ts, nivel, rota, msg, erro }`.
   Registre: login bem-sucedido, login falho, bloqueio por rate limit, toda mutação de agendamento (criação, status, remarcação, exclusão), toda exceção não tratada nos handlers.
   NUNCA logue PII: nada de telefone ou nome de cliente. Use o id do agendamento.
   Envolva cada route handler num try/catch que loga o erro real e devolve resposta genérica ao cliente — o comportamento atual de não vazar stack trace está correto e deve ser mantido.

2. CATCHES SILENCIOSOS
   `await request.json().catch(() => ({}))` aparece em 6 handlers: um corpo malformado vira `{}` e segue como requisição válida vazia, produzindo "Nada para salvar" em vez de "JSON inválido". Devolva 400 com mensagem correta.
   No frontend, `.catch(() => {})` em src/components/admin/Agendamentos.jsx:58-59 e src/app/admin/PainelAdmin.jsx:82 deixa a tela silenciosamente incompleta. Faça-os avisar o usuário.

3. HEALTH CHECK
   Crie `GET /api/health` (público, sem dados sensíveis) verificando `SELECT 1` no banco e a gravabilidade do diretório de uploads. Devolva 200 ou 503.

4. HEADERS DE SEGURANÇA — src/next.config.mjs não define nenhum
   Adicione via `headers()`: X-Frame-Options DENY (o /admin é clickjackável hoje), X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin, Strict-Transport-Security, e uma Content-Security-Policy.
   A CSP precisa acomodar os estilos inline do Next e as fontes do Google — teste em modo produção (`npm run build && npm start`) e ajuste até o site e o painel funcionarem sem erro no console. Não aceite uma CSP que só funciona em dev.

CRITÉRIOS DE ACEITE
- `npm test` passa.
- Teste que uma tentativa de login falha gera uma linha de log e que essa linha não contém a senha.
- `curl -I` na home mostra todos os headers.
- Build de produção sem violação de CSP no console.
```

**Commit:** `Adiciona logging estruturado, health check e headers de segurança`

---

## Etapa 7 — Financeiro correto e eficiente

```
Contexto: src/app/api/admin/resumo/route.js. Itens 2.8 e 9 da auditoria.

1. AGRUPAMENTO POR NOME QUEBRA OS RELATÓRIOS — linhas 158 e 168
   Os relatórios usam `GROUP BY servico_nome` e `GROUP BY barbeiro_nome`. Esses campos são snapshots congelados no momento do agendamento (a decisão de guardá-los está certa e deve ser mantida), mas usá-los como chave de agrupamento significa que corrigir "Ana" para "Ana Donegá" no cadastro faz o Financeiro exibir DUAS profissionais, com o faturamento partido em dois. Dois serviços de nomes iguais são somados como um.
   Troque para `GROUP BY barbeiro_id` / `servico_id` com LEFT JOIN nas tabelas de cadastro, exibindo o nome ATUAL, e `COALESCE(b.nome, a.barbeiro_nome)` para cobrir registro apagado.

2. 24 QUERIES SEQUENCIAIS — linhas 143-148
   `serie` e `serieAnoAnterior` fazem uma query SUM() por mês, 24 no total. Como better-sqlite3 é síncrono, elas bloqueiam o event loop em sequência — durante isso, nenhum cliente carrega o site.
   Substitua por uma única query agregada por mês com `GROUP BY substr(data,1,7)`, mantendo o filtro `data >= ? AND data < ?` no WHERE para preservar o uso do índice. Preencha com zero os meses sem movimento, em JS.

3. ENDPOINT DEDICADO PARA O CONTADOR
   src/app/admin/PainelAdmin.jsx:79-87 chama /api/admin/resumo INTEIRO — ~30 queries — a cada troca de seção, apenas para ler `pendentesTotal` e preencher um badge.
   Crie `GET /api/admin/pendentes` com uma query só e use-o ali.

4. INCONSISTÊNCIA DE DEFINIÇÃO
   O gráfico de 12 meses soma tudo que não está cancelado (previsto + realizado), enquanto os cartões de KPI separam "realizado" (concluído) de "previsto" (pendente + confirmado). O mesmo mês exibe números diferentes em dois lugares da mesma tela.
   Padronize: devolva as duas séries separadas e deixe o gráfico distingui-las visualmente, ou rotule o gráfico de forma inequívoca. Documente a escolha em comentário.

5. PAGINAÇÃO — src/app/api/admin/agendamentos/route.js:39
   `LIMIT 300` fixo, sem paginação e sem informar ao frontend que houve truncamento: em cerca de um ano a lista para de mostrar os registros mais antigos, silenciosamente. Adicione paginação por cursor ou offset e indique o total.

CRITÉRIOS DE ACEITE
- Teste: dois agendamentos do mesmo barbeiro, renomeando o barbeiro entre eles, devem aparecer como UMA linha no relatório.
- Teste: os totais mensais da série batem com a soma dos cartões, para a mesma definição.
```

**Commit:** `Corrige agrupamento dos relatórios e reduz custo do resumo`

---

## Etapa 8 — Preservação de dados: soft delete e auditoria

```
Contexto: src/app/api/admin/agendamentos/[id]/route.js:39 executa `DELETE FROM agendamentos WHERE id = ?`, definitivo, atrás de um confirm() nativo. O Financeiro é derivado 100% dessa tabela, e o painel tem uma senha compartilhada por toda a equipe — não há como saber quem apagou o quê. Itens 2.7 e 4.2 da auditoria.

1. SOFT DELETE
   Adicione `excluido_em TEXT` em agendamentos (migration numerada, conforme o esquema da Etapa 2) e filtre em todas as leituras, incluindo horariosLivres, relatórios e listagens.

2. AUDITORIA
   Crie `auditoria(id, acao, tabela, registro_id, antes, depois, criado_em)`, gravada na MESMA transação da mutação.
   Registre no mínimo: criação, mudança de status, remarcação e exclusão de agendamento; alteração de preço de serviço; troca de senha; alteração de configuração.
   Não grave telefone nem nome de cliente nos campos antes/depois — use o id.

3. CONFIRMAÇÃO PROPORCIONAL AO RISCO
   Substitua o `confirm()` nativo (feio e inconsistente com o design system) por um modal do próprio sistema. Para exclusão de agendamento, exija digitar o nome do cliente — a fricção é proposital.
   O botão "Fechar o resto do dia" (src/components/admin/Horarios.jsx:98) é a ação mais destrutiva do painel e é a ÚNICA sem nenhuma confirmação: um clique fecha a agenda de toda a equipe. Adicione confirmação.

4. BLOQUEIO CIENTE DOS AGENDAMENTOS EXISTENTES (item 4.2)
   Ao criar um bloqueio, conte quantos agendamentos ele atropela e devolva isso na resposta. O painel mostra: "Bloqueado. Atenção: 3 clientes já marcados nesse intervalo" com os links de WhatsApp prontos para avisá-los.
   Hoje existe apenas um aviso em texto estático no modal — e os atalhos "Saí por 1 hora" / "Fechar o resto do dia", que são os usados sob pressão, não mostram aviso nenhum.

CRITÉRIOS DE ACEITE
- Teste: agendamento excluído não aparece em listagens nem em relatórios, mas continua no banco.
- Teste: toda mutação de agendamento gera exatamente uma linha em auditoria.
- Teste: criar bloqueio sobre 2 agendamentos devolve a contagem 2.
```

**Commit:** `Substitui exclusão física por soft delete e adiciona auditoria`

---

## Etapa 9 — Acessibilidade, UX e upload

> A única etapa que adiciona uma dependência (`sharp`). Vale.

```
Contexto: itens 7, 8 e M5 da auditoria em anexo.

1. MODAL SEM FOCUS TRAP — src/components/admin/base.jsx:26-46
   Tem role="dialog" e aria-modal (correto), mas não prende o foco, não fecha com Escape e não devolve o foco ao elemento de origem. Para um usuário de teclado é o defeito mais grave da interface. Corrija os três.

2. SELETORES CUSTOMIZADOS — src/components/admin/base.jsx:168-297 e :304-383
   `SeletorData` e `SeletorLista` reimplementam controles nativos sem semântica nem teclado: faltam role="listbox"/"option"/"grid", aria-expanded, aria-activedescendant; setas não navegam, Escape não fecha, digitar letra não pula para a opção.
   Some-se a isso uma inconsistência: dentro do modal de encaixe, Data usa o seletor customizado enquanto Serviço e Profissional usam <select> nativo; no modal de bloqueio, Data usa <input type="date"> nativo. São três padrões para a mesma classe de controle, em telas adjacentes.
   Escolha UM caminho e aplique inteiro:
   (a) completar os customizados — teclado, ARIA, alvos de toque de no mínimo 44px (as setas de mês têm 13px hoje) — e usá-los em 100% dos casos; ou
   (b) voltar ao nativo onde ele funciona, mantendo o customizado só onde comprovadamente quebra (dentro de modal com overflow hidden).
   Recomende qual e justifique antes de implementar.

3. ENCAIXE OFERECE COMBINAÇÃO INVÁLIDA — src/components/admin/Agendamentos.jsx:374-386
   O select lista todos os barbeiros ativos, independente de quem executa o serviço escolhido. O backend rejeita depois do formulário todo preenchido, e o PUT de horários ainda devolve slots para o par inválido. Filtre pela lista `barbeiros` que já vem em `listarServicos`.

4. DUAS AÇÕES DE SALVAR NA MESMA TELA — src/components/admin/Configuracoes.jsx:224 e :273
   "Salvar configurações" e "Trocar senha" são independentes e nada indica isso: o usuário preenche a senha nova, clica em "Salvar configurações", lê "Configurações salvas" e acha que trocou a senha. Não trocou. Separe em abas ou deixe explícito.
   Adicione também indicação de alterações não salvas ao sair de uma seção editada — hoje editar o expediente e trocar de tela descarta tudo em silêncio.

5. ONBOARDING — src/components/admin/VisaoGeral.jsx
   No primeiro acesso, nada explica que SEM CADASTRAR SERVIÇOS o site não aceita agendamento — a informação mais importante do dia 1 está só no README, que o cliente não lê.
   Adicione um checklist de primeiros passos, com estado de conclusão: definir senha própria, preencher nome e WhatsApp, cadastrar profissionais, cadastrar serviços e vincular quem executa cada um, conferir o expediente. Some quando concluído.

6. IMAGENS SEM OTIMIZAÇÃO — src/app/api/admin/upload/route.js
   Uploads de até 5 MB são gravados crus e servidos com <img> sem width/height, sem lazy loading e sem redimensionamento. O dono vai subir a foto direto da câmera do celular; em 4G a home fica inutilizável. É o problema de performance mais impactante do projeto.
   Adicione `sharp`: redimensione para no máximo 700px de largura, converta para WebP com qualidade 80, preserve a validação por magic number que já existe (ela está correta).
   Apague a imagem anterior ao substituir — hoje as órfãs ficam no disco para sempre.
   Adicione width/height e loading="lazy" em todas as tags <img> do projeto.

CRITÉRIOS DE ACEITE
- Navegue o painel inteiro apenas com teclado: Tab, Shift+Tab, Enter, Escape, setas. Todo controle precisa ser alcançável e operável.
- Uma foto de 4 MB deve virar um arquivo abaixo de 150 KB.
```

**Commit:** `Melhora acessibilidade, corrige inconsistências de UX e otimiza uploads`

---

## Depois das 9 etapas

O que **não** sai por prompt e continua na sua mão:

- **Backup com restore testado** — o script pode ser gerado, mas o valor está em restaurar num banco de verdade e conferir que voltou.
- **HTTPS, volume persistente, `NODE_ENV=production`, disco de uploads** — acesso ao servidor.
- **Uptime check externo** — 5 minutos no UptimeRobot.
- **Manual do cliente em PDF** — pode ser rascunhado por prompt, mas quem sabe o que o cliente não entende é você.
- **Consentimento LGPD e política de privacidade** — o texto é gerável; a decisão sobre retenção e sobre quem é controlador não é.
- **Papéis de usuário, confirmação por SMS/WhatsApp, almoço no expediente** — decisões de produto e de custo.

Rode a auditoria de novo depois da Etapa 9, com o código atualizado, e compare. É a forma mais honesta de medir se as correções pegaram.
