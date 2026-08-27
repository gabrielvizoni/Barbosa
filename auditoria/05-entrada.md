# 05 — Entrada hostil: validação, rotas dinâmicas, upload, limitador

Escopo: `src/lib/validacao.js`, `src/lib/requisicao.js`, `src/lib/limitador.js`,
`src/app/api/admin/upload/route.js`, `src/app/api/admin/[recurso]/route.js`,
`src/app/api/admin/[recurso]/[id]/route.js`, mais os componentes React que
carregam as regras (`Servicos.jsx`, `Produtos.jsx`, `Profissionais.jsx`,
`Configuracoes.jsx`, `Horarios.jsx`, `Agendamentos.jsx`, `base.jsx`,
`FluxoAgendamento.jsx`), `config/route.js`, `agendamentos/route.js`,
`login/route.js`. Base: `auditoria/01-mapa.md`.

Verificação: leitura + `npm test` (114/114) + experimento
(`exp-entrada.mjs`, banco temporário, sessão válida, `next/headers` falso).
Premissa: **o front-end é hostil** — vale só o que a API impõe.

---

## 1. Regra aplicada só no React, aceita cegamente pela API

Grep confirma: **zero `maxLength`/`minLength`/`pattern` em todo o
`src/`** — o front não restringe comprimento em lugar nenhum.

| Regra | Onde no React | O que a API faz | Consequência |
|---|---|---|---|
| `intervalo_min` ∈ {15,20,30,60}; `antecedencia_min` ∈ {0,30,60,120,1440}; `dias_futuros` ∈ {7,15,30,60,90} | `Configuracoes.jsx:234-274` (`<select>` fixo) | `PUT /api/admin/config` grava **qualquer string** (whitelist só por chave, sem faixa) — provado: `intervalo_min:"0"`, `antecedencia_min:"-999"`, `dias_futuros:"999999"` gravam com **200 OK** | **F24**; alimenta F9/F10 da Etapa 3 (agenda pública some com `dias_futuros` negativo; `/api/public` varre 300 mil dias com valor alto) |
| Comprimento de `nome_barbearia`, `slogan`, `endereco`, `instagram`, `logo_url` | nenhum (`Configuracoes.jsx` sem limite) | nenhum limite server-side; `salvarConfig` faz só `String(v ?? "")` — provado: `nome_barbearia` com 200 000 caracteres grava com 200 | **F24** — texto sem teto na tabela `config`, relido em todo `/api/public` e em todo render de página |
| "Serviço precisa de ≥ 1 profissional" | `Servicos.jsx:48-53` | `POST/PATCH [recurso]` para `servicos` chama `definirBarbeirosDoServico(id, corpo.barbeiros)` com o array cru (ou pula se não for array) — cria serviço com **zero** executantes | Serviço sem ninguém; some de `/api/public` (filtro `barbeiros.length > 0`). Não corrompe, mas a regra é só do front |
| `duracao_min` em passos de 5 | `Servicos.jsx:345` (`step="5"`) | `validar` só cobra faixa 5–480; aceita `duracao_min: 7` | Cosmético |
| `confirmacao_automatica` = `"1"`/`"0"` | `Configuracoes.jsx:280` | grava qualquer string; `criarAgendamento` trata `!== "1"` como "pendente" | Cosmético |
| `logo_url`/`foto`/`imagem` = caminho local seguro | React só seta a partir da resposta do upload | `validar` só faz `textoValido(v, { max: 300 })` — aceita qualquer string, inclusive `https://tracker.exemplo/x.gif` ou `javascript:…` | **F26** — renderizado direto como `<img src>` |

**Não** são só do front (a API re-checa, correto): `nome ≥ 2` e
`telefoneValido` no fluxo público (`criarAgendamento`), `cliente_nome ≥ 2` e
campos obrigatórios no encaixe/remarcação, `fim > inicio` na criação de
bloqueio (validador + `CHECK` no banco).

---

## 2. Rotas dinâmicas `[recurso]` e `[recurso]/[id]`

### Nome de recurso fora da lista — **seguro**

`obterRecurso(nome)` = `Object.hasOwn(RECURSOS, nome) ? RECURSOS[nome] : null`.
Provado (`exp-entrada.mjs`):

