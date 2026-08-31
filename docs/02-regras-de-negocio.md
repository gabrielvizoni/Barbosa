# 02 — Regras de negócio

As regras de negócio (RN) que o sistema aplica ou deverá aplicar. Cada regra
tem uma **origem** — onde ela mora hoje — e uma **situação**, seguindo a
[legenda](README.md#legenda-de-situação).

| Origem      | Significado                                                          |
| ----------- | -------------------------------------------------------------------- |
| `código`    | Imposta em `src/lib/**` ou nas rotas.                                |
| `banco`     | Garantida por `CHECK`, índice único ou chave estrangeira no schema.  |
| `config`    | Depende de um valor da tabela `config`, ajustável no painel.         |
| `planejado` | Ainda não existe em lugar nenhum; descreve o comportamento desejado. |

Os IDs são estáveis. Regras acrescentadas depois da primeira redação recebem o
próximo número livre (RN-49 em diante) e ficam na seção temática a que
pertencem, por isso a numeração dentro de uma seção nem sempre é sequencial.

---

## 1. Agendamento — disponibilidade e criação

| ID    | Regra                                                                                                                                                                                                                                                                                                                                                                                                                    | Origem            | Situação         |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- | ---------------- |
| RN-01 | Os horários oferecidos são a grade fixa (`abre + k · passo`, com `passo = máx(5, intervalo_min)`), mais o fim de cada atendimento ou bloqueio quando ele cabe antes do fechamento.                                                                                                                                                                                                                                       | `código` `config` | `[IMPLEMENTADO]` |
| RN-02 | Quando a data escolhida é o dia de hoje, nenhum horário antes de "agora + antecedência mínima" é oferecido. "Agora" é no fuso da barbearia.                                                                                                                                                                                                                                                                              | `código` `config` | `[IMPLEMENTADO]` |
| RN-03 | O cliente só agenda dentro da janela de `dias_futuros` dias à frente.                                                                                                                                                                                                                                                                                                                                                    | `código` `config` | `[IMPLEMENTADO]` |
| RN-04 | Dia com `aberto = 0` não oferece horário nenhum; fora do intervalo `abre`–`fecha`, idem.                                                                                                                                                                                                                                                                                                                                 | `código` `banco`  | `[IMPLEMENTADO]` |
| RN-05 | Um horário só é oferecido se `início + duração do serviço` couber antes do fechamento e não sobrepuser nenhum bloqueio nem agendamento não cancelado — e, na situação alvo, não `no-show` (RN-18).                                                                                                                                                                                                                       | `código`          | `[IMPLEMENTADO]` |
| RN-06 | Um bloqueio com `barbeiro_id` nulo vale para todos os profissionais.                                                                                                                                                                                                                                                                                                                                                     | `código` `banco`  | `[IMPLEMENTADO]` |
| RN-07 | O fim de um atendimento curto que termina fora da grade fixa (ex.: 09:45) é oferecido como horário, em vez de esperar o próximo múltiplo do passo.                                                                                                                                                                                                                                                                       | `código`          | `[IMPLEMENTADO]` |
| RN-08 | Agendamento de **origem pública** respeita expediente e antecedência e exige telefone (10–11 dígitos). Agendamento de **origem painel** (encaixe) pode ser fora do expediente, mas nunca sobre outro atendimento ou bloqueio, e o telefone é opcional.                                                                                                                                                                   | `código`          | `[IMPLEMENTADO]` |
| RN-09 | A gravação reconfere a disponibilidade dentro de uma transação com o _write lock_ já preso; o índice único parcial `idx_ag_sem_duplicidade` barra a colisão exata (mesmo profissional, data e início) para status diferente de `cancelado` (na situação alvo, também de `no-show`).                                                                                                                                      | `código` `banco`  | `[IMPLEMENTADO]` |
| RN-10 | O agendamento guarda um retrato do nome do serviço e do profissional no momento da marcação; alterar o cadastro depois não muda o histórico.                                                                                                                                                                                                                                                                             | `código`          | `[IMPLEMENTADO]` |
| RN-11 | O valor do agendamento é o preço do serviço no momento da marcação.                                                                                                                                                                                                                                                                                                                                                      | `código`          | `[IMPLEMENTADO]` |
| RN-12 | Um serviço só aparece no site se estiver ativo **e** tiver ao menos um profissional vinculado.                                                                                                                                                                                                                                                                                                                           | `código`          | `[IMPLEMENTADO]` |
| RN-13 | Sem nenhum serviço ativo, o agendamento público fica fechado — o sistema nasce vazio e é white-label.                                                                                                                                                                                                                                                                                                                    | `código`          | `[IMPLEMENTADO]` |
| RN-14 | O expediente semanal é **individual por profissional** (`expediente_barbeiro`, migration 7) — não existe mais grade global da barbearia. As folgas recorrentes também são configuração do profissional (RN-49) e o bloqueio manual continua para exceções pontuais. O "Horário de funcionamento" do site é derivado da união dos profissionais ativos. Um profissional novo nasce com o expediente padrão via _trigger_. | `código` `banco`  | `[IMPLEMENTADO]` |
| RN-49 | Cada profissional tem **folgas recorrentes** próprias (`folgas_recorrentes`, migration 7): dias da semana em que nunca atende, distintas dos bloqueios pontuais de uma data. Um dia de folga recorrente zera a disponibilidade daquele dia, mesmo com o expediente aberto.                                                                                                                                               | `código` `banco`  | `[IMPLEMENTADO]` |
| RN-50 | Na situação alvo, agendar exige uma **conta de cliente** autenticada; os dados de contato vêm da conta, e o agendamento fica vinculado ao cliente para histórico, métricas e lembretes. Hoje o agendamento público é anônimo (nome + WhatsApp).                                                                                                                                                                          | `planejado`       | `[PARCIAL]`      |

## 2. Ciclo de vida do agendamento

| ID    | Regra                                                                                                                                                                                                                                                             | Origem            | Situação         |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ---------------- |
| RN-15 | Status possíveis hoje: `pendente`, `confirmado`, `concluido`, `cancelado`.                                                                                                                                                                                        | `banco`           | `[IMPLEMENTADO]` |
| RN-16 | Status alvo acrescenta `no-show` (cliente não compareceu). O status "em atendimento" não existe e não está previsto.                                                                                                                                              | `planejado`       | `[PLANEJADO]`    |
| RN-17 | Transições legais atuais: `pendente → confirmado \| cancelado`; `confirmado → concluido \| cancelado`; `concluido → —`; `cancelado → pendente \| confirmado`.                                                                                                     | `código`          | `[IMPLEMENTADO]` |
| RN-18 | Transição alvo `confirmado → no-show` **automática**: um agendamento `confirmado` cujo horário passou sem conclusão é marcado como `no-show` por rotina do sistema. A volta de `no-show` (para `confirmado`) só por ação do administrador, revalidando o horário. | `planejado`       | `[PLANEJADO]`    |
| RN-19 | Concluir só é permitido se a data do agendamento não for futura.                                                                                                                                                                                                  | `código`          | `[IMPLEMENTADO]` |
| RN-20 | Reabrir um agendamento cancelado revalida o horário — impede dois atendimentos no mesmo horário quando o slot já foi reoferecido a outra pessoa.                                                                                                                  | `código`          | `[IMPLEMENTADO]` |
| RN-21 | Com `confirmacao_automatica = "1"`, o agendamento público entra `confirmado`; senão, entra `pendente`. O encaixe pelo painel entra sempre `confirmado`.                                                                                                           | `config` `código` | `[IMPLEMENTADO]` |
| RN-22 | O cliente só cancela ou remarca o próprio agendamento se faltar **mais de 30 minutos** para o horário marcado.                                                                                                                                                    | `planejado`       | `[PLANEJADO]`    |

## 3. Faltas e bad-list

| ID    | Regra                                                                                                                                                                                                                                                          | Origem      | Situação      |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------- |
| RN-23 | O comparecimento é derivado da conclusão: atendimento `concluido` conta como cliente presente; `no-show` conta como falta.                                                                                                                                     | `planejado` | `[PLANEJADO]` |
| RN-24 | Três `no-show` do mesmo cliente sem nenhum atendimento concluído entre eles o incluem automaticamente na bad-list. Um **cancelamento não interrompe** a sequência — só uma conclusão (RN-25). Ex.: 2 `no-show` → cancelamento → `no-show` conta como 3 faltas. | `planejado` | `[PLANEJADO]` |
| RN-25 | Assim que o cliente comparece e o atendimento é concluído, o contador de faltas consecutivas zera e ele sai da bad-list.                                                                                                                                       | `planejado` | `[PLANEJADO]` |
| RN-26 | A bad-list apenas sinaliza para o barbeiro/admin: não bloqueia o cliente, não impede novos agendamentos e não gera notificação a ele.                                                                                                                          | `planejado` | `[PLANEJADO]` |

## 4. Financeiro, caixa, comandas e estoque

| ID    | Regra                                                                                                                                                                                                                                                                                                                            | Origem           | Situação         |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ---------------- |
| RN-27 | No mês, "recebido" é a soma dos agendamentos `concluido` e "a receber" é a soma dos que não estão `concluido` nem `cancelado`.                                                                                                                                                                                                   | `código`         | `[IMPLEMENTADO]` |
| RN-28 | Cadastro nunca é apagado, só desativado: serviço ou profissional inativo some do site, mas os atendimentos antigos seguem no financeiro.                                                                                                                                                                                         | `código`         | `[IMPLEMENTADO]` |
| RN-29 | Agendamento "excluído" é _soft delete_ (`excluido_em`): sai das telas e dos cálculos, permanece no banco.                                                                                                                                                                                                                        | `código` `banco` | `[IMPLEMENTADO]` |
| RN-30 | O pagamento é registrado após o atendimento; não há pagamento pela plataforma. Uma comanda pode ter **mais de um pagamento**, dividindo o total entre formas (Pix, cartão, dinheiro).                                                                                                                                            | `planejado`      | `[PLANEJADO]`    |
| RN-31 | Existe um único caixa por dia para a barbearia inteira, aberto e fechado uma vez ao dia. Cada movimento tem um tipo: `sangria`, `reforço`, `troco`, `entrada_avulsa`, `saida_avulsa` ou o `pagamento` de uma comanda.                                                                                                            | `planejado`      | `[PLANEJADO]`    |
| RN-32 | "Recebido por profissional" apenas identifica quem realizou cada atendimento e atribui o valor a ele para os relatórios. Não há comissão nem rateio.                                                                                                                                                                             | `planejado`      | `[PLANEJADO]`    |
| RN-33 | A comanda é 1‑para‑1 com o agendamento e reúne os serviços e produtos daquele atendimento. Também pode existir comanda avulsa, sem agendamento, para venda de produtos. A comanda vinculada a agendamento só pode ser **fechada** depois de o agendamento estar `concluido`; ao fechar, o total vai para o financeiro e o caixa. | `planejado`      | `[PLANEJADO]`    |
| RN-34 | A venda de um produto dá baixa no estoque. Se não houver quantidade suficiente, o sistema **impede a venda** e avisa o administrador — o estoque nunca fica negativo.                                                                                                                                                            | `planejado`      | `[PLANEJADO]`    |
| RN-51 | Um cliente é **recorrente** quando tem 2 ou mais atendimentos `concluido` (sem limite de período); abaixo disso é **novo**. É uma classificação derivada do histórico, não um campo editável.                                                                                                                                    | `planejado`      | `[PLANEJADO]`    |

## 5. Acesso e autenticação

| ID    | Regra                                                                                                                                                                                  | Origem      | Situação         |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------------- |
| RN-35 | Enquanto nenhum administrador tiver login próprio definido, vale a senha do ambiente (`ADMIN_PASSWORD`) e o painel fica travado — só Configurações abre.                               | `código`    | `[IMPLEMENTADO]` |
| RN-36 | Trocar a senha de um barbeiro derruba as sessões dele (`barbeiros.sessao_versao`); concluir o bootstrap derruba as sessões de bootstrap (`config.sessao_versao`).                      | `código`    | `[IMPLEMENTADO]` |
| RN-37 | O e-mail de um barbeiro é único, sem diferenciar maiúsculas de minúsculas.                                                                                                             | `banco`     | `[IMPLEMENTADO]` |
| RN-38 | O token de recuperação de senha é guardado como hash, tem prazo de expiração e, ao ser usado, apaga os tokens pendentes do barbeiro e derruba as sessões dele.                         | `código`    | `[IMPLEMENTADO]` |
| RN-39 | Hoje todo barbeiro cadastrado tem papel `admin` (a migração de login promoveu todos). Os papéis `barbeiro` (restrito) e `superadmin` são a visão alvo.                                 | `código`    | `[PARCIAL]`      |
| RN-40 | O acesso dos papéis `admin` e `superadmin` exige um segundo fator (TOTP) — **obrigatório**, não opcional, por acessarem dados e configurações sensíveis.                               | `planejado` | `[PLANEJADO]`    |
| RN-41 | A sessão do painel dura 12 horas.                                                                                                                                                      | `código`    | `[IMPLEMENTADO]` |
| RN-42 | O papel `superadmin` usa o mesmo mecanismo de login, mas abre uma área técnica **separada** do painel da barbearia (migrations, logs, saúde). O `admin` (o dono) não acessa essa área. | `planejado` | `[PLANEJADO]`    |

## 6. Privacidade e LGPD

| ID    | Regra                                                                                                                                               | Origem      | Situação         |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------------- |
| RN-43 | A trilha de auditoria guarda só campos operacionais (status, data, horário, ids, preço); nunca nome ou telefone do cliente.                         | `código`    | `[IMPLEMENTADO]` |
| RN-44 | O cliente pode pedir a exclusão da conta e dos dados pessoais; os agendamentos podem ser anonimizados em vez de apagados, preservando o financeiro. | `planejado` | `[PLANEJADO]`    |
| RN-45 | O cliente pode consultar quais dados são guardados sobre ele e com que finalidade.                                                                  | `planejado` | `[PLANEJADO]`    |

## 7. Operação e ambiente

| ID    | Regra                                                                                                                         | Origem   | Situação         |
| ----- | ----------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------- |
| RN-46 | O sistema não sobe se a versão do banco não for exatamente a esperada — é preciso rodar as migrations antes.                  | `código` | `[IMPLEMENTADO]` |
| RN-47 | Um banco recém-criado nasce vazio; a equipe, os serviços e a identidade da barbearia são cadastrados pelo painel.             | `código` | `[IMPLEMENTADO]` |
| RN-48 | Em produção, sem um `SESSION_SECRET` de verdade, o sistema recusa-se a operar em vez de assinar sessões com valor previsível. | `código` | `[IMPLEMENTADO]` |

---

## Decisões registradas

Pontos definidos com o responsável e já refletidos acima:

- **RN-14 / RN-49:** o expediente semanal é individual por profissional
  (`expediente_barbeiro`); não há mais expediente global. Folgas recorrentes
  (`folgas_recorrentes`) são configuração do profissional, separadas dos
  bloqueios pontuais. Profissional novo nasce com o expediente padrão; o
  "Horário de funcionamento" do site é a união dos profissionais ativos.
- **RN-18:** o `no-show` é marcado automaticamente por rotina, para todo
  `confirmado` que passa do horário sem conclusão.
- **RN-24:** um cancelamento não interrompe a sequência de faltas — só uma
  conclusão.
- **RN-33 / RN-34:** a comanda só fecha após o agendamento estar `concluido`;
  a venda de produto sem estoque é bloqueada (nunca fica negativo).
- **RN-30:** a comanda aceita múltiplas formas de pagamento.
- **RN-40:** 2FA (TOTP) obrigatório para `admin` e `superadmin`.
- **RN-50:** agendar passa a exigir conta de cliente.
- **RN-51:** cliente recorrente = 2 ou mais atendimentos concluídos.
