# 10 — Contrato da API

Toda a API vive em `src/app/api/**` (Route Handlers do Next). Respostas em
`application/json`.

> **Referência detalhada campo a campo:** [`../auditoria/08-contrato.md`](../auditoria/08-contrato.md)
> descreve corpo, parâmetros, validações e todos os códigos de status de cada
> endpoint até a migration 5. Este documento é o **índice atualizado**, cobre
> as rotas novas da **migration 6** (login por barbeiro, bootstrap,
> recuperação de senha, perfil), lista os endpoints `[PLANEJADO]` e reúne as
> inconsistências conhecidas como backlog. Quando a auditoria for migrada para
> cá por inteiro, esta nota sai.

---

## 1. Regras gerais

- Todo handler é embrulhado por `comLog`. Exceção não tratada → **500**
  `{ "erro": "Algo deu errado. Tente de novo em instantes." }`.
- Corpo vazio → `{}` (a validação de campo reclama). JSON malformado → **400**.
- Datas `AAAA-MM-DD`, horas `HH:MM`, mês `AAAA-MM`, no fuso da barbearia.
  Exceção: `criado_em` e `excluido_em` são `AAAA-MM-DD HH:MM:SS` em **UTC**.
- `ativo` e `aberto` são inteiros `0` ou `1`, nunca booleanos.
- Texto não preenchido vem como `""`, nunca `null`.
- Rotas sob `/api/admin/**` (fora de `login`, `logout`, `sessao`,
  `esqueci-senha`, `redefinir-senha`) passam por `exigirSessao`, que pode
  responder antes: **503** (servidor inseguro em produção), **401** (sem
  sessão válida), **403** (`Origin` divergente, ou senha inicial não trocada).

---

## 2. Índice de endpoints — situação atual

### Públicos (sem autenticação)

| Método · Rota            | Função                                                                                                                                                     | Notas                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `GET /api/public`        | Catálogo do site: barbearia, serviços, equipe, dias. `?barbeiro=<id>` filtra `dias` por aquele profissional; sem o parâmetro, `dias` é a união dos ativos. | 200 sempre (salvo 500).                                                 |
| `GET /api/horarios`      | Horários livres de um par profissional + serviço num dia                                                                                                   | 400 sem parâmetros · 404 serviço inativo.                               |
| `POST /api/agendamentos` | Agendamento do cliente                                                                                                                                     | Rate limit `agendar:<ip>` 6/10min · 200 (não 201) · 409 conflito · 429. |
| `GET /api/health`        | Health check (banco + escrita em uploads)                                                                                                                  | 200 `{ ok: true }` ou 503 `{ ok: false }`.                              |

### Autenticação e conta do painel

| Método · Rota                                     | Auth                                       | Função                                                                                                      |
| ------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `POST /api/admin/login`                           | nenhuma + rate limit                       | Bootstrap: `{ senha }`. Normal: `{ email, senha }`. Emite cookie `admin_sessao`.                            |
| `POST /api/admin/logout`                          | nenhuma                                    | Apaga o cookie no cliente. Sempre `{ ok: true }`.                                                           |
| `GET /api/admin/sessao`                           | nenhuma                                    | Sonda: `{ autenticado, modoBootstrap, barbeiro? }` ou `{ autenticado: false, configuracaoInsegura: true }`. |
| `POST /api/admin/bootstrap`                       | sessão de bootstrap                        | Conclui a configuração inicial; cria/promove o primeiro admin.                                              |
| `POST /api/admin/esqueci-senha`                   | nenhuma + rate limit                       | Dispara e-mail de redefinição. Resposta sempre genérica.                                                    |
| `POST /api/admin/redefinir-senha`                 | token                                      | Consome o token e grava a nova senha.                                                                       |
| `GET /api/admin/perfil`                           | sessão de barbeiro                         | `{ nome, email, papel }` da sessão.                                                                         |
| `PATCH /api/admin/perfil`                         | sessão de barbeiro                         | Troca o próprio e-mail (confirma `senhaAtual`).                                                             |
| `POST /api/admin/perfil/senha`                    | sessão de barbeiro                         | Troca a própria senha (mín. 6, diferente da atual).                                                         |
| `POST /api/admin/senha`                           | `exigirSessao` (liberado na senha inicial) | Troca a senha de bootstrap; sobe `sessao_versao`.                                                           |
| `POST /api/admin/barbeiros/[id]/reenviar-convite` | sessão de barbeiro                         | Reenvia o link de ativação de conta a um profissional.                                                      |

