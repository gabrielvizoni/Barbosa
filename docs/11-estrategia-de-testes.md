# 11 — Estratégia de testes

Os testes cobrem a lógica que não pode quebrar em silêncio: cálculo de
disponibilidade, integridade da escrita de agendamento, máquina de estados,
autenticação e validação de entrada. A interface (componentes React, fluxo no
navegador) **não** é testada automaticamente — é uma escolha, revista abaixo.

---

## 1. Ferramenta e execução

- **Runner nativo do Node** (`node --test`). Sem Jest, sem Vitest, sem
  dependência de teste além do `prettier` (que é de formatação).
- Comando: `npm test` → `node --import ./tests/register-hooks.mjs --test "tests/*.test.js"`.
- Estado atual: **136 testes, 136 passando, 0 falhando** (`npm test` executado).
- Duração típica: ~1,3 s.

Ao mudar a contagem, atualize também o número no `README.md` da raiz (badge e
seção "Em números").

---

## 2. Níveis de teste

| Nível            | O que exercita                                                                                                               | Como                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Unitário**     | Funções puras de `src/lib/**` — `slots`, `validacao`, `format`, `datas-cliente`, `requisicao`, `log`.                        | Chamada direta, sem banco.                                                                                          |
| **Integração**   | Rotas e funções de domínio contra um **banco SQLite temporário** já migrado, com `next/headers` falso para simular a sessão. | `tests/ajuda.js` cria o banco; `tests/fake-next-headers.mjs` injeta cookies.                                        |
| **Concorrência** | Dois processos disputando o mesmo horário.                                                                                   | `tests/concorrencia.test.js` dispara `tests/worker-criar-agendamento.mjs` em Worker Threads separados; só um grava. |

Não há testes de **ponta a ponta** no navegador (Playwright/Cypress) nem testes
de **componente** React.

---

## 3. Cobertura por arquivo

| Arquivo                            | Foco                                                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `tests/slots.test.js`              | `horariosLivres`: expediente, duração, passo, antecedência, bloqueios, dia fechado, slot fora da grade.                      |
| `tests/agendamentos.test.js`       | Criar/remarcar/excluir: validação, conflito, snapshot de nome e preço, `origem` público × painel.                            |
| `tests/estado-agendamento.test.js` | Máquina de estados: todas as transições legais e ilegais; concluir com data futura.                                          |
| `tests/concorrencia.test.js`       | Corrida de escrita: só um dos dois agendamentos simultâneos grava.                                                           |
| `tests/auth.test.js`               | Sessão de bootstrap: assinatura HMAC, expiração, `sessao_versao`, hash `scrypt` (formato novo e legado).                     |
| `tests/auth-barbeiro.test.js`      | Login por barbeiro (migration 6): `autenticarBarbeiro`, tokens de recuperação, troca de senha/e-mail, invalidação de sessão. |
| `tests/autorizacao.test.js`        | `exigirSessao`: 401 sem sessão, trava da senha inicial, checagem de `Origin` (CSRF), rotas dinâmicas `[recurso]`.            |
| `tests/log-login.test.js`          | Registro de tentativas de login no log estruturado.                                                                          |
| `tests/validacao.test.js`          | `validar`: campos obrigatórios, faixas, formato de data/hora, e-mail, telefone.                                              |
| `tests/upload.test.js`             | Detecção de tipo por assinatura (magic number); rejeição de arquivo renomeado.                                               |
| `tests/requisicao.test.js`         | Leitura de corpo JSON, corpo vazio, JSON malformado, verificação de `Origin`.                                                |
| `tests/datas-cliente.test.js`      | Dias disponíveis e utilidades de data no fuso da barbearia.                                                                  |
| `tests/db.test.js`                 | Abertura da conexão, PRAGMAs, recusa de subir com versão de schema errada.                                                   |
| `tests/resumo.test.js`             | Agregados do `GET /api/admin/resumo`: agrupamento por mês, somas de recebido e a receber.                                    |
| `tests/log.test.js`                | Formato do log estruturado.                                                                                                  |

Helpers (não são suites): `tests/ajuda.js`, `tests/register-hooks.mjs`,
`tests/module-hooks.mjs`, `tests/fake-next-headers.mjs`,
`tests/worker-criar-agendamento.mjs`.

---

## 4. O que não é testado hoje — e por quê

| Área                                  | Situação                                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------------------- |
| Componentes React / telas             | Sem teste. Decisão: o valor está na lógica de domínio; a UI é verificada à mão.              |
| Fluxo no navegador (E2E)              | Sem teste. Um E2E do agendamento (5 passos + confirmação) é o candidato mais forte a entrar. |
| CSP real com nonce                    | Só observável em `next start` (o `next dev` contorna). Não há teste de build.                |
| Envio real de e-mail                  | `EMAIL_PROVIDER=console` nos testes; o caminho SMTP não é exercitado.                        |
| Carga / desempenho sob concorrência   | Estimativas analíticas na auditoria; sem teste de carga.                                     |
| Migrations em banco com dados legados | As migrations de rebuild de tabela (3 e 6) são exercitadas só com banco novo.                |

---

## 5. Integração contínua

**Não existe.** Não há `.github/workflows` nem outra configuração de CI. Os
testes rodam só na máquina de quem desenvolve.

**Proposta (`[PLANEJADO]`):** um workflow do GitHub Actions que, a cada push e
pull request, rode `npm ci`, `npm run format:check` e `npm test` no Node 22, e
bloqueie o merge se algo falhar. Custo baixo, e fecha a lacuna de "passou aqui
mas não lá".

---

## 6. Convenções e metas

- **Toda regra de negócio nova entra com teste** no mesmo commit — em especial
  as dos módulos `[PLANEJADO]` que mexem em dinheiro e em estado: marcação
  automática de `no-show` e liberação do horário, contagem de faltas da
  bad-list (cancelamento não interrompe), fechamento de comanda só após
  `concluido`, bloqueio de venda sem estoque, soma de múltiplos pagamentos, e a
  autenticação por segredo dos endpoints `/api/tarefas/*`.
- A suíte fica **verde** antes de qualquer merge.
- Testes de integração usam sempre **banco temporário** — nenhum teste toca
  `data/app.db`.
- Quando um bug escapa, o primeiro passo é um teste que o reproduz.
- Ao mudar o contrato de uma rota, atualizar [10 — Contrato da API](10-contrato-da-api.md)
  e o teste de integração correspondente.