```
GET /api/admin/xyz          => 404 {"erro":"Cadastro não encontrado."}
GET /api/admin/constructor  => 404 {"erro":"Cadastro não encontrado."}
GET /api/admin/__proto__    => 404 {"erro":"Cadastro não encontrado."}
```

`Object.hasOwn` ignora `constructor`/`toString`/`__proto__` (herdados, não
próprios). E `exigirSessao` roda **antes** de `obterRecurso` (Etapa 4 §4),
então sem cookie qualquer um desses dá 401.

### Mass assignment / colunas não declaradas — **seguro**

`filtrarCampos` itera **só** `recurso.colunas` (`for (const coluna of
recurso.colunas) { if (!(coluna in corpo)) continue; … }`). Provado: um
`POST servicos` com `{ nome:"Corte", id:999, criado_em:"2000-01-01",
senha_hash:"x" }` grava a linha com `id:1` (autoincrement), `criado_em` do
default — `id`/`criado_em`/`senha_hash` do corpo são **descartados**. O
padrão do front de mandar o objeto de estado inteiro (`body: editando` em
`Profissionais.jsx`, `body: novo` em `Agendamentos.jsx`) é neutralizado pela
whitelist.

Ressalva: `corpo.barbeiros` (vínculo serviço↔barbeiro) é lido **fora** de
`filtrarCampos`/`validar` — `definirBarbeirosDoServico` faz `INSERT OR IGNORE`
com `Number(id)`. `OR IGNORE` engole violação de FK e de NOT NULL, então
`barbeiros: [999, "x", -1]` não quebra — só resulta em serviço sem
executantes. Sem corrupção; sem crash.

### Coerção numérica: lixo vira 0 — **F25**

`filtrarCampos`: campo numérico com valor não-vazio e não-booleano →
`Number(valor); if (!Number.isFinite(valor)) valor = 0`. Provado:

```
POST servicos ativo="DROP TABLE", ordem="xx", preco_centavos="abc"
  => 201  linha: { nome:"X", ativo:0, ordem:0, preco_centavos:0 }
```

`ativo` não está em nenhum `ESQUEMAS.campos` → **nunca é validado** → lixo →
`0` (serviço nasce inativo, sem aviso). `ordem` tem `inteiroEntre(0,9999)`,
mas `0` está na faixa → lixo → `0` passa silencioso. `preco_centavos` idem
(`0` é válido). Só `duracao_min`/`estoque`/`preco` **negativos ou fora de
faixa** são pegos pelo validador — o `0` vindo de lixo escapa.

### IDs inválidos — **seguro (mas 500 em vez de 400 num caso)**

`[recurso]/[id]`: `const id = Number(params.id); if (!recurso || !id) → 404`.
`Number("abc")` = `NaN` (falsy) → 404; `Number("0")` = 0 (falsy) → 404. Tudo
depois de `exigirSessao`.

`barbeiro_id` textual num `POST bloqueios` → `filtrarCampos` →
`Number("sou-hostil")` = `NaN` → **`0`** → `INSERT` com `barbeiro_id = 0` →
`FOREIGN KEY constraint failed` (não existe barbeiro id 0). O `INSERT` do
`POST [recurso]` **não está em try/catch** → `comLog` → **500 genérico**.
Provado. O texto cru `"FOREIGN KEY constraint failed"` vai **só para o log**
(NDJSON), nunca para o cliente. Mesmo padrão no `PATCH` parcial de bloqueio
que inverte o intervalo (`{ fim: "09:00" }` com `inicio` = `10:00`): o
validador não pega (parcial, sem `inicio` em `campos`), o `CHECK (fim >
inicio)` do banco pega → 500 genérico, `"CHECK constraint failed: fim >
inicio"` só no log. Recolhido em **F25**.

---

## 3. Limites de tamanho

### Corpo JSON — **sem teto (F21)**

`lerCorpoJson` (`requisicao.js:11-19`): `const texto = await request.text()`
— **sem limite de bytes**. O App Router do Next não aplica o
`bodyParser.sizeLimit` do Pages Router; um `POST` com corpo de 1 GB é
inteiramente bufferizado em `texto`. Nas rotas admin, `exigirSessao` roda
antes (precisa de sessão). Nas públicas:
`POST /api/agendamentos` checa o rate limit **antes** de `lerCorpoJson`, mas
o limite é 6 / 10 min compartilhado por **todo mundo** (TRUST_PROXY=0, §5) →
até 6 corpos gigantes por janela global antes do 429. Ver **F21**.

