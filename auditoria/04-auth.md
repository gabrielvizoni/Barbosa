# 04 — Autenticação, sessão, CSRF e headers

Escopo: `src/lib/auth.js`, `src/middleware.js`, e todas as rotas em
`src/app/api/admin/**` (`[recurso]`, `[recurso]/[id]`, `agendamentos`,
`agendamentos/[id]`, `config`, `login`, `logout`, `senha`, `sessao`,
`upload`, `pendentes`, `resumo`). Base: `auditoria/01-mapa.md`.

Verificação: leitura + `npm test` (114/114 — inclui `auth.test.js` 11,
`autorizacao.test.js` 21, `log-login.test.js` 2) + dois experimentos rodados
nesta etapa (`exp-auth.mjs`, `exp-auth2.mjs`; banco temporário, `next/headers`
falso).

---

## 1. Cookie de sessão

`criarSessao()` — `src/lib/auth.js:196-208`:

| Atributo   | Valor                                   | Fonte                             |
| ---------- | --------------------------------------- | --------------------------------- |
| Nome       | `admin_sessao`                          | `auth.js:9`                       |
| `HttpOnly` | **sim**                                 | `auth.js:200`                     |
| `SameSite` | **`Strict`**                            | `auth.js:203`                     |
| `Secure`   | `process.env.NODE_ENV === "production"` | `auth.js:204`                     |
| `Path`     | `/`                                     | `auth.js:205`                     |
| `Max-Age`  | `43200` (12 h)                          | `auth.js:206`, `DURACAO_SEGUNDOS` |
| `Domain`   | não definido → host exato               | —                                 |

**HTTP local (dev):** `NODE_ENV !== "production"` → `Secure` **desligado**, para
o cookie funcionar em `http://localhost`. `HttpOnly` e `SameSite=Strict`
continuam valendo.

**HTTPS produção:** `Secure` **ligado** → o navegador só manda o cookie por
TLS. `Secure` está amarrado a `NODE_ENV`, não ao protocolo da requisição —
atrás de um proxy que termina o TLS e fala HTTP com o app, contanto que
`NODE_ENV=production`, o atributo sai certo. Se o site for servido em HTTP
puro em produção por engano, o cookie é marcado `Secure` e o navegador não o
devolve → o painel simplesmente não autentica (falha para o lado seguro).

`encerrarSessao()` (`auth.js:210-212`) apaga o cookie com só `{ path: "/",
maxAge: 0 }` — sem `HttpOnly`/`Secure`/`SameSite`. Irrelevante para um cookie
de deleção (o navegador casa por nome+path). **Ponto importante: o logout é
100 % client-side** — ver §2 e **F15**.

Veredito: atributos **corretos**. Sem finding aqui.

---

## 2. Assinatura HMAC e versão de sessão

Formato do token (`construirToken`, `auth.js:188-191`):

```
admin.<versao>.<expiraEm>.<HMAC_SHA256(SESSION_SECRET, "admin.<versao>.<expiraEm>")>
```

`tokenValido(token)` — `auth.js:215-229`:

1. `token.split(".")` tem de ter **4 partes**.
2. `iguais(assinatura, assinar(carga))` — comparação **timing-safe** do HMAC
   sobre `admin.<versao>.<expiraEm>`.
3. `Number(expiraEm) <= Date.now()` → expirado.
4. `versao === (lerConfig().sessao_versao || "1")`.

`segredo()` (`auth.js:50-58`): `process.env.SESSION_SECRET` em produção
(garantido presente, ≥ 32 caracteres e fora da lista de placeholders por
`autenticacaoConfiguradaComSeguranca()`, checada no login e em
`exigirSessao`); string fixa só fora de produção.

### O que invalida um cookie antigo (e só isso)

| Gatilho                           | Mecanismo                                                                                     | Provado                                                                                        |
| --------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Adulteração** de qualquer campo | o HMAC cobre `dono.versao.expiraEm`; mudar qualquer um quebra a assinatura                    | exp #5 (assinatura alterada → `false`), exp #6 (trocar `versao` mantendo assinatura → `false`) |
| **Expiração** (12 h após emitir)  | `Number(expiraEm) <= Date.now()`, sobre o valor **assinado** — o cliente não consegue esticar | exp #3 (`expiraEm` no passado → `false`)                                                       |
| **Bump de `sessao_versao`**       | `trocarSenha()` faz `sessao_versao += 1`; todo cookie com o número antigo falha o passo 4     | exp #4 (após `sessao_versao = "2"`, token v1 → `false`)                                        |

