# 08 — Contrato da API (referência do front-end)

Extraído linha a linha das rotas em `src/app/api/**` + `src/lib/agendamentos.js`,
`src/lib/validacao.js`, `src/lib/auth.js`, `src/lib/requisicao.js`,
`src/lib/limitador.js`. Base: `auditoria/01-mapa.md`.

**Regras gerais válidas para todo endpoint:**

- Todo handler é embrulhado por `comLog`. Qualquer exceção não tratada →
  **500** `{ "erro": "Algo deu errado. Tente de novo em instantes." }`. Isso é
  omitido nas tabelas de cada endpoint — assuma que **500 com esse corpo** é
  sempre possível (ex.: banco não migrado faz `getDb()` lançar em qualquer
  rota).
- Corpo de requisição é lido por `lerCorpoJson`: **corpo vazio → `{}`**
  (segue, a validação de campo reclama); **JSON malformado → a rota devolve
  400** (mensagem varia — ver Inconsistência I-3).
- `Content-Type` de toda resposta: `application/json` (via `Response.json`).
- Datas: `"AAAA-MM-DD"`. Horas: `"HH:MM"`. Mês: `"AAAA-MM"`. **Exceção:**
  `criado_em` e `excluido_em` são `"AAAA-MM-DD HH:MM:SS"` em **UTC** (todo o
  resto é no fuso da barbearia) — ver Inconsistência I-9.
- `ativo` e `aberto` são **inteiros `0|1`**, nunca booleanos JS.
- Campos de texto não preenchidos vêm como `""` (schema `NOT NULL DEFAULT
  ''`), nunca `null`. `null` só aparece onde é semântico (ver I-10).

## Tipos compartilhados

```ts
type Erro = { erro: string };
type ErroValidacao = { erro: string; erros: Record<string, string> }; // só nas rotas [recurso]

// Linha bruta de agendamento — resultado de SELECT * (usada em vários endpoints)
type AgendamentoRow = {
  id: number;
  cliente_nome: string;
  cliente_telefone: string;      // só dígitos
  barbeiro_id: number | null;    // null teoricamente possível (ON DELETE SET NULL); na prática não ocorre
  servico_id: number | null;
  barbeiro_nome: string;         // snapshot congelado; "" antes de ter sido setado
  servico_nome: string;          // snapshot congelado
  data: string;                  // "AAAA-MM-DD" (fuso da barbearia)
  inicio: string;                // "HH:MM"
  fim: string;                   // "HH:MM"
  duracao_min: number;
  preco_centavos: number;        // snapshot congelado na criação; recotado na remarcação
  observacoes: string;
  status: "pendente" | "confirmado" | "concluido" | "cancelado";
  criado_em: string;             // "AAAA-MM-DD HH:MM:SS" — UTC
  excluido_em: string | null;    // sempre null nas respostas (toda leitura filtra excluido_em IS NULL)
};

type ExpedienteRow = { dia: number; aberto: 0 | 1; abre: string; fecha: string }; // abre/fecha "HH:MM"
```

## Respostas de `exigirSessao` (compartilhadas por `/api/admin/*`, exceto `login`, `logout`, `sessao`)

Retornadas **antes** de qualquer lógica do endpoint, nesta ordem de checagem:

| Status | Corpo | Condição |
|---|---|---|
| **503** | `{ "erro": "O painel está indisponível: falta configurar o servidor com segurança (SESSION_SECRET/ADMIN_PASSWORD). Avise quem cuida da hospedagem." }` | `SESSION_SECRET` inválido em produção, ou (na senha inicial) `ADMIN_PASSWORD` inválido em produção |
| **401** | `{ "erro": "Sessão expirada. Entre novamente." }` | Sem cookie `admin_sessao` válido (ausente, assinatura errada, expirado, `sessao_versao` antiga) |
| **403** | `{ "erro": "Origem não permitida." }` | Método de mutação (POST/PUT/PATCH/DELETE) com header `Origin` presente cujo host ≠ header `Host` |
| **403** | `{ "erro": "Troque a senha inicial antes de continuar usando o painel." }` | `usandoSenhaInicial()` é `true` **e** a rota não é `POST /api/admin/senha` nem `GET /api/admin/config` |

Nas tabelas abaixo, "401/403/503 (`exigirSessao`)" refere-se a este bloco.

---

# 1. Endpoints públicos (sem autenticação)

## 1.1 `GET /api/public`

**Autenticação:** nenhuma.
**Parâmetros:** nenhum.

**Sucesso — 200:**

```ts
{
  fuso: string;                  // process.env.TZ || "America/Sao_Paulo"
  barbearia: {
    nome: string;                // config.nome_barbearia (pode ser "")
    whatsapp: string;            // config.whatsapp (só dígitos ou "")
    endereco: string;
  };
  servicos: Array<{
    id: number;
    nome: string;
    descricao: string;
    categoria: string;
    preco_centavos: number;
    duracao_min: number;
    barbeiros: number[];         // ids dos barbeiros que executam
  }>;                            // só serviços ativos E com >= 1 barbeiro ativo vinculado; ordenados por (ordem, id)
  barbeiros: Array<{
    id: number;
    nome: string;
    funcao: string;
    bio: string;
    foto: string;                // caminho "/uploads/..." ou ""
  }>;                            // só ativos; ordenados por (ordem, id)
  dias: string[];                // ["AAAA-MM-DD", ...] — próximos dias com expediente, até config.dias_futuros (default 30)
}
```

**Status possíveis:** 200 (sempre, salvo exceção → 500).
**Corpo de erro:** só o 500 genérico.

---

## 1.2 `GET /api/horarios`

**Autenticação:** nenhuma.
**Parâmetros (query string):**

| Nome | Tipo | Obrigatório | Validação | Limites |
|---|---|---|---|---|
| `barbeiro` | number | sim | `Number(...)`; `0`/`NaN` → 400 | — |
| `servico` | number | sim | `Number(...)`; `0`/`NaN` → 400 | — |
| `data` | string | sim | regex `^\d{4}-\d{2}-\d{2}$` (**formato apenas** — `2024-99-99` passa) | — |

Não valida se o barbeiro existe / está ativo / executa o serviço (o grid sai
mesmo para pares inválidos — ver `07`/Etapa 3 F12).

**Sucesso — 200:**

```ts
{ horarios: string[] }   // ["HH:MM", ...], possivelmente [] (dia fechado, agenda cheia, serviço mais longo que o expediente etc.)
```

**Status possíveis:**