### Campos de texto

| Fonte | Limite | Onde |
|---|---|---|
| `[recurso]` POST/PATCH — `nome`/`funcao`/`bio`/`descricao`/`categoria`/`marca`/`motivo`/`imagem`/`foto` | 80 / 60 / 500 / 500 / 60 / 60 / 200 / 300 / 300 | `validacao.js` `ESQUEMAS` — **aplicado em POST e PATCH** ✓ |
| `criarAgendamento` público — `cliente_nome` | `.slice(0, 80)` | `agendamentos.js:146-148` ✓ |
| `criarAgendamento` — `observacoes` | `.slice(0, 300)` | `agendamentos.js:172-174` ✓ |
| `criarAgendamento` — `cliente_telefone` | `somenteDigitos` (sem cap) mas `telefoneValido` exige **10–11 dígitos** → um telefone de 1 M de dígitos é 400 | `agendamentos.js:151-160` ✓ na prática |
| `config` — `nome_barbearia`/`slogan`/`endereco`/`instagram`/`logo_url` | **nenhum** | `config/route.js` — **F24** |

Ressalva: as fatias de `cliente_nome`/`observacoes` acontecem **depois** de
receber a string inteira — combinado com F21, um `cliente_nome` de 10 MB é
segurado em memória antes de ser cortado.

### Upload — ver §4

---

## 4. Upload (`src/app/api/admin/upload/route.js`)

| Aspecto | Situação |
|---|---|
| **Limite de bytes** | `TAMANHO_MAXIMO = 5 MB`, checado como `arquivo.size > TAMANHO_MAXIMO` **depois** de `request.formData()` já ter bufferizado o multipart inteiro (undici lê tudo para a memória). Não é limite de streaming — um multipart de 500 MB é bufferizado e só então rejeitado. Depois: `Buffer.from(await arquivo.arrayBuffer())` (cópia) e `sharp(bytes)` (decodifica). Exige sessão. |
| **Magic number** | `detectarExtensao(bytes)` confere assinatura de PNG/JPEG/GIF/WEBP nos primeiros bytes; qualquer outra coisa → 400. Um `.php`/`.svg`/`.html` renomeado para `.jpg` é rejeitado, a menos que também comece com magic de imagem. |
| **Polyglot** | `sharp(bytes).resize().webp().toBuffer()` **re-codifica** — o que não for dado de imagem é destruído. A saída é sempre um WebP limpo. É o `sharp` que sanitiza, mais do que o magic. **Bom.** |
| **Nome do arquivo** | `${crypto.randomUUID()}.webp` — o nome do cliente **nunca é usado**. Sem traversal por filename. |
| **`pasta`** | `PASTAS_VALIDAS.has(pastaEnviada) ? pastaEnviada : "geral"` — whitelist `{logo,barbeiros,servicos,produtos}`. `../../etc` → cai em `"geral"`. `path.join(process.cwd(), "public", "uploads", pasta)`. Sem traversal. |
| **`anterior` (apagar a antiga)** | Só apaga se casar `^/uploads/(logo\|barbeiros\|servicos\|produtos)/[0-9a-f-]{36}\.webp$`. Um `anterior` forjado (`/../../etc/passwd`) não casa → não apaga. Coberto por `tests/upload.test.js`. Nit: `[0-9a-f-]{36}` também casaria 36 traços — mas não existe arquivo assim para apagar. |
| **Onde grava / sobrevive a deploy** | `public/uploads/<pasta>/<uuid>.webp`. `public/uploads` está no `.gitignore`. Em serverless (Vercel) `public/` é somente leitura em runtime → `fs.writeFileSync` **falha** (500 genérico, sem pista de que é disco). Em self-host (PM2/Docker sem volume) grava, mas **some no próximo deploy** — logo e fotos da dona desaparecem. **F23.** |
| **Exaustão de memória via `sharp`** | `sharp`/libvips decodifica a imagem para um buffer de pixels **antes** de redimensionar. O `sharp` tem `limitInputPixels` default ≈ **268 MP** (0x3FFF²) — acima disso ele lança, e o código captura (→ 400). Mas uma imagem logo **abaixo** do limite (ex.: 16000×16000 = 256 MP) → `256M × 4 bytes ≈ 1 GB` de buffer decodificado, **por requisição**. Poucas dessas em paralelo (sessão válida) derrubam uma máquina de 512 MB–1 GB. Sem checagem de dimensão antes do `.resize()`. **F22.** |
| **Sem tratamento de erro de `fs`** | `fs.mkdirSync`/`fs.writeFileSync` sem try/catch — disco cheio ou `public/` somente-leitura → 500 genérico "Algo deu errado", sem dizer que é problema de disco. Menor. |