### Agenda e cadastros

| Método · Rota                              | Função                                                                                                           |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `GET /api/admin/agendamentos`              | Lista com busca, filtros (status, profissional, data) e paginação.                                               |
| `POST /api/admin/agendamentos`             | Encaixe manual (permite fora do expediente). 201 `{ id }`.                                                       |
| `PUT /api/admin/agendamentos`              | Grade de horários para o encaixe.                                                                                |
| `PATCH /api/admin/agendamentos/[id]`       | Modo A: mudança de status (transições legais). Modo B: remarcação.                                               |
| `DELETE /api/admin/agendamentos/[id]`      | Soft delete (`excluido_em`).                                                                                     |
| `GET /api/admin/[recurso]`                 | Lista `barbeiros` · `servicos` · `produtos` · `bloqueios`.                                                       |
| `POST /api/admin/[recurso]`                | Cria; para `bloqueios` devolve `atropelados`.                                                                    |
| `PATCH /api/admin/[recurso]/[id]`          | Atualização parcial.                                                                                             |
| `DELETE /api/admin/[recurso]/[id]`         | Apaga; `barbeiros`/`servicos` com histórico → desativa.                                                          |
| `GET /api/admin/barbeiros/[id]/expediente` | Os 7 dias de `expediente_barbeiro` do profissional + as `folgas` (dias da semana). 404 profissional inexistente. |
| `PUT /api/admin/barbeiros/[id]/expediente` | Grava `{ expediente?, folgas? }` do profissional. 400 `fecha <= abre` ou nada para salvar · 404 inexistente.     |
| `POST /api/admin/upload`                   | `multipart/form-data`; valida magic number, reprocessa com `sharp`. 201 `{ url }`.                               |

### Resumo

| Método · Rota              | Função                                                                       |
| -------------------------- | ---------------------------------------------------------------------------- |
| `GET /api/admin/resumo`    | Painel do dia + agregados financeiros do mês (parâmetros `mes`, `comparar`). |
| `GET /api/admin/pendentes` | Contagem de agendamentos `pendente`.                                         |

---

## 3. Rotas novas da migration 6 — detalhe

### `POST /api/admin/login` (formato atual)

| Cenário        | Corpo aceito       | Sucesso                                                   |
| -------------- | ------------------ | --------------------------------------------------------- |
| Modo bootstrap | `{ senha }`        | `{ ok: true, modoBootstrap: true }` + cookie de bootstrap |
| Modo normal    | `{ email, senha }` | `{ ok: true, modoBootstrap: false }` + cookie de barbeiro |

Erros: **400** JSON inválido · **401** `"Senha incorreta."` (bootstrap) ou
`"E-mail ou senha incorretos."` (normal) · **429** rate limit por IP ou global
· **503** servidor inseguro em produção. O `scrypt` roda mesmo quando o e-mail
não existe (não vaza existência pelo tempo de resposta).

### `POST /api/admin/bootstrap`

Exige sessão de bootstrap. Corpo: `{ barbeiroId?, nome?, email, senha, confirmacao }`
— informe `barbeiroId` (promove um profissional existente) **ou** `nome` (cria
um novo). Regras: e-mail válido; senha ≥ 6; `senha === confirmacao`.

- **200** `{ ok: true }` (e nova sessão de barbeiro).
- **400** e-mail inválido, senha curta, confirmação divergente, ou `resultado.erro`.
- **403** a sessão não é de bootstrap.
- **409** `"A configuração inicial já foi concluída."`.

### `POST /api/admin/esqueci-senha`