| Status | Corpo | Condição |
|---|---|---|
| 200 | `{ horarios: string[] }` | ok |
| 400 | `{ "erro": "Informe barbeiro, serviço e data." }` | `barbeiro`/`servico` falsy ou `data` fora do formato |
| 404 | `{ "erro": "Serviço indisponível." }` | `servico` não existe ou `ativo = 0` |

---

## 1.3 `POST /api/agendamentos` (agendamento público)

**Autenticação:** nenhuma. **Rate limit:** chave `agendar:<ip>` (com
`TRUST_PROXY≠1`, `<ip>` = `"sem-ip"` para todos), 6 tentativas / 10 min. A
tentativa é contada **antes** da validação e **em todo caso** (inclusive
sucesso).

**Parâmetros (corpo JSON):**

| Nome | Tipo | Obrigatório | Validação | Limites |
|---|---|---|---|---|
| `cliente_nome` | string | sim | `trim()`, `length >= 2` | cortado em **80** caracteres |
| `cliente_telefone` | string | sim | `somenteDigitos` → precisa ter **10 ou 11 dígitos** | — |
| `barbeiro_id` | number | sim | `Number(...)`; precisa existir e `ativo = 1`; precisa estar vinculado ao serviço | — |
| `servico_id` | number | sim | idem existência + `ativo = 1` | — |
| `data` | string | sim | `dataValida` — `^\d{4}-\d{2}-\d{2}$` **+ data de calendário real** (`2024-02-30` falha) | — |
| `inicio` | string | sim | `horaValida` — `^\d{2}:\d{2}$` + hora ≤ 23 e minuto ≤ 59; precisa estar em `horariosLivres(barbeiro, servico, data)` | — |
| `observacoes` | — | — | **ignorado** nesta rota (só o encaixe do painel aceita) | — |

**Sucesso — 200** (⚠️ não 201 — ver I-1):

```ts
{
  agendamento: {
    id: number;
    cliente: string;         // ⚠️ nome do campo diverge de cliente_nome (I-8)
    telefone: string;        // ⚠️ diverge de cliente_telefone
    barbeiro: string;        // ⚠️ diverge de barbeiro_nome — é o snapshot do nome
    servico: string;         // ⚠️ diverge de servico_nome
    data: string;            // "AAAA-MM-DD"
    inicio: string;          // "HH:MM"
    fim: string;             // "HH:MM"
    duracao_min: number;
    preco_centavos: number;
    observacoes: string;     // sempre "" nesta rota
    status: "confirmado" | "pendente";  // "confirmado" se config.confirmacao_automatica === "1", senão "pendente"
    barbearia: string;       // config.nome_barbearia (injetado pela rota)
  };
  whatsapp_barbearia: string;  // config.whatsapp
}
```

**Status possíveis:**

| Status | Corpo | Condição |
|---|---|---|
| 200 | shape acima | agendamento criado |
| 400 | `{ "erro": "Não consegui ler os dados enviados." }` | JSON malformado (⚠️ mensagem diferente das outras rotas — I-3) |
| 400 | `{ "erro": "Escreva o nome do cliente." }` | `cliente_nome` < 2 chars |
| 400 | `{ "erro": "Informe um WhatsApp com DDD." }` | telefone não tem 10–11 dígitos |
| 400 | `{ "erro": "Informe a data e o horário." }` | `data`/`inicio` fora do formato/calendário |
| 400 | `{ "erro": "Esse serviço está desativado." }` | `servico.ativo = 0` |
| 400 | `{ "erro": "Esse profissional está desativado." }` | `barbeiro.ativo = 0` |
| 400 | `{ "erro": "<nome do barbeiro> não atende <nome do serviço>." }` | par não vinculado em `servico_barbeiro` |
| 404 | `{ "erro": "Serviço ou profissional não encontrado." }` | `barbeiro_id` ou `servico_id` inexistente |
| 409 | `{ "erro": "Esse horário acabou de ser ocupado. Escolha outro, por favor." }` | `inicio` não está em `horariosLivres` no momento da gravação |
| 409 | `{ "erro": "Esse horário já está ocupado. Escolha outro, por favor." }` | violação do índice único parcial |
| 429 | `{ "erro": "Muitos agendamentos em pouco tempo. Aguarde alguns minutos e tente de novo." }` | rate limit atingido |

Nenhum header `Retry-After` no 429 (ver I-12).

---

## 1.4 `GET /api/health`

**Autenticação:** nenhuma. **Parâmetros:** nenhum.

**Status possíveis:**

| Status | Corpo | Condição |
|---|---|---|
| 200 | `{ "ok": true }` | `SELECT 1` no banco funcionou **e** `public/uploads` tem permissão de escrita |
| 503 | `{ "ok": false }` | `SELECT 1` lançou (banco indisponível/não migrado/config insegura), **ou** `public/uploads` sem permissão de escrita |

⚠️ Corpo **não tem** campo `erro` (I-6). Não detecta disco cheio nem FS
somente-leitura (Etapa 7 F32).

---

# 2. Autenticação do painel

## 2.1 `POST /api/admin/login`

**Autenticação:** nenhuma (é o login). **Rate limit:** chave `login:<ip>`, 8
falhas / 15 min; **+ circuito global** `login:global`, 50 falhas / 15 min →
bloqueia todo login por 60 s (re-armando). Tentativa contada **só em falha**.
**Efeito colateral:** em sucesso, envia `Set-Cookie: admin_sessao=<token>;
HttpOnly; SameSite=Strict; Path=/; Max-Age=43200` (+ `Secure` em produção).

**Parâmetros (corpo JSON):**

| Nome | Tipo | Obrigatório | Validação |
|---|---|---|---|
| `senha` | string | sim | comparada com o hash no banco (ou com `ADMIN_PASSWORD` se não houver hash); vazia → falha |

**Sucesso — 200:**

```ts
{ ok: true; senhaInicial: boolean }   // senhaInicial = true quando ainda não há senha_hash no banco
```

**Status possíveis:**

| Status | Corpo | Condição |
|---|---|---|
| 200 | `{ ok: true, senhaInicial: boolean }` | senha correta |
| 400 | `{ "erro": "JSON inválido." }` | JSON malformado |
| 401 | `{ "erro": "Senha incorreta." }` | senha errada ou vazia |
| 429 | `{ "erro": "Muitas tentativas. Aguarde alguns minutos e tente de novo." }` | rate limit por IP ou global |
| 503 | `{ "erro": "O painel está indisponível: falta configurar o servidor com segurança (SESSION_SECRET/ADMIN_PASSWORD). Avise quem cuida da hospedagem." }` | `SESSION_SECRET`/`ADMIN_PASSWORD` inválidos em produção |

---

## 2.2 `GET /api/admin/sessao`