---

## 5. Limitador com `TRUST_PROXY=0` — negação de serviço trivial

`obterIp(request)` com `TRUST_PROXY !== "1"` devolve **sempre** `"sem-ip"`
(`limitador.js:92-100`). Logo **todas** as requisições públicas caem na mesma
chave: `agendar:sem-ip` e `login:sem-ip`.

### 5.1 Agendamento público — **F19 (P1, argumentável P0)**

`POST /api/agendamentos`: `JANELA_MINUTOS = 10`, `MAXIMO_TENTATIVAS = 6`. E
`registrarTentativa(chave)` é chamado em **toda** requisição que passa o
check, **antes** de `lerCorpoJson`/`criarAgendamento` (`agendamentos/route.js:32`)
— sucesso ou não, corpo válido ou lixo, tudo conta.

**Cenário concreto:** um atacante roda
`curl -X POST https://barbearia.com/api/agendamentos -d '{}'` **6 vezes**.
A partir da 6ª tentativa na janela, `limiteAtingido("agendar:sem-ip", {10, 6})`
é verdadeiro para **qualquer** requisição de **qualquer** cliente → 429
"Muitos agendamentos em pouco tempo.". O atacante repete 6 requisições a cada
10 minutos — **≈ 1 requisição a cada 100 segundos** — e o agendamento público
fica **fechado para todo cliente legítimo, indefinidamente**.

**Custo do ataque:** um laço de shell, de um único IP (o IP não importa —
`obterIp` o ignora), sem autenticação, sem CAPTCHA, sem proxy. Praticamente
zero.

**Impacto:** numa barbearia que recebe dezenas de agendamentos/dia pelo site,
o site para de aceitar reservas. Perde-se agendamento — daí o "argumentável
P0".

### 5.2 Login do admin — **F20 (P1)**

`login/route.js`: por chave `JANELA_MINUTOS = 15`, `MAXIMO_TENTATIVAS = 8`;
global `login:global` 50 / 15 min → trava 60 s re-armando. Com TRUST_PROXY=0,
`login:sem-ip` é compartilhado por todo mundo, e é o limite **menor** (8) que
manda. `registrarTentativa` só roda em **login falho**.