Corpo: `{ email }`. Rate limit: 5/15min por IP, 3/60min por e-mail (hasheado).
**Sempre 200** `{ ok: true, mensagem }` com a mesma frase, exista o e-mail ou
não. Se existir e `login_ativo`, envia link `\/admin?token=…` (token válido por
**30 min**, uso único). **429** ao estourar o limite. Falha de envio de e-mail
**não** muda a resposta.

### `POST /api/admin/redefinir-senha`

Corpo: `{ token, novaSenha, confirmacao }`. Regras: token não vazio; senha ≥ 6;
`novaSenha === confirmacao`.

- **200** `{ ok: true }` — grava a senha, marca o token usado, apaga os pendentes do barbeiro, sobe `barbeiros.sessao_versao`.
- **400** `"Link inválido ou expirado."` para token inexistente, expirado **ou** já usado (sem distinguir).
- Não existe endpoint de "validar token" isolado, de propósito.

### `GET` / `PATCH /api/admin/perfil` e `POST /api/admin/perfil/senha`

Exigem sessão do tipo `barbeiro` (**403** para sessão de bootstrap).

- `GET` → `{ nome, email, papel }`.
- `PATCH` `{ email, senhaAtual }` → troca o e-mail; **400** e-mail inválido ou `senhaAtual` errada. Auditado como `trocar_email` (sem o e-mail no registro).
- `POST .../senha` `{ senhaAtual, novaSenha, confirmacao }` → **400** se a nova tiver menos de 6, não bater com a confirmação, ou for igual à atual. Auditado como `trocar_senha`.

### `POST /api/admin/barbeiros/[id]/reenviar-convite`

Exige sessão de barbeiro. **400** se o profissional não tem e-mail ou está com
login desativado · **404** profissional inexistente · **502** falha no envio ·
**200** `{ ok: true }` (auditado como `reenviar_convite`).

### `GET /api/admin/sessao` — formato atual

```ts
// servidor inseguro:
{ autenticado: false, configuracaoInsegura: true }
// deslogado:
{ autenticado: false, modoBootstrap: boolean }
// sessão de bootstrap:
{ autenticado: true, modoBootstrap: true }
// sessão de barbeiro:
{ autenticado: true, modoBootstrap: false, barbeiro: { id, nome, email, papel } }
```

---

## 4. Variáveis de ambiente que afetam a API

| Variável         | Efeito na API                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| `SESSION_SECRET` | Assina o cookie de sessão. Ausente em produção → **503** em todo o painel.                            |
| `ADMIN_PASSWORD` | Senha de bootstrap, enquanto ninguém concluiu a configuração inicial.                                 |
| `TRUST_PROXY`    | `1` faz o rate limiter usar `X-Forwarded-For` / `X-Real-IP` como IP; senão todos caem na mesma chave. |
| `APP_URL`        | Base dos links de e-mail (`\/admin?token=…`).                                                         |
| `EMAIL_PROVIDER` | `console` (imprime o e-mail no log) ou SMTP em produção.                                              |
| `TZ`             | Fuso de todo cálculo de data/hora nas respostas.                                                      |

---

## 5. Endpoints `[PLANEJADO]`

Vocabulário provável; o contrato fino sai quando o módulo for implementado.