**Não invalida:** logout (só apaga o cookie no navegador — `encerrarSessao`
não toca `sessao_versao` nem nenhum estado no servidor), troca de IP, troca
de User-Agent, "uso" do token (não há single-use, nonce, nem `jti`).

### Replay

**Possível, sim.** O cookie é um **bearer token stateless**: quem obtiver a
string exata do cookie a reapresenta quantas vezes quiser até `expiraEm`
(≤ 12 h) ou até uma troca de senha. Não há store de sessão no servidor para
revogar uma sessão individual. Confirmado: exp #2 (mesmo token aceito de novo,
sem limite). **Logout não interrompe o replay de um token já capturado.**
Ver **F15**.

### Expiração é real?

**Sim.** É uma checagem no servidor sobre o `expiraEm` que está dentro do
payload assinado (`auth.js:225`), não o `Max-Age` do cookie (que o cliente
controla). O cliente não consegue prorrogar sem quebrar o HMAC (exp #3, #6).

Quirk latente (exp #7): `Number("abc")` é `NaN` e `NaN <= Date.now()` é
`false` → um `expiraEm` não-numérico **não** é tratado como expirado. Não
explorável (a assinatura HMAC sobre `admin.<v>.abc` exigiria o segredo), mas
a checagem deveria rejeitar `!Number.isFinite`. Recolhido em **F18**.

---

## 3. CSRF

As mutações do admin (`POST`/`PUT`/`PATCH`/`DELETE` em `/api/admin/*`)
dependem de **duas** camadas:

**Camada 1 — `SameSite=Strict` (a que realmente segura).** Uma requisição
cross-site (form POST, `fetch`, navegação top-level a partir de outro
domínio) **não carrega** `admin_sessao`. Chega sem cookie →
`sessaoValida()` → `false` → **401**.

**Camada 2 — checagem de `Origin` em `exigirSessao`** (`auth.js:266-283`):
para método de mutação, se `Origin` está presente e `new URL(origin).host !==
Host` → **403 "Origem não permitida."**. Comportamento provado (exp `exp-auth2.mjs`):

| Requisição                                                     | Resultado                                          |
| -------------------------------------------------------------- | -------------------------------------------------- |
| `POST` sem `Origin` nem `Host`                                 | **passa** (fica por conta do SameSite)             |
| `POST` `Origin` = `http://localhost`, `Host` = `localhost`     | passa (same-origin legítimo)                       |
| `POST` `Origin` = `https://evil.example`, `Host` = `localhost` | **403**                                            |
| `POST` `Origin` malformado (`))(`)                             | **403** (fail-closed)                              |
| `POST` `Origin` = `https://evil.localhost` (subdomínio)        | **403** (`host` difere)                            |
| `POST` `Origin` presente, **`Host` ausente**                   | **passa** ⚠️ (`if (origem && host)` exige os dois) |
| `GET` `Origin` cross-site                                      | passa (Origin não é checado em GET)                |
| `DELETE` `Origin` cross-site                                   | **403**                                            |

### Um POST cross-site consegue agir como admin?

- **Qualquer navegador atual: não.** `SameSite=Strict` retém o cookie → 401.
  Mesmo que não retivesse, o navegador manda `Origin` em POST cross-site e a
  checagem devolve 403. JS de página não consegue forjar o header `Origin`
  (nome de header proibido).
- **Navegador antigo que ignora `SameSite`** (Chrome < 51 / Firefox < 60 /
  Safari < 12, todos pré-2017): o cookie iria junto. Aí depende de o
  navegador mandar `Origin` na requisição forjada. Um navegador velho o
  suficiente para ignorar `SameSite` também é anterior ao envio confiável de
  `Origin` em `<form>` POST (que virou padrão por volta de 2020) → a checagem
  de `Origin` seria pulada (sem header) → **CSRF possível nesse navegador**.
  Fatia de usuários reais: praticamente zero.
- **`Host` removido por um proxy:** exp mostra "Origin presente, Host ausente
  → passa". Um proxy mal configurado que retire o `Host` desarma a camada 2.
  Combinado com o navegador antigo acima → CSRF. Estreito. Recolhido em **F18**.
- **GET cross-site**: sem checagem de `Origin`, mas as rotas GET também
  exigem o cookie, que o `SameSite=Strict` retém → 401. E GET não faz
  mutação. Um site malicioso não lê dado do painel.

**Veredito:** CSRF **mitigado de forma adequada** (SameSite=Strict primário +
Origin secundário). Risco residual só em navegador que ignora SameSite **e**
requisição sem header `Origin` — não é cenário de navegador atual. O ponto de
endurecimento (`if (origem && host)` exigir os dois; não exigir `Origin` em
mutação) está em **F18**, severidade P3.

---

## 4. Autorização por rota — prova de que toda rota admin exige sessão

`exigirSessao(request)` é a **primeira instrução executável** de todo método
de toda rota admin, **antes** de `obterRecurso`, do parse do corpo e de
`request.formData()` (verificado por grep de `exigirSessao` × `export const
<MÉTODO>` × `await request`):

| Arquivo                            | Métodos        | `exigirSessao` na 1ª linha?                                                                      |
| ---------------------------------- | -------------- | ------------------------------------------------------------------------------------------------ |
| `admin/[recurso]/route.js`         | GET, POST      | sim (`:90`, `:115`) — antes de `obterRecurso` (`:93`, `:118`)                                    |
| `admin/[recurso]/[id]/route.js`    | PATCH, DELETE  | sim (`:14`, `:89`)                                                                               |
| `admin/agendamentos/route.js`      | GET, POST, PUT | sim (`:13`, `:60`, `:99`)                                                                        |
| `admin/agendamentos/[id]/route.js` | PATCH, DELETE  | sim (`:21`, `:73`)                                                                               |
| `admin/config/route.js`            | GET, PUT       | sim (`:44`, `:55`)                                                                               |
| `admin/senha/route.js`             | POST           | sim (`:12`) — e liberada sob "senha inicial" por `rotaPermitidaComSenhaInicial`                  |
| `admin/upload/route.js`            | POST           | sim (`:76`) — antes de `request.formData()` (`:79`); upload não autenticado nem tem o corpo lido |
| `admin/pendentes/route.js`         | GET            | sim (`:9`)                                                                                       |
| `admin/resumo/route.js`            | GET            | sim (`:129`)                                                                                     |

**Sem `exigirSessao`, de propósito** (cada uma documentada com `motivo` em
`tests/autorizacao.test.js`):

| Arquivo                 | Método | Por quê                                                                                      |
| ----------------------- | ------ | -------------------------------------------------------------------------------------------- |
| `admin/login/route.js`  | POST   | é o próprio login; checa `autenticacaoConfiguradaComSeguranca` + rate limit + `senhaConfere` |
| `admin/logout/route.js` | POST   | idempotente, sem dado sensível — só apaga o cookie                                           |
| `admin/sessao/route.js` | GET    | devolve `{ autenticado: false }` por design; o frontend usa para sondar se há sessão         |

### Caminhos dinâmicos

- **`[recurso]`** é um segmento único (não catch-all). `obterRecurso`
  (`[recurso]/route.js:60-62`) usa `Object.hasOwn(RECURSOS, nome)` → chaves
  de protótipo (`constructor`, `__proto__`, `toString`) → `null` → 404. Mas
  **`exigirSessao` roda antes** de `obterRecurso`, então
  `POST /api/admin/__proto__` sem cookie → **401** (não 404). Nenhuma via
  dinâmica escapa da sessão.
- **`[id]`**: `Number(params.id)` `NaN`/`0` → falsy → 404 — também depois de
  `exigirSessao`.
- **Fora de `/api/admin/`**: não existe rota com capacidade de admin. As
  demais (`/api/public`, `/api/horarios`, `/api/agendamentos`,
  `/api/health`) são públicas de propósito e não expõem nada do painel.

### Mecanismo de prova contínua

`tests/autorizacao.test.js`: 17 casos "método X da rota Y responde 401 sem
cookie" + `nenhuma rota expõe um método HTTP fora do declarado` + **`toda
rota sob /api/admin/* está coberta por este arquivo`** (lê o diretório; um
`route.js` novo fora da lista quebra o teste). Tudo verde (mapa §5).

**Nenhuma rota escapa.** Ressalva de escopo, não finding: o teste de
cobertura varre só `src/app/api/admin/` — uma ação privilegiada pendurada
numa rota **não**-admin não seria pega. Hipotético; hoje não ocorre.

---

## 5. Comparação em tempo constante e distinção de casos no login

### `iguais` — `auth.js:65-70`

`crypto.timingSafeEqual` sobre o conteúdo, mas **`return false` antecipado
quando os comprimentos diferem** → o comprimento vaza por tempo. Usos:

- comparar a assinatura HMAC (o esperado é hex de 64 caracteres — comprimento
  público; nenhum segredo vaza);
- caminho bootstrap: `iguais(texto, process.env.ADMIN_PASSWORD)` → **vaza o
  comprimento de `ADMIN_PASSWORD`**. É uma senha de primeiro acesso,
  substituída por hash no primeiro login; valor baixo. Recolhido em **F18**.

### `conferirHash` / `senhaConfere` — `auth.js:103-158`

- `conferirHash` sempre roda `scrypt` (N = 16384) para um hash armazenado bem
  formado, depois `timingSafeEqual` na chave derivada. O input controlado
  pelo atacante é o palpite de senha; `scrypt` tem tempo constante para
  parâmetros fixos → **sem oráculo de tempo sobre o palpite**.
- `senhaConfere`: `if (!texto) return false` — palpite vazio faz curto-circuito
  (sem `scrypt`). Vaza só "mandei string vazia" (o atacante já sabe).
- **Diferença de tempo que existe:** com `senha_hash` cadastrado, senha errada
  → `scrypt` (~100 ms) → 401. Sem hash (bootstrap) → `iguais` (~instantâneo)
  → 401. Isso **distingue "já existe senha própria" de "ainda na senha do
  .env"** por tempo (~100 ms × < 1 ms). Esse estado também volta pós-login
  (`senhaInicial`) e no `GET /api/admin/sessao` quando autenticado — é
  semi-público. Recolhido em **F17**.

### Respostas que distinguem casos (login)

| Situação                                                                                                        | Resposta                                                                                 |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Servidor mal configurado (sem `SESSION_SECRET` válido, ou sem `ADMIN_PASSWORD` válido em prod na senha inicial) | **503** com texto detalhado ("O painel está indisponível: falta configurar o servidor…") |
| Rate limit estourado                                                                                            | **429** "Muitas tentativas."                                                             |
| Corpo malformado                                                                                                | **400** "JSON inválido."                                                                 |
| Senha errada                                                                                                    | **401** "Senha incorreta."                                                               |
| Senha certa                                                                                                     | **200** `{ ok: true, senhaInicial }`                                                     |

**Não há nome de usuário** → não existe oráculo "usuário válido / senha
errada" (a preocupação clássica de enumeração de usuário não se aplica). As
distinções que existem (mal configurado × rate-limited × senha errada) são
esperadas. A única a destacar: o **503 detalhado chega a um chamador não
autenticado** e conta que a configuração está insegura — ver **F17**.

---

## 6. Troca de senha — `POST /api/admin/senha`

| Requisito                             | Atende?                                        | Onde                                                                                                                                                                                                               |
| ------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Exige sessão válida                   | **sim**                                        | `senha/route.js:12` (`exigirSessao`) — e passa pela trava da senha inicial por exceção explícita                                                                                                                   |
| Exige a **senha atual** (reautentica) | **sim**                                        | `senha/route.js:21` — `if (!(await senhaConfere(senhaAtual))) → 400`                                                                                                                                               |
| Regras da senha nova                  | ≥ 6 caracteres, `=== confirmacao`, `!== atual` | `senha/route.js:28-46`                                                                                                                                                                                             |
| **Invalida as outras sessões**        | **sim**                                        | `trocarSenha()` (`auth.js:169-176`): `sessao_versao += 1`; todo outro cookie carrega o número antigo e falha `tokenValido` (provado: exp #4). Quem trocou continua logado (`criarSessao()` reemite no número novo) |
| Auditoria                             | `registrarAuditoria(acao:'trocar_senha')`      | `senha/route.js:50` — **fora de transação** (ver `02-integridade.md`, nota F3)                                                                                                                                     |

**Lacuna:** `POST /api/admin/senha` **não tem rate limit** — ver **F16**.

---

## 7. Middleware — matcher e cobertura de CSP/headers

`src/middleware.js:61-66` — matcher:
`"/((?!_next/static|_next/image|favicon.ico).*)"`. Roda em **tudo** exceto
`_next/static/*`, `_next/image` e `favicon.ico`.

Headers aplicados (`middleware.js:47-56`): `Content-Security-Policy` (com
`nonce` por requisição + `strict-dynamic`; `'unsafe-eval'` só fora de
produção), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`,
`Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`.

### O que escapa do matcher

| Caminho                                                | Escapa?           | Importa?                                                                                                                                                                                                       |
| ------------------------------------------------------ | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_next/static/*`                                       | sim               | **Não** — bundles JS/CSS com hash imutável, sem HTML                                                                                                                                                           |
| `_next/image`                                          | sim               | **Não** — otimizador de imagem, e `next/image` **não é usado** no projeto (grep confirma: só aparece no comentário do matcher)                                                                                 |
| `favicon.ico`                                          | sim               | **Não** — sem HTML, risco zero                                                                                                                                                                                 |
| `/api/*`                                               | **não** (coberto) | JSON recebe CSP + nosniff + X-Frame-Options — inofensivo, levemente bom                                                                                                                                        |
| `/uploads/*` (imagens enviadas, servidas de `public/`) | **não** (coberto) | **Bom** — recebem `X-Content-Type-Options: nosniff` e `X-Frame-Options: DENY`; o `nosniff` num arquivo enviado por usuário é defesa relevante (a rota de upload já converte tudo para WebP, mas o header soma) |
| `/` (raiz)                                             | **não** (coberto) | a lookahead falha para string vazia → `/` é casado                                                                                                                                                             |

**Nenhuma rota que serve HTML escapa.** As três exclusões são todas caminhos
de asset estático sem HTML. Sem finding.

Nota sobre a CSP em si (não é o foco desta etapa, mas vale registrar): é
sólida — `script-src` sem `unsafe-inline`/`unsafe-eval` em produção, `nonce`
de 122 bits (`crypto.randomUUID()`), `frame-ancestors 'none'`, `object-src
'none'`, `base-uri 'self'`, `form-action 'self'`. O ponto fraco assumido é
`style-src 'unsafe-inline'` (estilos inline de `style={{}}` no painel — o
próprio comentário do arquivo declara o trade-off). `img-src 'self' data:
https:` é permissivo mas de baixo risco.

---

## 8. Achados

Formato: `ID | Severidade | Arquivo:linha | O que está errado | Quando quebra | Método de correção | Esforço | Risco de mexer`

### F15 — Logout não revoga a sessão no servidor; um token capturado sobrevive ao "Sair" por até 12 h

| Campo                  | Conteúdo                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severidade**         | **P2**                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Arquivo:linha**      | `src/lib/auth.js:210-212` (`encerrarSessao` só apaga o cookie no cliente); ausência de qualquer store de sessão; `auth.js:215-229` (`tokenValido` só invalida por assinatura, `expiraEm` ou `sessao_versao`)                                                                                                                                                                                                                          |
| **O que está errado**  | O cookie é um bearer token stateless. `POST /api/admin/logout` não incrementa `sessao_versao` nem registra nada no servidor — só manda o navegador esquecer o cookie. Um token cujo valor foi copiado continua válido.                                                                                                                                                                                                                |
| **Quando quebra**      | Computador compartilhado na recepção da barbearia; extensão de navegador maliciosa; o cookie parar num log ou backup de perfil. A dona clica em "Sair" e fecha o navegador; quem copiou o valor do cookie mantém acesso de admin por até 12 h (ou até a próxima troca de senha). Não existe "encerrar esta sessão" nem "encerrar todas". Confirmado por experimento (replay ilimitado; `encerrarSessao` não mexe em `sessao_versao`). |
| **Método de correção** | No `POST /api/admin/logout`, além de apagar o cookie, incrementar `sessao_versao` (mesmo mecanismo de `trocarSenha`). Num painel de usuário único isso é aceitável — invalida todas as sessões, e a dona normalmente só tem uma. Alternativa mais fina (tabela de sessões com `jti` e revogação individual) provavelmente é exagero para uma unidade.                                                                                 |
| **Esforço**            | Baixo.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Risco de mexer**     | Baixo. Efeito colateral aceitável: sair no computador desloga o celular.                                                                                                                                                                                                                                                                                                                                                              |

### F16 — `POST /api/admin/senha` sem rate limit

| Campo                  | Conteúdo                                                                                                                                                                                                                                                                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severidade**         | **P3**                                                                                                                                                                                                                                                                                                                                        |
| **Arquivo:linha**      | `src/app/api/admin/senha/route.js` (nenhuma chamada a `limiteAtingido`/`registrarTentativa`)                                                                                                                                                                                                                                                  |
| **O que está errado**  | A troca de senha exige sessão válida, mas não limita tentativas de `senhaAtual`. Cada tentativa roda um `scrypt` (~100 ms de CPU no thread único).                                                                                                                                                                                            |
| **Quando quebra**      | Sessão sequestrada (ver F15): o atacante martela `senhaAtual` sem custo — mini-DoS por CPU e, se acertar, troca a senha e tranca a dona para fora. Impacto incremental limitado (quem tem a sessão já faz tudo), mas trocar a senha é justamente a ação que deveria exigir provar a senha atual, e brute-force sem teto corrói essa barreira. |
| **Método de correção** | Aplicar o `limitador` já existente, chave `senha:<ip>` (ou por sessão), janela curta e limite baixo (ex.: 5 / 15 min). Não precisa do circuito global.                                                                                                                                                                                        |
| **Esforço**            | Baixo.                                                                                                                                                                                                                                                                                                                                        |
| **Risco de mexer**     | Baixo.                                                                                                                                                                                                                                                                                                                                        |

### F17 — 503 do login e `configuracaoInsegura` do `/sessao` contam a um chamador não autenticado que o servidor está mal configurado

| Campo                  | Conteúdo                                                                                                                                                                                                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severidade**         | **P3**                                                                                                                                                                                                                                                                                                            |
| **Arquivo:linha**      | `src/app/api/admin/login/route.js:34-41` (503 com texto detalhado); `src/app/api/admin/sessao/route.js:11-13` (`{ configuracaoInsegura: true }`)                                                                                                                                                                  |
| **O que está errado**  | Sem nenhuma credencial, um sondador aprende que `SESSION_SECRET` ou `ADMIN_PASSWORD` não estão configurados com segurança — exatamente o cenário em que forjar cookie ou adivinhar a senha inicial é viável.                                                                                                      |
| **Quando quebra**      | Em produção, `getDb()` já **recusa subir** com configuração insegura (mapa §1), então na prática o servidor nem responde — o vazamento só vale se alguém contornar essa checagem, ou num ambiente não-produção exposto à internet. Ainda assim, é um farol apontando para a janela aberta.                        |
| **Método de correção** | Manter o texto detalhado só no log (`registrarErro`) e devolver ao cliente um 503 genérico ("Painel temporariamente indisponível."). Em `/api/admin/sessao`, devolver só `{ autenticado: false }`, sem `configuracaoInsegura`. Decidir como o operador legítimo fica sabendo (o log é onde ele já deveria olhar). |
| **Esforço**            | Trivial.                                                                                                                                                                                                                                                                                                          |
| **Risco de mexer**     | Baixo — o frontend hoje usa `configuracaoInsegura` para uma mensagem específica ao operador; ajustar essa tela junto.                                                                                                                                                                                             |

### F18 — Endurecimentos de auth: checagem de Origin ignorada sem `Host`, `iguais` vaza comprimento, `expiraEm` não-numérico não conta como expirado

| Campo                  | Conteúdo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severidade**         | **P3** (endurecimento — nenhum explorável isolado)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Arquivo:linha**      | `src/lib/auth.js:269` (`if (origem && host)`); `src/lib/auth.js:65-70` (`iguais` retorna cedo em divergência de comprimento); `src/lib/auth.js:225` (`Number(expiraEm) <= Date.now()`)                                                                                                                                                                                                                                                                                                                                                                                 |
| **O que está errado**  | (a) A checagem de `Origin` exige `Origin` **e** `Host` presentes; um proxy que remova/renomeie `Host` desarma a camada 2 do anti-CSRF mesmo com `Origin` cross-site presente (confirmado por experimento). (b) `iguais` vaza, por tempo, o comprimento de `ADMIN_PASSWORD` no caminho bootstrap (o do HMAC não vaza segredo — 64 hex é público). (c) `Number("abc")` é `NaN`, `NaN <= x` é `false` → um `expiraEm` não-numérico não é tratado como expirado (não explorável — a assinatura HMAC teria que bater — mas a checagem deveria rejeitar `!Number.isFinite`). |
| **Quando quebra**      | Nenhum isolado. São camadas que enfraquecem sob condição adversa: proxy estranho + navegador que ignora `SameSite` (para o item a); ou o dia em que a assinatura HMAC tiver outra fraqueza (item c).                                                                                                                                                                                                                                                                                                                                                                   |
| **Método de correção** | (a) Para método de mutação com cookie de sessão presente: exigir `Origin` (recusar se ausente, ou aceitar só com `Sec-Fetch-Site: same-origin`); não condicionar a checagem à presença de `Host`. (b) `tokenValido`: `if (!Number.isFinite(Number(expiraEm))                                                                                                                                                                                                                                                                                                           |     | Number(expiraEm) <= Date.now()) return false`. (c) `iguais`no caminho bootstrap: comparar via hash de comprimento fixo dos dois lados, ou aceitar o vazamento de comprimento (é o mínimo possível com`timingSafeEqual`). |
| **Esforço**            | Baixo.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Risco de mexer**     | Baixo. Exigir `Origin` em mutação pode quebrar cliente não-navegador legítimo — não há nenhum hoje; validar.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

---

## 9. O que está correto (para contraste)

- **Cookie**: `HttpOnly` + `SameSite=Strict` + `Secure` em produção + `Path=/`
  - `Max-Age` de 12 h. Configuração sólida.
- **Assinatura**: HMAC-SHA256 sobre `dono.versao.expiraEm` com segredo de
  ≥ 32 caracteres e fora da lista de placeholders, exigido em produção.
  Adulterar qualquer campo quebra a validação (provado). Comparação
  timing-safe.
- **Expiração real** de 12 h, checada no servidor contra o payload assinado —
  o cliente não estica (provado).
- **`sessao_versao`**: a troca de senha derruba todas as outras sessões
  (provado).
- **Autorização**: `exigirSessao` é a 1ª instrução de todo método de toda
  rota admin, antes de parse de corpo / `obterRecurso` / `formData()`
  (grep-provado); `tests/autorizacao.test.js` trava o invariante com varredura
  de diretório; `login`/`logout`/`sessao` são as únicas exceções, cada uma
  documentada.
- **`[recurso]`** à prova de prototype pollution (`Object.hasOwn`).
- **CSRF**: `SameSite=Strict` (primário) + checagem de `Origin` que falha
  fechado em `Origin` malformado e pega subdomínio (provado).
- **Senha**: `scrypt` (N = 16384), tempo constante sobre o palpite, parâmetros
  embutidos no hash, formato legado ainda legível.
- **Sem nome de usuário** → sem oráculo de enumeração de usuário.
- **CSP**: `nonce` + `strict-dynamic`, sem `unsafe-inline`/`unsafe-eval` no
  `script-src` em produção, `frame-ancestors 'none'`, `object-src 'none'`,
  `base-uri 'self'`, `form-action 'self'`. O middleware cobre toda rota HTML.
- **Rate limit do login**: por IP (8 / 15 min) + circuito global
  (50 / 15 min → trava 60 s, re-armando). Só falhas contam.
- **Troca de senha**: exige a senha atual (reautentica), comprimento mínimo,
  confirmação, tem de diferir da atual, e derruba as outras sessões.