**Autenticação:** nenhuma (endpoint de sondagem). Lê o cookie `admin_sessao`.
**Parâmetros:** nenhum.

**Sucesso — sempre 200, duas formas:**

```ts
// Forma A — servidor mal configurado (autenticacaoConfiguradaComSeguranca() === false):
{ autenticado: false; configuracaoInsegura: true }         // ⚠️ sem o campo senhaInicial (I-7)

// Forma B — normal:
{ autenticado: boolean; senhaInicial: boolean }            // ⚠️ sem o campo configuracaoInsegura
// senhaInicial é sempre false quando autenticado === false; é o valor real quando autenticado === true
```

**Status possíveis:** 200 (sempre, salvo 500).

---

## 2.3 `POST /api/admin/logout`

**Autenticação:** nenhuma (idempotente). **Efeito:** `Set-Cookie:
admin_sessao=; Path=/; Max-Age=0` (apaga só no cliente — não invalida o token
no servidor).
**Parâmetros:** nenhum.

**Sucesso — 200:** `{ ok: true }` (sempre).

---

# 3. Configuração

## 3.1 `GET /api/admin/config`

**Autenticação:** `exigirSessao` — **liberado** na senha inicial.
**Parâmetros:** nenhum.

**Sucesso — 200:**

```ts
{
  config: {
    nome_barbearia: string;
    slogan: string;
    whatsapp: string;
    endereco: string;
    instagram: string;
    logo_url: string;
    intervalo_min: string;            // ⚠️ string, não number ("15" | "20" | "30" | "60" via UI, mas a API aceita qualquer string)
    antecedencia_min: string;         // "0" | "30" | "60" | "120" | "1440" via UI
    dias_futuros: string;             // "7" | "15" | "30" | "60" | "90" via UI
    confirmacao_automatica: string;   // "1" | "0"
    onboarding_expediente_ok?: string; // "1" quando marcado; ausente se nunca setado
  };
  expediente: ExpedienteRow[];         // 7 linhas, ordenadas por dia (0=domingo)
  senhaInicial: boolean;
  fuso: string;                        // process.env.TZ || "America/Sao_Paulo"
}
```

`config` **nunca** inclui `senha_hash` nem `sessao_versao` (removidos por
`configPublica()`).

**Status possíveis:** 200 · 401/503 (`exigirSessao`). 403 **não** ocorre na
senha inicial (esta rota é exceção).

---

## 3.2 `PUT /api/admin/config`

**Autenticação:** `exigirSessao` — **403 na senha inicial** (só o GET é
liberado).
**Parâmetros (corpo JSON):** ambas as chaves são opcionais; enviar `{}` é
válido e devolve o estado atual sem erro.

| Nome | Tipo | Obrigatório | Validação | Limites |
|---|---|---|---|---|
| `config` | objeto | não | só chaves da whitelist são gravadas (`nome_barbearia`, `slogan`, `whatsapp`, `endereco`, `instagram`, `logo_url`, `intervalo_min`, `antecedencia_min`, `dias_futuros`, `confirmacao_automatica`, `onboarding_expediente_ok`); **nenhuma validação de faixa ou formato**; valor salvo como `String(v ?? "")` (objeto vira `"[object Object]"`, `null` vira `""`) | **nenhum** limite de comprimento (Etapa 5 F24) |
| `expediente` | `ExpedienteRow[]` | não | itens com `dia` não-inteiro são descartados; `aberto` truthy→1; `abre`/`fecha` fora de `^\d{2}:\d{2}$` → default `"09:00"`/`"20:00"`; depois `validarExpediente` exige `fecha > abre` por dia | — |

**Sucesso — 200:**

```ts
{ config: {...}; expediente: ExpedienteRow[] }   // ⚠️ SEM senhaInicial e SEM fuso (diverge do GET — I-11)
```

**Status possíveis:**

| Status | Corpo | Condição |
|---|---|---|
| 200 | `{ config, expediente }` | ok (mesmo com `{}` no corpo) |
| 400 | `{ "erro": "JSON inválido." }` | JSON malformado |
| 400 | `{ "erro": "Expediente inválido: <mensagens juntadas por espaço>" }` | algum dia com `fecha <= abre` |
| — | 401/403/503 (`exigirSessao`) | |

---

## 3.3 `POST /api/admin/senha`

**Autenticação:** `exigirSessao` — **liberado** na senha inicial. **Sem rate
limit.** **Efeito:** em sucesso, sobe `sessao_versao` (derruba as outras
sessões) e reemite o cookie `admin_sessao` para esta sessão.

**Parâmetros (corpo JSON):**

| Nome | Tipo | Obrigatório | Validação |
|---|---|---|---|
| `senhaAtual` | string | sim | precisa bater com a senha vigente |
| `novaSenha` | string | sim | `length >= 6`; precisa diferir da atual |
| `confirmacao` | string | sim | precisa ser `=== novaSenha` |

**Sucesso — 200:** `{ ok: true }`.

**Status possíveis:**

| Status | Corpo | Condição |
|---|---|---|
| 200 | `{ ok: true }` | senha trocada |
| 400 | `{ "erro": "JSON inválido." }` | JSON malformado |
| 400 | `{ "erro": "A senha atual está incorreta." }` | `senhaAtual` não confere (⚠️ 400, não 401 — I-5) |
| 400 | `{ "erro": "A senha nova precisa ter pelo menos 6 caracteres." }` | `novaSenha.length < 6` |
| 400 | `{ "erro": "A confirmação não bate com a senha nova." }` | `confirmacao !== novaSenha` |
| 400 | `{ "erro": "A senha nova é igual à atual." }` | `novaSenha` confere com a senha vigente |
| — | 401/503 (`exigirSessao`) | — |

---

## 3.4 `POST /api/admin/upload`

**Autenticação:** `exigirSessao` — **403 na senha inicial**.
**Content-Type:** `multipart/form-data`.

**Parâmetros (campos do form):**

| Nome | Tipo | Obrigatório | Validação | Limites |
|---|---|---|---|---|
| `arquivo` | File | sim | precisa ser `File`; magic number deve ser PNG/JPEG/GIF/WEBP; `sharp` precisa conseguir decodificar | **≤ 5 MB** (`arquivo.size`) |
| `pasta` | string | não | se não for uma de `logo`/`barbeiros`/`servicos`/`produtos`, cai silenciosamente em `"geral"` | — |
| `anterior` | string | não | só age se casar `^/uploads/(logo\|barbeiros\|servicos\|produtos)/[0-9a-f-]{36}\.webp$`; senão ignora | — |

**Sucesso — 201:**

```ts
{ url: string }   // "/uploads/<pasta>/<uuid>.webp"
```

