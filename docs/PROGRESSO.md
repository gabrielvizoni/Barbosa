# Progresso da implementação

Acompanha o avanço sobre o backlog de [12 — Backlog de implementação](12-backlog.md).
Cada epic entregue vira uma linha aqui, com o commit e o que ficou de fora
para um epic posterior. A ordem e as dependências estão no grafo do backlog.

O ciclo de cada epic é: analisar → implementar → testar → auditar todo o
código alterado e impactado → corrigir → reauditar → atualizar a documentação
afetada → commit. Nenhuma regra de negócio nova é inventada: quando um ponto
não está nos documentos, ele é decidido com o responsável antes de codar.

---

## Entregue

| Epic                                | Commit                                                           | Situação  | Fecha                                                                                | Fica para depois                                                                                                                                |
| ----------------------------------- | ---------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **B — Expediente por profissional** | `feat(agenda): expediente e folgas recorrentes por profissional` | concluído | RF-34, RF-81, RN-14, RN-49                                                           | —                                                                                                                                               |
| **A — Conta de cliente e LGPD**     | `feat(conta): conta de cliente, LGPD e agendamento autenticado`  | concluído | RF-05, RF-09, RF-11 a RF-14, RF-19, RF-20, RF-72, RN-50, RN-44, RN-45, RN-51, RNF-10 | histórico próprio do cliente em `/conta` (RF-15 → Epic J); edição de cliente pelo admin e faltas/bad-list na ficha (RF-71/73/74/75 → Epics C/D) |

### Epic B — resumo

- Migration 7: `expediente_barbeiro` e `folgas_recorrentes`, com _trigger_
  `trg_expediente_barbeiro_padrao` que semeia o expediente padrão (domingo
  fechado, seg–sex 09–20, sábado 08–18) em todo profissional novo. A grade
  global `expediente` foi removida; os profissionais existentes herdaram a
  grade de então.
- `horariosLivres` e `diasDisponiveis` passam a considerar o expediente e as
  folgas recorrentes do profissional. `GET /api/public` aceita `?barbeiro=<id>`;
  sem o parâmetro, `dias` é a união dos profissionais ativos.
- `GET`/`PUT /api/admin/barbeiros/[id]/expediente` e o editor por profissional
  (com folgas recorrentes) na tela Horários e folgas.
- O "Horário de funcionamento" do site é derivado da união dos profissionais
  ativos (um dia abre se ao menos um atende).
- **Decisões:** horário público derivado da união; profissional novo com
  expediente padrão via _trigger_; o assistente busca os dias por profissional
  via `?barbeiro=`.

### Epic A — resumo

- Migration 8: tabelas `clientes` (e-mail único por `lower(email)`,
  `sessao_versao`, `anonimizado_em`) e `cliente_reset_tokens`;
  `agendamentos.cliente_id` (FK → `clientes`, `ON DELETE SET NULL`).
- `src/lib/cliente-auth.js` espelha `src/lib/auth.js` para a conta do cliente:
  cookie `cliente_sessao` (30 dias), cadastro, login (scrypt sempre), troca de
  senha/e-mail, tokens de recuperação, `exigirSessaoCliente` (com checagem de
  Origin). As primitivas de cripto (`iguais`, `conferirHash`, `segredo`,
  `HASH_DUMMY`) foram exportadas do `auth.js` para reúso.
- Rotas `/api/conta/*`: `cadastro`, `login`, `logout`, `sessao`,
  `esqueci-senha`, `redefinir-senha`, `GET`/`PATCH perfil`, `POST perfil/senha`,
  `DELETE /api/conta`.
- `POST /api/agendamentos` exige sessão de cliente (RN-50); o nome e o telefone
  vêm da conta (o corpo é ignorado) e o `cliente_id` é gravado. O encaixe pelo
  painel continua sem conta.
- Página `/conta` (entrar/cadastrar/recuperar + "Meus dados" com edição,
  troca de senha, texto LGPD e exclusão da conta); `CampoSenha`/`CampoEmail`
  extraídos para `src/components/campos.jsx`, compartilhados com o painel.
- Guarda de sessão em `/agendar` (redireciona a `/conta?retorno=/agendar`); o
  passo "Seus dados" do assistente virou revisão _read-only_.
- Seção **Clientes** no painel (lista com busca + ficha: histórico, gasto
  total, novo × recorrente por RN-51); `GET /api/admin/clientes` e `.../[id]`.
- **Decisões:** telefone obrigatório no cadastro; a exclusão da conta
  anonimiza **também** os agendamentos daquele cliente (nome → "Cliente
  removido", telefone → vazio), preservando o financeiro.

---

## Próximo

Pelo grafo do backlog, com B e A concluídos, os epics elegíveis são:

- **Epic 0 — Infra: tarefas + CI + validação de ambiente** (tamanho S; `#1` da
  ordem sugerida; destrava os Epics C e I). Tudo `[PLANEJADO]`.
- **Epic K — Papéis restritos + superadmin** (tamanho M; fecha RN-39;
  destrava L e N). "Mexe em muitos testes".
- **Epic C — No-show automático** só fica elegível depois do Epic 0.

A recomendação é o **Epic 0**: é pequeno, é o `#1` da ordem sugerida e
desbloqueia dois outros epics (C e I). Confirmar com o responsável antes de
começar.

---

## Observações de infraestrutura (pré-existentes, fora de escopo dos epics)

1. **`npm run build` em `NODE_ENV=production`** imprime
   `Configuração insegura para produção` durante a geração estática porque o
   `.env` de desenvolvimento tem `SESSION_SECRET`/`ADMIN_PASSWORD` como
   _placeholder_. O build termina com `exit 0` mesmo assim. Some quando o
   `.env` tiver segredos reais.
2. **`scripts/migrate.js`** roda `node` puro e não carrega o `.env`, então
   `npm run migrate` mira `./data/app.db` (o padrão do `db.js`), não o
   `DATABASE_PATH=./data/barbosa.db` que o `next` usa. Nas migrations 7 e 8 os
   dois bancos foram migrados à mão (`DATABASE_PATH=./data/barbosa.db npm run migrate`).
   Vale endereçar numa etapa própria (carregar o `.env` no script).