**Cenário concreto:** um atacante roda
`curl -X POST https://barbearia.com/api/admin/login -d '{"senha":"x"}'`
**8 vezes**. `limiteAtingido("login:sem-ip", {15, 8})` passa a ser verdadeiro
→ **a dona não consegue mais logar por 15 minutos** (429 "Muitas
tentativas."). Enquanto bloqueado, cada tentativa do atacante retorna 429
antes de `senhaConfere`, então não registra nova tentativa — mas 8 falhas a
cada 15 min (≈ 1 a cada 110 s) mantêm o bloqueio para sempre.

**Custo:** idêntico ao 5.1 — laço de shell, anônimo.

**Impacto:** a dona fica trancada fora do próprio painel por um atacante
anônimo. Não confirma agendamento, não bloqueia horário, não vê o dia.

### 5.3 Por que é difícil de corrigir só no limitador

O sentido da chave única é: sem `TRUST_PROXY` não há identidade de cliente
confiável. As saídas são de produto/ops, não um ajuste de constante:
- **ops:** exigir `TRUST_PROXY=1` + proxy reverso de verdade em produção,
  para o rate limit voltar a ser por IP;
- **login:** trocar o 429 chapado por backoff exponencial / CAPTCHA após N
  falhas, e/ou dar passe livre a quem apresenta um cookie de sessão anterior
  (mesmo com versão velha);
- **agendamento:** CAPTCHA ou proof-of-work no formulário, e contar por
  agendamento efetivamente criado (com dedupe) em vez de por requisição;
  no mínimo, **não** contar tentativa em sucesso e subir bastante o teto.

---

## 6. Respostas de erro — vazam stack, caminho, SQLite cru, nome de coluna?

| Fonte de erro | O que o cliente recebe | O que vai pro log |
|---|---|---|
| Exceção não tratada em qualquer handler (`comLog`) | `500 {"erro":"Algo deu errado. Tente de novo em instantes."}` | `registrarErro` → NDJSON com **só `error.message`**, nunca o stack (`log.js:22-28`) |
| FK violation (`barbeiro_id: 0` em bloqueio) | `500` genérico (provado) | `"erro":"FOREIGN KEY constraint failed"` — **só no log** |
| CHECK violation (`PATCH` parcial invertendo bloqueio) | `500` genérico (provado) | `"erro":"CHECK constraint failed: fim > inicio"` — **só no log** |
| Constraint em `criarAgendamento` | `409` com mensagem amigável (`tratarErroTransacao` mapeia `SQLITE_CONSTRAINT*`) | — |
| `validar` falhou | `400 {"erro":"duracao_min: precisa estar entre 5 e 480.", "erros": {...}}` | — |
| `sharp` falhou | `400 {"erro":"Não consegui processar essa imagem."}` | — |
| `health` degradado | `503 {"ok":false}` | — |
| Conflito no encaixe/remarcação (painel) | `409` com o **nome do outro cliente** (`"X já atende Fulano das …"`) | — |

**Nenhuma resposta ao cliente traz stack trace, `process.cwd()`, caminho de
arquivo, ou o texto cru do driver.** Erros de SQLite/CHECK/FK viram 500
genérico; o texto cru fica só no NDJSON de stdout. **Bom.**

Duas observações menores:
- `validar` devolve `erros` **com o nome das colunas** (`duracao_min`,
  `preco_centavos`, `estoque`, `ordem`) no corpo — são nomes de campo
  semânticos, não segredo, e o front precisa deles; aceitável.
- O nome do cliente conflitante volta no 409 **do painel** (autenticado) —
  não vaza para o público (o ramo público de `criarAgendamento` passa por
  `horariosLivres` e devolve "Esse horário acabou de ser ocupado", sem nome).

---

## 7. Achados

Formato: `ID | Severidade | Arquivo:linha | O que está errado | Quando quebra | Método de correção | Esforço | Risco de mexer`

### F19 — Rate limit do agendamento público é uma alavanca de negação de serviço trivial e anônima

| Campo | Conteúdo |
|---|---|
| **Severidade** | **P1** (argumentável P0 — "perde agendamento") |
| **Arquivo:linha** | `src/lib/limitador.js:92-100` (`obterIp` → `"sem-ip"` com TRUST_PROXY≠1); `src/app/api/agendamentos/route.js:16-32` (`JANELA_MINUTOS=10`, `MAXIMO_TENTATIVAS=6`, `registrarTentativa` antes da validação e em todo caso) |
| **O que está errado** | Com `TRUST_PROXY=0` (o default do `.env.example`), toda requisição de agendamento cai na chave `agendar:sem-ip`. Bastam 6 `POST` em 10 minutos — de qualquer origem, com qualquer corpo — para o 7º de **qualquer cliente** virar 429. |
| **Quando quebra** | `curl -X POST https://barbearia.com/api/agendamentos -d '{}'` × 6, `sleep 100`, repetir. O agendamento público fica fechado para todo cliente legítimo, indefinidamente, ao custo de um laço de shell. Numa barbearia com dezenas de reservas/dia pelo site, isso é o site parado. Confirmado por leitura do fluxo. |
| **Método de correção** | Curto prazo: (a) não chamar `registrarTentativa` quando `criarAgendamento` teve sucesso; (b) subir muito o teto e encurtar a janela, contando por agendamento **criado** e não por requisição; (c) exigir `TRUST_PROXY=1` + proxy reverso em produção para o limite voltar a ser por IP. Médio prazo: CAPTCHA / proof-of-work no formulário público. |
| **Esforço** | Baixo (a/b/c) a médio (CAPTCHA). |
| **Risco de mexer** | Baixo — `limitador` tem caminho isolado; falta cobertura de teste (o `limitador` não tem arquivo de teste — ver Etapa 1 §6). |

### F20 — 8 logins falhos anônimos trancam a dona fora do painel por 15 min, renovável para sempre

| Campo | Conteúdo |
|---|---|
| **Severidade** | **P1** |
| **Arquivo:linha** | `src/lib/limitador.js:92-100`; `src/app/api/admin/login/route.js:22-24` (`JANELA_MINUTOS=15`, `MAXIMO_TENTATIVAS=8`), `:43-60` (chave `login:sem-ip` com TRUST_PROXY=0) |
| **O que está errado** | Com TRUST_PROXY=0, `login:sem-ip` é a chave de todo mundo, e o teto por chave (8) é menor que o global (50). 8 tentativas falhas em 15 min bloqueiam o `POST /api/admin/login` inteiro. |
| **Quando quebra** | `curl -X POST https://barbearia.com/api/admin/login -d '{"senha":"x"}'` × 8. A dona recebe 429 "Muitas tentativas." e não entra. ≈ 1 tentativa a cada 110 s mantém o bloqueio. Anônimo, sem custo. |
| **Método de correção** | Trocar o 429 chapado por backoff exponencial / desafio (CAPTCHA) após N falhas, em vez de negação total; e/ou dar passe a quem apresenta um cookie de sessão anterior (mesmo com `sessao_versao` velha); e/ou exigir `TRUST_PROXY=1` + proxy em produção. O circuito global (50/15min → 60 s) pode continuar como rede contra rotação de IP, mas não deve ser o único mecanismo. |
| **Esforço** | Baixo a médio. |
| **Risco de mexer** | Médio — mexe no caminho de login; a Etapa 1 do plano original já ajustou muito o limitador. Precisa de teste (hoje inexistente). |

### F21 — Sem limite de tamanho no corpo JSON; caminho público permite corpos gigantes até o 429 global

| Campo | Conteúdo |
|---|---|
| **Severidade** | **P2** |
| **Arquivo:linha** | `src/lib/requisicao.js:11-13` (`await request.text()` sem cap); `src/app/api/agendamentos/route.js:34` |
| **O que está errado** | O App Router não impõe limite de corpo por padrão. `lerCorpoJson` bufferiza tudo em memória. No público, o rate limit deixa passar ~6 requisições por janela global (F19) — cada uma com corpo arbitrariamente grande. |
| **Quando quebra** | 6 `POST /api/agendamentos` concorrentes com corpo de 1 GB → 6 GB bufferizados → OOM numa VM pequena. Menos grave que F19/F20 porque o rate limit tampa em 6, mas 6 concorrentes bastam. |
| **Método de correção** | `lerCorpoJson`: checar `Content-Length` e/ou ler `request.text()` com um teto (ex.: 64 KB para JSON de agendamento/config) e devolver 413 acima disso. Alternativa: `export const maxDuration`/limite no nível do proxy reverso. |
| **Esforço** | Baixo. |
| **Risco de mexer** | Baixo. |

### F22 — `sharp` decodifica imagem até ~268 MP → ~1 GB de RAM por upload

| Campo | Conteúdo |
|---|---|
| **Severidade** | **P2** |
| **Arquivo:linha** | `src/app/api/admin/upload/route.js:110-121` (`sharp(bytes).resize(...)` sem `limitInputPixels` explícito nem checagem de dimensão) |
| **O que está errado** | libvips decodifica a imagem inteira para um buffer de pixels antes de redimensionar. O default `limitInputPixels` do `sharp` (~268 MP) rejeita bombas acima disso, mas uma imagem de 16000×16000 (256 MP, ~1 GB decodificado) passa. Poucas em paralelo → OOM. Requer sessão válida (upload é autenticado). |
| **Quando quebra** | Sessão de admin comprometida ou a própria dona num equipamento compartilhado sobe algumas PNGs de ~16k×16k → 1 GB cada → a máquina cai. O arquivo de entrada pode ter poucos KB (PNG comprime bem áreas lisas). |
| **Método de correção** | Antes do `.resize()`, ler `await sharp(bytes).metadata()` (só o cabeçalho, barato) e rejeitar `width`/`height` acima de um teto (ex.: 6000 px). E/ou passar `sharp(bytes, { limitInputPixels: 40_000_000 })`. Manter o `try/catch` que já existe. |
| **Esforço** | Baixo. |
| **Risco de mexer** | Baixo — coberto por `tests/upload.test.js` (adicionar caso de dimensão excessiva). |

### F23 — Uploads gravam em `public/uploads/` (git-ignored); somem no deploy ou falham em serverless

| Campo | Conteúdo |
|---|---|
| **Severidade** | **P2** |
| **Arquivo:linha** | `src/app/api/admin/upload/route.js:124-126` (`path.join(process.cwd(), "public", "uploads", pasta)` + `fs.writeFileSync`); `.gitignore` (`public/uploads`) |
| **O que está errado** | O código escreve arquivos em runtime dentro de `public/`, que o Next trata como estático de build. Em serverless (Vercel) isso é somente-leitura → `fs.writeFileSync` lança → 500 genérico. Em self-host sem volume persistente, grava mas o diretório é recriado a cada deploy (`git clone`/imagem nova) → logo e fotos da dona desaparecem. |
| **Quando quebra** | Primeiro deploy em Vercel: nenhum upload funciona. Self-host: funciona até o primeiro redeploy, aí a home fica com `<img>` quebrada. |
| **Método de correção** | Definir um diretório de dados fora de `public/` (ex.: `DATA_DIR/uploads`), montá-lo como volume persistente, e servir via uma rota (`GET /api/imagem/[...]`) ou por um alias do proxy reverso. Documentar no runbook que o disco de uploads precisa ser persistente. Amarra com a lista "depois das 9 etapas" do plano ("disco de uploads"). |
| **Esforço** | Médio (rota de serviço de imagem + config de volume). |
| **Risco de mexer** | Médio — muda o caminho de todas as imagens já gravadas; precisa de migração dos `logo_url`/`foto`/`imagem` existentes ou de compatibilidade com o caminho antigo. |

### F24 — `PUT /api/admin/config` não valida nada: números fora de faixa e texto sem teto

| Campo | Conteúdo |
|---|---|
| **Severidade** | **P2** |
| **Arquivo:linha** | `src/app/api/admin/config/route.js:63-78` (whitelist só por chave; `salvarConfig` faz `String(v ?? "")` e grava) |
| **O que está errado** | `intervalo_min`, `antecedencia_min`, `dias_futuros`, `confirmacao_automatica` aceitam qualquer string (provado: `"0"`, `"-999"`, `"999999"` gravam com 200). `nome_barbearia`, `slogan`, `endereco`, `instagram`, `logo_url` não têm limite de comprimento (provado: 200 000 caracteres gravam). Objeto vira `"[object Object]"` (absorvido rio abaixo por `Number(...) || default`, mas suja a tabela). |
| **Quando quebra** | Sobrepõe F9/F10 da Etapa 3 (`dias_futuros` negativo zera a agenda; alto faz `/api/public` varrer 300 mil dias). Novo aqui: um `nome_barbearia` de vários MB infla a tabela `config` e vai em **toda** resposta de `/api/public` e em todo render de página. |
| **Método de correção** | Criar um esquema para `config` em `validacao.js`: `intervalo_min` inteiro 5–120, `antecedencia_min` 0–10080, `dias_futuros` 1–365, `confirmacao_automatica` ∈ {"0","1"}; textos com teto (ex.: `nome_barbearia` 120, `slogan` 300, `endereco` 300, `instagram` 60, `logo_url` 300 + formato de caminho/URL). Aplicar no `PUT` antes de `salvarConfig`. |
| **Esforço** | Baixo. |
| **Risco de mexer** | Baixo. |

### F25 — Números hostis viram 0 em silêncio; entradas malformadas viram 500 em vez de 400

| Campo | Conteúdo |
|---|---|
| **Severidade** | **P3** |
| **Arquivo:linha** | `src/app/api/admin/[recurso]/route.js:65-85` (`filtrarCampos`: lixo numérico → `0`; `ativo` sem validador); `:144-149` (`INSERT` sem try/catch); `src/app/api/admin/[recurso]/[id]/route.js:34` (`validar` sem `criando` não pega `fim <= inicio` em PATCH parcial) |
| **O que está errado** | `ativo`/`ordem` com lixo → `0` gravado sem aviso (serviço nasce inativo). `barbeiro_id` textual → `0` → FK falha → 500 genérico. `PATCH bloqueios` parcial só com `fim` menor que o `inicio` existente → `CHECK` do banco falha → 500 genérico. Nenhum vaza texto cru (só o log recebe), mas o status é errado e, para `ativo`/`ordem`, a linha fica silenciosamente errada. |
| **Quando quebra** | Um front-end com bug (ou hostil) manda `ativo: undefined`/`"on"` → serviço some do site sem erro. Um `PATCH` de bloqueio que só mexe no fim → a dona vê "Algo deu errado" sem entender. |
| **Método de correção** | (a) Dar a `ativo` um validador (`v === 0 || v === 1`) e, em `filtrarCampos`, distinguir "campo ausente" de "lixo" — rejeitar lixo com 400 em vez de coagir para `0`. (b) Envolver os `INSERT`/`UPDATE` de `[recurso]` num try/catch que traduz `SQLITE_CONSTRAINT*` em 400 com mensagem de campo, como `criarAgendamento` já faz. (c) No `validar` de `bloqueios`, quando só um de `inicio`/`fim` vier no PATCH, carregar o outro do registro atual antes do cruzamento `fim > inicio`. |
| **Esforço** | Baixo a médio. |
| **Risco de mexer** | Baixo. |

### F26 — `logo_url`/`foto`/`imagem` aceitam qualquer string; renderizados direto como `<img src>`

| Campo | Conteúdo |
|---|---|
| **Severidade** | **P3** |
| **Arquivo:linha** | `src/lib/validacao.js:58,70,81` (`imagem`/`foto` → só `textoValido(v, { max: 300 })`); `config/route.js` (`logo_url` sem validação); consumo em `Servicos.jsx:167`, `Profissionais.jsx:118`, `base.jsx:213`, header do site |
| **O que está errado** | Não há checagem de que o valor é um caminho local `/uploads/...` ou uma URL http(s). Um `PATCH barbeiros/1 { foto: "https://tracker.exemplo/x.gif" }` grava e passa a carregar um recurso remoto em toda página que mostra o profissional. A CSP `img-src 'self' data: https:` permite qualquer imagem HTTPS. |
| **Quando quebra** | Requer sessão de admin (é o site da própria dona), então o impacto direto é baixo — mas um XSS futuro no painel, ou uma sessão vazada, ganha um canal de exfiltração/tracking via `<img>`, e a home passa a depender de um host de terceiros. |
| **Método de correção** | Validar `logo_url`/`foto`/`imagem` contra `^/uploads/[\w-]+/[0-9a-f-]{36}\.webp$` (caminho de upload nosso) ou string vazia — nada mais. Se um dia precisar aceitar URL externa, exigir `https://` e host em allowlist. |
| **Esforço** | Baixo. |
| **Risco de mexer** | Baixo — mas conferir que nenhum dado real já gravado tem valor fora do padrão antes de apertar a regra. |

---

## 8. O que está correto (para contraste)

- **`obterRecurso`** à prova de prototype pollution (`Object.hasOwn`) —
  `constructor`/`__proto__`/`toString` → 404 (provado).
- **`filtrarCampos`** é whitelist por nome de coluna — `id`, `criado_em`,
  `senha_hash` no corpo são descartados; o padrão de mandar o objeto de
  estado inteiro é seguro (provado).
- **Upload**: nome do arquivo é UUID (nunca do cliente), `pasta` em
  whitelist, `anterior` protegido por regex estrita contra traversal
  (+ teste), magic number + **re-codificação `sharp`** que destrói polyglot.
- **Respostas de erro**: sem stack, sem caminho de arquivo, sem texto cru de
  SQLite/CHECK/FK para o cliente — tudo 500 genérico, detalhe só no NDJSON de
  stdout (provado com FK e CHECK).
- **`validar`** aplica teto de comprimento (80/60/500/300/200) e faixa
  numérica para `servicos`/`produtos`/`barbeiros`/`bloqueios` em **POST e
  PATCH**.
- **`criarAgendamento` público** corta `nome` (80) e `observacoes` (300), e
  `telefoneValido` limita o telefone a 10–11 dígitos.
- O 409 de conflito do fluxo **público** não vaza o nome do outro cliente
  (só o ramo painel, autenticado, o faz).