**Status possíveis:**

| Status | Corpo | Condição |
|---|---|---|
| 201 | `{ url: string }` | imagem processada e gravada |
| 400 | `{ "erro": "Selecione uma imagem." }` | `arquivo` ausente ou não é `File` |
| 400 | `{ "erro": "A imagem precisa ter até 5 MB." }` | `arquivo.size > 5 MB` |
| 400 | `{ "erro": "Envie uma imagem JPG, PNG, WEBP ou GIF." }` | magic number não reconhecido |
| 400 | `{ "erro": "Não consegui processar essa imagem." }` | `sharp` lançou |
| — | 401/403/503 (`exigirSessao`) | — |
| 500 | genérico | falha de escrita em disco (cheio / somente-leitura) |

---

# 4. Painel — agendamentos

## 4.1 `GET /api/admin/agendamentos`

**Autenticação:** `exigirSessao` — **403 na senha inicial**.
**Parâmetros (query string):** todos opcionais.

| Nome | Tipo | Default | Efeito |
|---|---|---|---|
| `busca` | string | `""` | `trim()`; filtra `cliente_nome LIKE %busca% OR cliente_telefone LIKE %(só dígitos de busca)%` |
| `status` | string | `""` | filtro exato `status = ?` — **sem validação** de valor |
| `barbeiro` | number | `""` | `Number(...)` → filtro `barbeiro_id = ?` |
| `data` | string | `""` | filtro exato `data = ?` — **sem validação de formato** |
| `pagina` | number | `0` | `Math.max(0, Number(...) || 0)` — **0-indexado** |

Sempre aplica `excluido_em IS NULL`.

**Sucesso — 200:**

```ts
{
  itens: AgendamentoRow[];   // ordenados por data DESC, inicio DESC; até 100 por página
  total: number;             // ⚠️ CONTAGEM de linhas do filtro (não é dinheiro — ver I-8)
  pagina: number;            // eco do parâmetro (0-indexado)
  tamanhoPagina: number;     // sempre 100
}
```

**Status possíveis:** 200 · 401/403/503 (`exigirSessao`).

---

## 4.2 `POST /api/admin/agendamentos` (encaixe manual)

**Autenticação:** `exigirSessao` — **403 na senha inicial**.
**Parâmetros (corpo JSON):**

| Nome | Tipo | Obrigatório | Validação | Limites |
|---|---|---|---|---|
| `cliente_nome` | string | sim | `trim()`, `length >= 2` | cortado em **80** |
| `cliente_telefone` | string | **não** | se enviado, precisa ter 10–11 dígitos; se vazio, aceito | — |
| `barbeiro_id` | number | sim | precisa existir e `ativo = 1`; precisa executar o serviço | — |
| `servico_id` | number | sim | idem | — |
| `data` | string | sim | `dataValida` (formato + calendário) | — |
| `inicio` | string | sim | `horaValida`; **não** precisa estar em `horariosLivres` (encaixe fora do expediente é permitido); só não pode sobrepor outro atendimento nem bloqueio | — |
| `observacoes` | string | não | `trim()` | cortado em **300** |

**Sucesso — 201:**

```ts
{ id: number }   // ⚠️ só o id — não devolve o agendamento criado (diverge do POST público — I-2)
```

**Status possíveis:**

| Status | Corpo | Condição |
|---|---|---|
| 201 | `{ id: number }` | criado |
| 400 | `{ "erro": "JSON inválido." }` | JSON malformado |
| 400 | `{ "erro": "Escreva o nome do cliente." }` | `cliente_nome` < 2 |
| 400 | `{ "erro": "Telefone inválido — informe DDD + número, ou deixe em branco." }` | telefone presente mas sem 10–11 dígitos |
| 400 | `{ "erro": "Informe a data e o horário." }` | `data`/`inicio` inválidos |
| 400 | `{ "erro": "Esse serviço está desativado." }` / `"Esse profissional está desativado."` / `"<barbeiro> não atende <serviço>."` | idem POST público |
| 404 | `{ "erro": "Serviço ou profissional não encontrado." }` | id inexistente |
| 409 | `{ "erro": "<barbeiro> já atende <cliente> das <hh:mm> às <hh:mm>." }` | sobreposição com outro atendimento |
| 409 | `{ "erro": "<barbeiro> está bloqueado (<motivo ou 'ausência'>) das <hh:mm> às <hh:mm>." }` | sobreposição com bloqueio |
| 409 | `{ "erro": "Esse horário já está ocupado. Escolha outro, por favor." }` | índice único parcial |
| — | 401/403/503 (`exigirSessao`) | — |

⚠️ As mensagens 409 do encaixe **contêm o nome do outro cliente** — ok, é
tela autenticada.

---

## 4.3 `PUT /api/admin/agendamentos` (grade de horários para o encaixe)

**Autenticação:** `exigirSessao` — **403 na senha inicial**.
**Parâmetros (corpo JSON):**

| Nome | Tipo | Obrigatório | Validação |
|---|---|---|---|
| `barbeiro_id` | number | sim | `Number(...)` |
| `servico_id` | number | sim | `Number(...)` — se não existir, devolve `{ horarios: [] }` (⚠️ não 404 — I-13) |
| `data` | string | sim | **sem validação de formato** — passada direto a `horariosLivres` |

**Sucesso — 200:** `{ horarios: string[] }` — `["HH:MM", ...]` ou `[]`.

**Status possíveis:** 200 (inclusive `{ horarios: [] }` quando o serviço não
existe) · 400 `{ "erro": "JSON inválido." }` · 401/403/503 (`exigirSessao`).

---

## 4.4 `PATCH /api/admin/agendamentos/[id]`

**Autenticação:** `exigirSessao` — **403 na senha inicial**.
**Parâmetro de rota:** `id` (number). `Number("abc")` → `NaN` → **404**;
`Number("0")` → `0` → **404**.

**Corpo JSON — dois modos mutuamente exclusivos:**

**Modo A — mudança de status** (quando `status !== undefined`):

| Nome | Tipo | Obrigatório | Validação |
|---|---|---|---|
| `status` | string | sim | uma de `pendente`/`confirmado`/`concluido`/`cancelado`; a transição precisa ser legal (`pendente→confirmado\|cancelado`; `confirmado→concluido\|cancelado`; `concluido→∅`; `cancelado→pendente\|confirmado`); `concluido` exige data não-futura |

**Modo B — remarcação** (quando `status` ausente e algum de `data`/`inicio`/`barbeiro_id`/`servico_id` presente):