| Área                        | Endpoints previstos                                                                                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conta do cliente            | `POST /api/conta/cadastro` (e-mail obrigatório) · `POST /api/conta/login` · `POST /api/conta/esqueci-senha` · `POST /api/conta/redefinir-senha` · `GET`/`PATCH /api/conta/perfil` · `DELETE /api/conta` (LGPD, anonimiza)                   |
| Agendamento do cliente      | `POST /api/agendamentos` passa a **exigir sessão de cliente** (RN-50) · `GET /api/conta/agendamentos` · `POST /api/conta/agendamentos/[id]/cancelar` · `POST /api/conta/agendamentos/[id]/remarcar` (corte de 30 min)                       |
| Lembretes                   | `PUT /api/conta/lembretes` (só a antecedência; canal é sempre WhatsApp + e-mail)                                                                                                                                                            |
| No-show                     | `PATCH /api/admin/agendamentos/[id]` aceita `status: "no-show"` (reversão pelo admin); a marcação em massa é feita pela rotina de tarefas                                                                                                   |
| Rotinas (agendador externo) | `POST /api/tarefas/lembretes` · `POST /api/tarefas/marcar-no-show` · `POST /api/tarefas/limpeza` — autenticadas por um **segredo** em header (`X-Tarefa-Segredo`), não por sessão (RNF-22)                                                  |
| Comandas                    | `GET`/`POST /api/admin/comandas` · `POST /api/admin/comandas/[id]/itens` (valida estoque) · `POST /api/admin/comandas/[id]/fechar` (exige agendamento `concluido`; corpo com 1..N pagamentos)                                               |
| Caixa                       | `POST /api/admin/caixa/abrir` · `POST /api/admin/caixa/fechar` · `GET`/`POST /api/admin/caixa/movimentos` (`tipo`: `sangria`, `reforco`, `troco`, `entrada_avulsa`, `saida_avulsa`, `pagamento`) · `GET`/`POST /api/admin/formas-pagamento` |
| Relatórios                  | `GET /api/admin/relatorios` com filtros de período, profissional, serviço, forma de pagamento (só leitura; sem exportação)                                                                                                                  |
| Clientes / bad-list         | `GET /api/admin/clientes` · `GET /api/admin/clientes/[id]` (histórico, classificação novo/recorrente derivada, situação da bad-list)                                                                                                        |
| Notificações                | `GET /api/admin/notificacoes` · `POST /api/admin/notificacoes/[id]/lida`                                                                                                                                                                    |
| 2FA                         | `POST /api/admin/2fa/ativar` · `POST /api/admin/2fa/confirmar` · `POST /api/admin/login` passa a exigir o código TOTP para `admin`/`superadmin` (obrigatório — RN-40)                                                                       |
| Superadmin                  | `GET /api/sistema/status` · `POST /api/sistema/backup` · `GET /api/sistema/logs` — só papel `superadmin`                                                                                                                                    |

---

## 6. Inconsistências conhecidas (backlog)

Detalhe e "forma canônica" de cada uma em [`../auditoria/08-contrato.md`](../auditoria/08-contrato.md#inconsistências-entre-endpoints).
São dívidas de contrato a resolver antes de considerar a API estável — não bugs
de comportamento.

| Ref  | Resumo                                                                                      |
| ---- | ------------------------------------------------------------------------------------------- |
| I-1  | `POST /api/agendamentos` responde 200; as outras criações respondem 201.                    |
| I-2  | Criação ora devolve o objeto completo, ora só `{ id }`.                                     |
| I-3  | Mensagem de JSON malformado difere entre o fluxo público e o painel.                        |
| I-4  | Três mensagens de "não encontrado" e formato de erro de validação só nas rotas `[recurso]`. |
| I-5  | Senha errada é 401 no `login` e 400 no `senha`.                                             |
| I-6  | `GET /api/health` não usa o campo `erro`.                                                   |
| I-7  | `GET /api/admin/sessao` tem shape condicional incompleto.                                   |
| I-8  | `total` ora é contagem, ora dinheiro; nomes divergentes para a mesma entidade.              |
| I-9  | `criado_em` / `excluido_em` em UTC, o resto no fuso da barbearia.                           |
| I-10 | Chave `atropelados` omitida quando não se aplica, em vez de `[]`/ausente consistente.       |
| I-11 | `PUT /api/admin/config` não devolve o mesmo shape do `GET`.                                 |
| I-12 | 429 sem `Retry-After`.                                                                      |
| I-13 | Serviço inexistente: 404 em `/api/horarios`, lista vazia em `PUT /api/admin/agendamentos`.  |
| I-14 | `resumo.hoje.total` conta cancelados; as somas ao lado não.                                 |

> A auditoria foi escrita antes da migration 6; `AgendamentoRow` lá ainda lista
> quatro status. Ao migrar o contrato para cá, acrescentar `no-show` e as
> rotas de conta do cliente.