| Nome | Tipo | Obrigatório | Validação |
|---|---|---|---|
| `data` | string | não (mantém a atual) | `dataValida` se enviado |
| `inicio` | string | não | `horaValida` se enviado |
| `barbeiro_id` | number | não | precisa existir, `ativo = 1`, executar o serviço |
| `servico_id` | number | não | idem; recota `preco_centavos`/`duracao_min`/`fim` |

O agendamento precisa estar em `pendente` ou `confirmado` (não `concluido`
nem `cancelado`).

**Sucesso — 200:** `{ ok: true }`.

**Status possíveis:**

| Status | Corpo | Condição |
|---|---|---|
| 200 | `{ ok: true }` | mudança aplicada |
| 400 | `{ "erro": "JSON inválido." }` | JSON malformado |
| 400 | `{ "erro": "Nada para atualizar." }` | corpo sem `status` e sem nenhum campo de remarcação |
| 400 | `{ "erro": "Status inválido." }` | `status` fora dos 4 valores |
| 400 | `{ "erro": "Não é possível mudar de \"<atual>\" para \"<novo>\"." }` | transição ilegal |
| 400 | `{ "erro": "Não é possível concluir um agendamento com data futura." }` | `status = "concluido"` com `data > hoje` |
| 400 | `{ "erro": "Não é possível remarcar um agendamento concluido." }` / `"...cancelado." }` | remarcar em estado terminal |
| 400 | `{ "erro": "Esse serviço está desativado." }` / `"Esse profissional está desativado."` / `"<b> não atende <s>."` / `"Informe a data e o horário."` | validação da remarcação |
| 404 | `{ "erro": "Agendamento não encontrado." }` | `id` falsy, inexistente, ou soft-deleted |
| 404 | `{ "erro": "Serviço ou profissional não encontrado." }` | novo `barbeiro_id`/`servico_id` inexistente |
| 409 | `{ "erro": "<b> já atende <c> das ... às ..." }` / `"<b> está bloqueado (...) das ... às ..."` / `"Esse horário já está ocupado. Escolha outro, por favor."` | conflito ao remarcar / reabrir cancelado |
| — | 401/403/503 (`exigirSessao`) | — |

---

## 4.5 `DELETE /api/admin/agendamentos/[id]`

**Autenticação:** `exigirSessao` — **403 na senha inicial**.
**Parâmetro de rota:** `id` (number). Falsy → 404.
**Efeito:** soft delete (`excluido_em = datetime('now')`), não apaga a linha.

**Sucesso — 200:** `{ ok: true }`.

**Status possíveis:**

| Status | Corpo | Condição |
|---|---|---|
| 200 | `{ ok: true }` | marcado como excluído |
| 404 | `{ "erro": "Agendamento não encontrado." }` | `id` falsy, inexistente, ou já excluído |
| — | 401/403/503 (`exigirSessao`) | — |

---

# 5. Painel — cadastros dinâmicos (`recurso` ∈ `barbeiros` | `servicos` | `produtos` | `bloqueios`)

## 5.1 `GET /api/admin/[recurso]`

**Autenticação:** `exigirSessao` — **403 na senha inicial**.
**Parâmetro de rota:** `recurso`. Fora da lista → **404** `{ "erro":
"Cadastro não encontrado." }` (`__proto__`, `constructor` etc. também → 404).
**Parâmetros de query:** nenhum.

**Sucesso — 200:** `{ itens: T[] }`, onde `T` depende de `recurso`:

```ts
// recurso = "barbeiros"  (ordenado por ordem, id)
{ id: number; nome: string; funcao: string; bio: string; foto: string; ativo: 0|1; ordem: number }

// recurso = "servicos"  (via listarServicos — ordenado por ordem, id)
{ id: number; nome: string; descricao: string; categoria: string; preco_centavos: number;
  duracao_min: number; ativo: 0|1; ordem: number; imagem: string; barbeiros: number[] }

// recurso = "produtos"  (ordenado por id DESC)
{ id: number; nome: string; marca: string; preco_centavos: number; estoque: number; ativo: 0|1; imagem: string }

// recurso = "bloqueios"  (via listarBloqueios — ordenado por data DESC, inicio)
{ id: number; barbeiro_id: number | null; data: string; inicio: string; fim: string; motivo: string;
  barbeiro_nome: string | null }   // null quando barbeiro_id é null ("toda a equipe") ou o barbeiro foi apagado
```

**Status possíveis:** 200 · 404 `{ "erro": "Cadastro não encontrado." }` ·
401/403/503 (`exigirSessao`).

---

## 5.2 `POST /api/admin/[recurso]`

**Autenticação:** `exigirSessao` — **403 na senha inicial**.
**Parâmetro de rota:** `recurso`. Fora da lista → 404 "Cadastro não
encontrado.".

**Parâmetros (corpo JSON)** — só colunas da whitelist do recurso são lidas
(`filtrarCampos`); numéricas com lixo → `0` sem erro (Etapa 5 F25):

| `recurso` | Campos aceitos | Obrigatório | Validação (`validar`, `criando: true`) |
|---|---|---|---|
| `barbeiros` | `nome`, `funcao`, `bio`, `foto`, `ativo`, `ordem` | `nome` | `nome` ≤ 80; `funcao` ≤ 60; `bio` ≤ 500; `foto` ≤ 300; `ordem` inteiro 0–9999 |
| `servicos` | `nome`, `descricao`, `categoria`, `preco_centavos`, `duracao_min`, `imagem`, `ativo`, `ordem`, `barbeiros[]` | `nome` | `descricao` ≤ 500; `categoria` ≤ 60; `preco_centavos` inteiro 0–10 000 000; `duracao_min` inteiro 5–480; `imagem` ≤ 300; `ordem` 0–9999. `barbeiros[]` é lido fora de `validar` — `INSERT OR IGNORE` (ids inexistentes/inválidos são silenciosamente descartados) |
| `produtos` | `nome`, `marca`, `preco_centavos`, `estoque`, `imagem`, `ativo` | `nome` | `marca` ≤ 60; `preco_centavos` 0–10 000 000; `estoque` inteiro 0–100 000; `imagem` ≤ 300 |
| `bloqueios` | `barbeiro_id` (nullable), `data`, `inicio`, `fim`, `motivo` | `data`, `inicio`, `fim` | `data` formato+calendário; `inicio`/`fim` `HH:MM` válido; `fim > inicio`; `motivo` ≤ 200. `barbeiro_id` textual → coerção para `0` → **FK falha → 500** |

**Sucesso — 201:**

```ts
// recurso != "bloqueios":
{ id: number; atropelados: undefined }   // a chave "atropelados" fica ausente no JSON

// recurso == "bloqueios":
{
  id: number;
  atropelados: Array<{                    // agendamentos ativos que caem dentro do intervalo bloqueado; [] se nenhum
    id: number;
    cliente_nome: string;
    cliente_telefone: string;
    data: string;
    inicio: string;
  }>;
}
```

⚠️ `atropelados` só existe para `bloqueios` — para os outros a chave é omitida
(I-10). O front-end precisa tratar `undefined`.

**Status possíveis:**

| Status | Corpo | Condição |
|---|---|---|
| 201 | shape acima | criado |
| 400 | `{ "erro": "<primeira mensagem>", "erros": { "<coluna>": "<mensagem>" } }` | falha de validação (⚠️ único formato de erro com mapa por campo — I-4) |
| 400 | `{ "erro": "Nada para salvar." }` | nenhuma coluna conhecida no corpo |
| 400 | `{ "erro": "JSON inválido." }` | JSON malformado |
| 404 | `{ "erro": "Cadastro não encontrado." }` | `recurso` fora da lista |
| — | 401/403/503 (`exigirSessao`) | — |
| 500 | genérico | violação de FK/CHECK que a validação não pegou (ex.: `barbeiro_id` textual num bloqueio) |

---

## 5.3 `PATCH /api/admin/[recurso]/[id]`

**Autenticação:** `exigirSessao` — **403 na senha inicial**.
**Parâmetros de rota:** `recurso`, `id` (number). `!recurso || !id` → **404**
`{ "erro": "Item não encontrado." }` (⚠️ mensagem diferente do `POST`/`GET`
da coleção — I-4).

**Corpo JSON:** subconjunto das colunas da whitelist (atualização parcial —
só os campos enviados são alterados). Validação por `validar` **sem
`criando`** — não cobra obrigatórios, mas checa faixa/formato dos campos
presentes. ⚠️ `PATCH bloqueios` parcial só com `fim` (menor que o `inicio`
gravado) não é pego pelo `validar` → `CHECK` do banco → **500** (Etapa 5 F25).

**Sucesso — 200:** `{ ok: true }`.

**Status possíveis:**

| Status | Corpo | Condição |
|---|---|---|
| 200 | `{ ok: true }` | atualizado (`changes > 0`) |
| 400 | `{ "erro": "<msg>", "erros": {...} }` | falha de validação |
| 400 | `{ "erro": "Nada para salvar." }` | nenhuma coluna conhecida no corpo |
| 400 | `{ "erro": "JSON inválido." }` | JSON malformado |
| 404 | `{ "erro": "Item não encontrado." }` | `recurso` inválido, `id` falsy, ou `UPDATE` afetou 0 linhas |
| — | 401/403/503 (`exigirSessao`) | — |

---

## 5.4 `DELETE /api/admin/[recurso]/[id]`

**Autenticação:** `exigirSessao` — **403 na senha inicial**.
**Parâmetros de rota:** `recurso`, `id` (number). Falsy → 404 "Item não
encontrado.".

Para `barbeiros`/`servicos`: se houver **qualquer** agendamento referenciando
o id (incluindo cancelados e soft-deleted), **desativa** (`ativo = 0`) em vez
de apagar. Para `produtos` e `bloqueios`: sempre `DELETE` físico.

**Sucesso — 200, duas formas:**

```ts
// apagado de verdade:
{ ok: true }

// desativado por ter histórico (só barbeiros/servicos):
{ ok: true; desativado: true;
  mensagem: "Tem histórico de atendimento, então foi desativado em vez de excluído. Some do site e do agendamento." }
```

**Status possíveis:**

| Status | Corpo | Condição |
|---|---|---|
| 200 | `{ ok: true }` **ou** `{ ok: true, desativado: true, mensagem }` | apagado ou desativado |
| 404 | `{ "erro": "Item não encontrado." }` | `recurso` inválido, `id` falsy, ou 0 linhas afetadas |
| — | 401/403/503 (`exigirSessao`) | — |

---

# 6. Painel — resumo

## 6.1 `GET /api/admin/resumo`

**Autenticação:** `exigirSessao` — **403 na senha inicial**.
**Parâmetros (query string):**

| Nome | Tipo | Default | Validação |
|---|---|---|---|
| `mes` | string | mês atual (fuso da barbearia) | usado só se casar `^\d{4}-\d{2}$`, senão ignorado |
| `comparar` | string | `mes` menos 1 mês | idem |

**Sucesso — 200:**

```ts
{
  hoje: {
    data: string;             // "AAAA-MM-DD" (fuso da barbearia)
    total: number;            // ⚠️ CONTAGEM de agendamentos de hoje, INCLUINDO cancelados (I-8, I-14)
    realizado: number;        // centavos, status = concluido
    previsto: number;         // centavos, status in (pendente, confirmado)
    confirmados: number;      // contagem
    pendentes: number;        // contagem
    agenda: Array<{
      id: number; nome: string; foto: string;
      atendimentos: number;   // contagem do dia (exclui cancelado)
      primeiro: string | null; // "HH:MM" — MIN(inicio); null se o barbeiro não tem agendamento hoje
      ultimo: string | null;   // "HH:MM" — MAX(fim); null idem
    }>;                       // um item por barbeiro ativo, ordenado por (ordem, id)
    recentes: AgendamentoRow[]; // últimos 8 por criado_em DESC — inclui cliente_telefone e criado_em (UTC)
  };
  pendentesTotal: number;     // contagem de TODOS os pendentes não-excluídos (não só de hoje)
  financeiro: {
    principal: TotaisDoMes;   // do parâmetro `mes`
    comparacao: TotaisDoMes;  // do parâmetro `comparar`
    serie: Array<{ mes: string; total: number }>;           // 12 meses terminando em `mes`; "total" = realizado+previsto em CENTAVOS (I-8)
    serieAnoAnterior: Array<{ mes: string; total: number }>; // os mesmos 12 meses, um ano antes
    porServico: Array<{ id: number | null; nome: string; quantidade: number; total: number }>; // top 8 por quantidade; "total" = CENTAVOS; id null se serviço apagado
    porBarbeiro: Array<{ id: number | null; nome: string; quantidade: number; total: number }>; // ordenado por total (centavos) DESC
    geral: {
      realizado: { atendimentos: number; faturamento: number; ticket: number }; // TODO o histórico concluído
      previsto:  { atendimentos: number; faturamento: number; ticket: number }; // TODO o histórico pendente+confirmado
    };
  };
}

type TotaisDoMes = {
  mes: string;                // "AAAA-MM"
  realizado: { atendimentos: number; faturamento: number; ticket: number };
  previsto:  { atendimentos: number; faturamento: number; ticket: number };
  cancelados: number;         // contagem
};
```

`ticket` = `Math.round(faturamento / atendimentos)` ou `0` se
`atendimentos === 0`. Todos os valores monetários em **centavos**.

**Status possíveis:** 200 · 401/403/503 (`exigirSessao`).

---

## 6.2 `GET /api/admin/pendentes`

**Autenticação:** `exigirSessao` — **403 na senha inicial**.
**Parâmetros:** nenhum.

**Sucesso — 200:** `{ total: number }` — contagem de agendamentos
`status = 'pendente' AND excluido_em IS NULL` (⚠️ "total" aqui é contagem —
I-8).

**Status possíveis:** 200 · 401/403/503 (`exigirSessao`).

---

# Inconsistências entre endpoints

## I-1 · Status de criação: 200 vs 201

| Endpoint | Hoje |
|---|---|
| `POST /api/agendamentos` (público) | **200** |
| `POST /api/admin/agendamentos` (encaixe) | 201 |
| `POST /api/admin/[recurso]` | 201 |
| `POST /api/admin/upload` | 201 |

**Forma canônica:** **201** para toda criação de recurso.
**Mudaria:** `POST /api/agendamentos` passa a responder 201.

## I-2 · Corpo da criação: objeto completo vs só `id`

| Endpoint | Hoje |
|---|---|
| `POST /api/agendamentos` | `{ agendamento: {...12 campos...}, whatsapp_barbearia }` |
| `POST /api/admin/agendamentos` | `{ id }` |
| `POST /api/admin/[recurso]` | `{ id, atropelados? }` |

O front público precisa do snapshot para a tela de confirmação + link de
WhatsApp, o que justifica o corpo gordo. Mas o encaixe do painel, para exibir
o agendamento recém-criado, precisa de um GET a mais.
**Forma canônica:** toda criação devolve pelo menos `{ id }`; quando o
recurso completo é útil de imediato, devolvê-lo sob a **mesma** chave e com o
**mesmo shape** da listagem correspondente (ver I-8).
**Mudaria:** `POST /api/admin/agendamentos` devolve `{ id, agendamento:
AgendamentoRow }` (mesmo shape de `GET /api/admin/agendamentos`.itens).

## I-3 · Mensagem de JSON malformado

| Endpoint | Hoje |
|---|---|
| `POST /api/agendamentos` | `"Não consegui ler os dados enviados."` |
| Todas as rotas do painel | `"JSON inválido."` |

**Forma canônica:** uma frase, amigável, em todo lugar: **`"Não consegui ler
os dados enviados."`** (o `"JSON inválido."` vaza jargão para uma tela que
pode ser vista pelo cliente em rotas futuras).
**Mudaria:** `login`, `senha`, `config` (PUT), `upload` (n/a — form-data),
`admin/agendamentos` (POST/PUT), `admin/agendamentos/[id]` (PATCH),
`admin/[recurso]` (POST), `admin/[recurso]/[id]` (PATCH).

## I-4 · "Não encontrado": três mensagens para conceitos parecidos, e formato de erro de validação

| Situação | Hoje |
|---|---|
| `recurso` fora da lista, em `GET`/`POST /api/admin/[recurso]` | 404 `{ erro: "Cadastro não encontrado." }` |
| `recurso` fora da lista **ou** `id` inválido, em `[recurso]/[id]` | 404 `{ erro: "Item não encontrado." }` |
| `id` inexistente em `agendamentos/[id]` | 404 `{ erro: "Agendamento não encontrado." }` |
| Falha de validação em `[recurso]` (POST/PATCH) | `{ erro, erros: {<coluna>: <msg>} }` |
| Falha de validação em qualquer outra rota | `{ erro }` só |

**Forma canônica:**
- Distinguir **tipo de cadastro desconhecido** (`{ erro: "Cadastro não
  encontrado." }`) de **registro não encontrado** (`{ erro: "<Recurso> não
  encontrado." }`). O `[recurso]/[id]` deve usar "Cadastro não encontrado."
  quando o `recurso` é inválido, e "Registro não encontrado." quando é o `id`.
- Formato de erro de validação: **sempre** `{ erro: string; erros?:
  Record<string,string> }`, com `erros` presente só quando há mapa por campo.
  Documentar `erros` como opcional (é o que já acontece — só falta o
  front-end saber que só as rotas `[recurso]` o preenchem).
**Mudaria:** `PATCH`/`DELETE /api/admin/[recurso]/[id]` (mensagem 404).

## I-5 · Falha de senha: 401 vs 400

| Endpoint | Hoje |
|---|---|
| `POST /api/admin/login` (senha errada) | **401** `"Senha incorreta."` |
| `POST /api/admin/senha` (`senhaAtual` errada) | **400** `"A senha atual está incorreta."` |

Ambos são falha de autenticação (o segundo é uma reautenticação).
**Forma canônica:** **401** para credencial que não confere.
**Mudaria:** `POST /api/admin/senha` responde 401 quando `senhaAtual` não
bate (mantém 400 para os demais erros de forma da senha nova).

## I-6 · `/api/health` não usa o campo `erro`

Todo corpo de erro do sistema é `{ erro: string }`. O health usa `{ ok:
false }` sem `erro`.
**Forma canônica:** para um probe, `{ ok: boolean }` basta; mas por
consistência o 503 poderia ser `{ ok: false, erro: "<motivo curto>" }` (ver
Etapa 7 F32, que pede um `motivo` de diagnóstico de qualquer forma).
**Mudaria:** `GET /api/health` (503).

## I-7 · `GET /api/admin/sessao` tem shape condicional incompleto

| Ramo | Campos |
|---|---|
| Config insegura | `{ autenticado: false, configuracaoInsegura: true }` — **sem** `senhaInicial` |
| Normal | `{ autenticado, senhaInicial }` — **sem** `configuracaoInsegura` |

**Forma canônica:** sempre os três: `{ autenticado: boolean; senhaInicial:
boolean; configuracaoInsegura: boolean }`.
**Mudaria:** `GET /api/admin/sessao` (os dois ramos).

## I-8 · Nomeação de campo divergente para a mesma entidade

**(a) Agendamento no corpo de `POST /api/agendamentos`** usa `cliente`,
`telefone`, `barbeiro`, `servico` — enquanto toda listagem (`AgendamentoRow`)
usa `cliente_nome`, `cliente_telefone`, `barbeiro_nome`, `servico_nome`.

**(b) "total"** significa coisas diferentes:
- contagem de linhas: `GET /api/admin/agendamentos`.`total`,
  `pendentes`.`total`, `resumo.hoje.total`;
- soma em centavos: `resumo.financeiro.serie[].total`,
  `porServico[].total`, `porBarbeiro[].total`.

**(c) soma de dinheiro** é ora `total`, ora `faturamento`
(`resumo.financeiro.geral.*.faturamento`, `TotaisDoMes.*.faturamento`).

**Forma canônica:**
- O agendamento devolvido pela API usa **sempre** as chaves de
  `AgendamentoRow` (`cliente_nome`, `cliente_telefone`, `barbeiro_nome`,
  `servico_nome`).
- **`total` = sempre contagem.** Soma de dinheiro = **`faturamento`** (ou
  `faturamento_centavos`).
**Mudaria:** `POST /api/agendamentos` (renomeia 4 campos do objeto
`agendamento`); `resumo` (`serie[].total`, `serieAnoAnterior[].total`,
`porServico[].total`, `porBarbeiro[].total` → `faturamento`).

## I-9 · Convenção de data/hora: `criado_em`/`excluido_em` em UTC

`data`, `inicio`, `fim`, `abre`, `fecha`, `mes`, `hoje.data` — todos no fuso
da barbearia. `criado_em` e `excluido_em` (presentes em `AgendamentoRow`,
logo em `resumo.hoje.recentes` e `GET /api/admin/agendamentos`.`itens`) — em
**UTC** (`datetime('now')` do SQLite), com 3 h de diferença e data errada
entre 21:00 e 23:59 locais.
**Forma canônica:** todo timestamp da API no fuso da barbearia. Enquanto não
se corrige na fonte (Etapa 3 F14), **o contrato declara `criado_em`/
`excluido_em` como UTC** e o front-end converte.
**Mudaria:** conceitualmente, toda rota que devolve `AgendamentoRow`
(`GET /api/admin/agendamentos`, `GET /api/admin/resumo`). `excluido_em` é
sempre `null` nas respostas atuais (toda leitura filtra) — pode ser omitido
do contrato até existir um endpoint que devolva excluídos.

## I-10 · `null` vs `undefined` vs `[]` vs `""`

- **`""`** para texto não preenchido — consistente (imposto por schema
  `NOT NULL DEFAULT ''`): `foto`, `imagem`, `logo_url`, `barbeiro_nome`,
  `servico_nome`, valores de `config`.
- **`null`** para "ausência semântica" — consistente: `bloqueios.barbeiro_id`
  (`null` = toda a equipe), `bloqueios.barbeiro_nome` (`null` no LEFT JOIN),
  `resumo.agenda[].primeiro`/`ultimo` (`null` = sem agendamento),
  `porServico[].id`/`porBarbeiro[].id` (`null` = cadastro apagado).
- **`undefined` (chave omitida)** — o ponto fora da curva:
  `POST /api/admin/[recurso]`.`atropelados` só existe quando `recurso ===
  "bloqueios"`; nos outros a chave **não aparece** no JSON.
**Forma canônica:** nunca omitir uma chave que faz parte do shape — usar
`[]` quando o conceito se aplica e está vazio, e não incluir a chave (ou usar
`null`) quando não se aplica. Para `atropelados`: devolvê-lo como `[]` sempre
que `recurso === "bloqueios"`, e **não incluir a chave** para os demais.
**Mudaria:** `POST /api/admin/[recurso]` (resposta 201).

## I-11 · `PUT /api/admin/config` não espelha o `GET`

`GET` devolve `{ config, expediente, senhaInicial, fuso }`; `PUT` devolve só
`{ config, expediente }`.
**Forma canônica:** o `PUT` devolve o mesmo shape do `GET` (inclui
`senhaInicial` e `fuso`), para o front-end poder atualizar o estado inteiro
com a resposta de uma escrita.
**Mudaria:** `PUT /api/admin/config` (resposta 200).

## I-12 · Sem `Retry-After` nos 429

`POST /api/agendamentos` e `POST /api/admin/login` devolvem 429 sem header
`Retry-After` nem campo no corpo dizendo quanto esperar.
**Forma canônica:** incluir `Retry-After: <segundos>` (e/ou `{ erro,
retryAfter: <segundos> }`) para o front-end poder mostrar uma contagem.
**Mudaria:** `POST /api/agendamentos`, `POST /api/admin/login`.

## I-13 · "Buscar horários livres": 404 vs lista vazia para serviço inexistente

`GET /api/horarios` → **404** `{ erro: "Serviço indisponível." }` se o
serviço não existe/está inativo.
`PUT /api/admin/agendamentos` → **200** `{ horarios: [] }` na mesma condição.
**Forma canônica:** as duas rotas fazem a mesma coisa (grade de horários) —
devem falhar igual. Recomendação: **404 nas duas** para serviço
inexistente/inativo; `{ horarios: [] }` reservado para "existe mas não há
vaga".
**Mudaria:** `PUT /api/admin/agendamentos` (passa a 404 quando o serviço não
existe).

## I-14 · `resumo.hoje.total` conta cancelados; as somas na mesma resposta não

`resumo.hoje.total` é `COUNT(*)` de hoje **sem** filtrar `cancelado`;
`realizado`/`previsto`/`confirmados`/`pendentes` na mesma estrutura ignoram
cancelado. A tela mostra "N agendamentos hoje" e a lista logo abaixo (que
filtra cancelado) mostra menos.
**Forma canônica:** definir `total` como "agendamentos que vão acontecer"
(exclui cancelado) — ou renomear para `totalIncluindoCancelados` e adicionar
`total` sem cancelados. Documentar a escolha.
**Mudaria:** `GET /api/admin/resumo` (`hoje.total`).

---

## Resumo das divergências por endpoint

| Endpoint | Inconsistências que o tocam |
|---|---|
| `POST /api/agendamentos` | I-1, I-2, I-3, I-8(a), I-12 |
| `GET /api/health` | I-6 |
| `POST /api/admin/login` | I-3, I-5, I-12 |
| `GET /api/admin/sessao` | I-7 |
| `PUT /api/admin/config` | I-3, I-11 |
| `POST /api/admin/senha` | I-3, I-5 |
| `POST /api/admin/agendamentos` | I-2, I-3 |
| `PUT /api/admin/agendamentos` | I-3, I-13 |
| `PATCH /api/admin/agendamentos/[id]` | I-3 |
| `POST /api/admin/[recurso]` | I-3, I-4, I-10 |
| `PATCH`/`DELETE /api/admin/[recurso]/[id]` | I-3, I-4 |
| `GET /api/admin/agendamentos` | I-8(b), I-9 |
| `GET /api/admin/resumo` | I-8(b)(c), I-9, I-14 |
| `GET /api/admin/pendentes` | I-8(b) |
