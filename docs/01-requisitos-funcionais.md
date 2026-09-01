# 01 — Requisitos funcionais

Lista dos requisitos funcionais (RF) do sistema, agrupados por módulo, e dos
requisitos não-funcionais (RNF). Cada RF tem um ator principal, uma prioridade
e uma situação. A situação segue a [legenda](README.md#legenda-de-situação):
`[IMPLEMENTADO]`, `[PARCIAL]`, `[PLANEJADO]`.

## Atores

| Sigla  | Ator                       | Descrição                                                                                                                       |
| ------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `CLI`  | Cliente                    | Quem marca um horário. Hoje sem conta; na visão do produto, com cadastro, login e área própria.                                 |
| `ADM`  | Dono / Administrador       | Opera o sistema no dia a dia, com acesso completo a dados e configurações.                                                      |
| `BARB` | Barbeiro                   | Profissional com login próprio e acesso restrito (ver a própria agenda, concluir atendimento). Perfil restrito ainda planejado. |
| `SADM` | Superadmin / Desenvolvedor | Manutenção técnica: migrations, logs, saúde do sistema. Planejado.                                                              |
| `SIS`  | Sistema                    | Rotinas automáticas: envio de lembretes, bot de WhatsApp, expurgo de dados.                                                     |

## Prioridade

`E` Essencial — sem isso o sistema não cumpre o propósito.
`I` Importante — esperado no produto, mas o sistema opera sem.
`D` Desejável — agrega valor, pode ficar para depois.

---

## Módulo 1 — Agendamento (site)

| ID    | Requisito                                                                                                  | Ator  | Prio | Situação         |
| ----- | ---------------------------------------------------------------------------------------------------------- | ----- | ---- | ---------------- |
| RF-01 | Escolher o serviço desejado.                                                                               | `CLI` | E    | `[IMPLEMENTADO]` |
| RF-02 | Escolher o profissional, entre os que realizam o serviço escolhido.                                        | `CLI` | E    | `[IMPLEMENTADO]` |
| RF-03 | Escolher a data em um calendário próprio, que mostra a semana inteira e desabilita os dias fora da janela. | `CLI` | E    | `[IMPLEMENTADO]` |
| RF-04 | Escolher o horário entre os disponíveis para aquele profissional naquele dia.                              | `CLI` | E    | `[IMPLEMENTADO]` |
| RF-05 | Agendar autenticado com a conta de cliente; os dados de contato vêm da conta.                              | `CLI` | E    | `[IMPLEMENTADO]` |
| RF-06 | Ver um resumo antes de confirmar, com serviço, profissional, data, horário, duração e valor total.         | `CLI` | E    | `[PARCIAL]`      |
| RF-07 | Ver uma tela de confirmação ao final, com os dados do agendamento.                                         | `CLI` | E    | `[IMPLEMENTADO]` |
| RF-08 | O agendamento entra como `pendente`, ou já `confirmado` se a confirmação automática estiver ligada.        | `SIS` | E    | `[IMPLEMENTADO]` |
| RF-09 | Vir com os dados de contato já preenchidos a partir da conta.                                              | `CLI` | E    | `[IMPLEMENTADO]` |
| RF-10 | Agendar a partir de um atendimento anterior, repetindo serviço e profissional.                             | `CLI` | D    | `[PLANEJADO]`    |

## Módulo 2 — Conta e área do cliente

| ID    | Requisito                                                                                      | Ator  | Prio | Situação         |
| ----- | ---------------------------------------------------------------------------------------------- | ----- | ---- | ---------------- |
| RF-11 | Criar conta com nome, telefone e e-mail (todos obrigatórios) e senha.                          | `CLI` | E    | `[IMPLEMENTADO]` |
| RF-12 | Entrar com e-mail e senha.                                                                     | `CLI` | E    | `[IMPLEMENTADO]` |
| RF-13 | Recuperar a senha por e-mail.                                                                  | `CLI` | E    | `[IMPLEMENTADO]` |
| RF-14 | Ver e editar os próprios dados cadastrais.                                                     | `CLI` | I    | `[IMPLEMENTADO]` |
| RF-15 | Ver o próprio histórico de agendamentos (serviço, profissional, data, horário, valor, status). | `CLI` | I    | `[PLANEJADO]`    |
| RF-16 | Cancelar o próprio agendamento, desde que falte mais de 30 minutos para o horário.             | `CLI` | I    | `[PLANEJADO]`    |
| RF-17 | Remarcar o próprio agendamento, desde que falte mais de 30 minutos para o horário.             | `CLI` | I    | `[PLANEJADO]`    |
| RF-18 | Configurar o lembrete por antecedência (15, 30, 45 min; 1, 2, 3, 6, 12 ou 24 h).               | `CLI` | D    | `[PLANEJADO]`    |
| RF-19 | Solicitar a exclusão da conta e dos dados pessoais (LGPD).                                     | `CLI` | I    | `[IMPLEMENTADO]` |
| RF-20 | Consultar quais dados pessoais são armazenados e para que são usados (LGPD).                   | `CLI` | I    | `[IMPLEMENTADO]` |

> A conta de cliente é **pré-requisito para agendar** (RF-05): é ela que
> vincula agendamento, histórico, métricas e preferências de lembrete a uma
> pessoa. O agendamento anônimo não existe mais. O telefone é obrigatório no
> cadastro (garante o contato e o botão de confirmação por WhatsApp).

## Módulo 3 — Agenda administrativa

| ID    | Requisito                                                                                                            | Ator         | Prio | Situação         |
| ----- | -------------------------------------------------------------------------------------------------------------------- | ------------ | ---- | ---------------- |
| RF-21 | Ver a agenda do dia por profissional, hora a hora, com telefone e observação à vista.                                | `ADM` `BARB` | E    | `[IMPLEMENTADO]` |
| RF-22 | Ver a lista completa de agendamentos, com busca por nome ou telefone.                                                | `ADM`        | E    | `[IMPLEMENTADO]` |
| RF-23 | Filtrar a lista por status, profissional e data.                                                                     | `ADM`        | E    | `[IMPLEMENTADO]` |
| RF-24 | Confirmar, concluir, cancelar e excluir um agendamento.                                                              | `ADM` `BARB` | E    | `[IMPLEMENTADO]` |
| RF-25 | O sistema marca como `no-show` todo `confirmado` que passa do horário sem conclusão; o admin pode reverter.          | `SIS`        | E    | `[PLANEJADO]`    |
| RF-26 | Encaixar um cliente que chegou sem marcar, mesmo fora da grade, mas nunca sobre outro atendimento ou bloqueio.       | `ADM` `BARB` | I    | `[IMPLEMENTADO]` |
| RF-27 | Remarcar um agendamento pelo painel, revalidando a disponibilidade do novo horário.                                  | `ADM` `BARB` | I    | `[IMPLEMENTADO]` |
| RF-28 | Abrir a conversa no WhatsApp do cliente a partir do agendamento.                                                     | `ADM` `BARB` | I    | `[IMPLEMENTADO]` |
| RF-29 | Cada linha mostra horário, cliente, serviço, profissional, valor, status, telefone, observações e info de pagamento. | `ADM` `BARB` | E    | `[PARCIAL]`      |
| RF-30 | Um novo agendamento aparece automaticamente na agenda.                                                               | `SIS`        | E    | `[IMPLEMENTADO]` |

## Módulo 4 — Profissionais

| ID    | Requisito                                                                                       | Ator  | Prio | Situação         |
| ----- | ----------------------------------------------------------------------------------------------- | ----- | ---- | ---------------- |
| RF-31 | Adicionar e editar profissional (nome, função, bio, foto, ordem).                               | `ADM` | E    | `[IMPLEMENTADO]` |
| RF-32 | Ativar e desativar profissional — o desativado some do site, mas os atendimentos antigos ficam. | `ADM` | E    | `[IMPLEMENTADO]` |
| RF-33 | Definir quais serviços cada profissional realiza.                                               | `ADM` | E    | `[IMPLEMENTADO]` |
| RF-34 | Configurar horário de trabalho e folgas por profissional.                                       | `ADM` | I    | `[IMPLEMENTADO]` |
| RF-35 | Consultar o histórico de atendimentos e o faturamento individual do profissional.               | `ADM` | I    | `[PARCIAL]`      |
| RF-36 | Cada profissional tem login próprio (e-mail, senha, papel).                                     | `ADM` | I    | `[IMPLEMENTADO]` |

> RF-34: cada profissional tem o próprio expediente semanal
> (`expediente_barbeiro`) e as próprias folgas recorrentes
> (`folgas_recorrentes`), editáveis em Horários e folgas; o bloqueio manual
> (`bloqueios`) continua para exceções de uma data pontual. Um profissional
> novo nasce com o expediente padrão (domingo fechado, seg–sex 09–20, sábado
> 08–18) e já fica agendável.
> RF-35: o Financeiro já mostra desempenho por profissional; falta a visão de
> histórico de atendimentos dedicada.

## Módulo 5 — Serviços

| ID    | Requisito                                                                         | Ator  | Prio | Situação         |
| ----- | --------------------------------------------------------------------------------- | ----- | ---- | ---------------- |
| RF-37 | Adicionar, editar e excluir serviço.                                              | `ADM` | E    | `[IMPLEMENTADO]` |
| RF-38 | Definir nome, descrição, categoria, preço e duração do serviço.                   | `ADM` | E    | `[IMPLEMENTADO]` |
| RF-39 | Definir os profissionais que realizam o serviço (monta a 2ª tela do agendamento). | `ADM` | E    | `[IMPLEMENTADO]` |
| RF-40 | Ativar e inativar serviço.                                                        | `ADM` | E    | `[IMPLEMENTADO]` |
| RF-41 | Anexar imagem ao serviço, validada pelo conteúdo do arquivo.                      | `ADM` | D    | `[IMPLEMENTADO]` |

## Módulo 6 — Produtos e estoque

| ID    | Requisito                                                                        | Ator  | Prio | Situação         |
| ----- | -------------------------------------------------------------------------------- | ----- | ---- | ---------------- |
| RF-42 | Cadastrar, editar e excluir produto (nome, marca, preço, imagem).                | `ADM` | I    | `[IMPLEMENTADO]` |
| RF-43 | Controlar a quantidade em estoque.                                               | `ADM` | I    | `[PARCIAL]`      |
| RF-44 | Registrar a venda de um produto; bloquear a venda se o estoque for insuficiente. | `ADM` | I    | `[PLANEJADO]`    |
| RF-45 | Dar baixa no estoque a cada venda, sem nunca deixá-lo negativo.                  | `SIS` | I    | `[PLANEJADO]`    |
| RF-46 | Acompanhar as movimentações de produto pelo caixa.                               | `ADM` | I    | `[PLANEJADO]`    |

> RF-43: a coluna `estoque` existe e é editável; ela ainda não se move sozinha
> porque não há registro de venda.

## Módulo 7 — Comandas

| ID    | Requisito                                                          | Ator         | Prio | Situação      |
| ----- | ------------------------------------------------------------------ | ------------ | ---- | ------------- |
| RF-47 | Abrir uma comanda vinculada ao cliente e ao agendamento.           | `ADM` `BARB` | I    | `[PLANEJADO]` |
| RF-48 | Adicionar à comanda os serviços realizados.                        | `ADM` `BARB` | I    | `[PLANEJADO]` |
| RF-49 | Adicionar à comanda os produtos consumidos ou adquiridos.          | `ADM` `BARB` | I    | `[PLANEJADO]` |
| RF-50 | Calcular o valor total da comanda.                                 | `SIS`        | I    | `[PLANEJADO]` |
| RF-51 | Fechar a comanda e enviar o resultado para o financeiro e o caixa. | `ADM` `BARB` | I    | `[PLANEJADO]` |
| RF-52 | Abrir comanda avulsa, sem agendamento, para uma venda de produto.  | `ADM` `BARB` | D    | `[PLANEJADO]` |

> RF-51: a comanda vinculada a um agendamento só pode ser **fechada** depois de
> o agendamento estar `concluido` (RN-33). Cada produto adicionado é validado
> contra o estoque; sem quantidade, a inclusão é recusada (RN-34).

## Módulo 8 — Financeiro e caixa

| ID    | Requisito                                                                                      | Ator         | Prio | Situação         |
| ----- | ---------------------------------------------------------------------------------------------- | ------------ | ---- | ---------------- |
| RF-53 | Registrar o pagamento de uma comanda, dividindo o valor entre uma ou mais formas de pagamento. | `ADM` `BARB` | E    | `[PLANEJADO]`    |
| RF-54 | Cadastrar e gerenciar as formas de pagamento aceitas.                                          | `ADM`        | I    | `[PLANEJADO]`    |
| RF-55 | Registrar movimentos de caixa: sangria, reforço, troco, entrada avulsa e saída avulsa.         | `ADM`        | I    | `[PLANEJADO]`    |
| RF-56 | Abrir e fechar o caixa do dia.                                                                 | `ADM`        | E    | `[PLANEJADO]`    |
| RF-57 | Ver o faturamento por período.                                                                 | `ADM`        | E    | `[PARCIAL]`      |
| RF-58 | Ver os valores recebidos por cada profissional.                                                | `ADM`        | I    | `[PARCIAL]`      |
| RF-59 | Ver o recebido e o a receber no mês, comparados com outro mês à escolha.                       | `ADM`        | I    | `[IMPLEMENTADO]` |

> "A receber" hoje é o valor dos agendamentos ainda não concluídos; "recebido"
> é o dos concluídos. Não há registro de pagamento nem forma de pagamento — é
> isso que o módulo de caixa planejado acrescenta.

## Módulo 9 — Relatórios e dashboard

| ID    | Requisito                                                                                                                | Ator  | Prio | Situação         |
| ----- | ------------------------------------------------------------------------------------------------------------------------ | ----- | ---- | ---------------- |
| RF-60 | Painel do dia: nº de agendamentos, previsão de entrada, quem trabalha, chegadas recentes.                                | `ADM` | E    | `[IMPLEMENTADO]` |
| RF-61 | Faturamento diário e mensal no dashboard.                                                                                | `ADM` | I    | `[PARCIAL]`      |
| RF-62 | Concluídos, cancelamentos e faltas/no-shows no dashboard.                                                                | `ADM` | I    | `[PLANEJADO]`    |
| RF-63 | Ticket médio no dashboard.                                                                                               | `ADM` | I    | `[PLANEJADO]`    |
| RF-64 | Serviço mais agendado.                                                                                                   | `ADM` | I    | `[IMPLEMENTADO]` |
| RF-65 | Comparação do faturamento com o mês anterior.                                                                            | `ADM` | I    | `[IMPLEMENTADO]` |
| RF-66 | Comparação entre clientes novos e recorrentes (recorrente = 2 ou mais atendimentos concluídos).                          | `ADM` | I    | `[PLANEJADO]`    |
| RF-67 | Relatórios filtráveis por período, profissional, serviço e forma de pagamento (só visualização; sem exportação por ora). | `ADM` | I    | `[PLANEJADO]`    |
| RF-68 | Relatório de produtos mais vendidos.                                                                                     | `ADM` | D    | `[PLANEJADO]`    |
| RF-69 | Relatório de formas de pagamento e de movimentações do caixa.                                                            | `ADM` | I    | `[PLANEJADO]`    |
| RF-70 | Comparar qualquer relatório com períodos anteriores.                                                                     | `ADM` | D    | `[PARCIAL]`      |

## Módulo 10 — Gestão de clientes (pelo administrador)

| ID    | Requisito                                                            | Ator  | Prio | Situação         |
| ----- | -------------------------------------------------------------------- | ----- | ---- | ---------------- |
| RF-71 | Ver e editar os dados de um cliente.                                 | `ADM` | I    | `[PARCIAL]`      |
| RF-72 | Consultar o histórico de agendamentos do cliente.                    | `ADM` | I    | `[IMPLEMENTADO]` |
| RF-73 | Ver serviços mais utilizados e frequência de visitas do cliente.     | `ADM` | I    | `[PARCIAL]`      |
| RF-74 | Ver cancelamentos, faltas/no-shows e valor total gasto pelo cliente. | `ADM` | I    | `[PARCIAL]`      |
| RF-75 | Ver a situação do cliente em relação à bad-list.                     | `ADM` | I    | `[PLANEJADO]`    |

## Módulo 11 — Configurações

| ID    | Requisito                                                                                      | Ator  | Prio | Situação         |
| ----- | ---------------------------------------------------------------------------------------------- | ----- | ---- | ---------------- |
| RF-76 | Editar a identidade da barbearia: logo, nome, slogan, WhatsApp, endereço e Instagram.          | `ADM` | E    | `[IMPLEMENTADO]` |
| RF-77 | Configurar o intervalo (granularidade) entre os horários oferecidos.                           | `ADM` | I    | `[IMPLEMENTADO]` |
| RF-78 | Configurar a antecedência mínima para agendar.                                                 | `ADM` | I    | `[IMPLEMENTADO]` |
| RF-79 | Configurar quantos dias à frente o cliente pode agendar.                                       | `ADM` | I    | `[IMPLEMENTADO]` |
| RF-80 | Ativar e desativar a confirmação automática dos agendamentos.                                  | `ADM` | I    | `[IMPLEMENTADO]` |
| RF-81 | Configurar o expediente de cada dia da semana (aberto/fechado, abre, fecha), por profissional. | `ADM` | E    | `[IMPLEMENTADO]` |
| RF-82 | Bloquear horários e dias (folgas), por profissional ou para a barbearia toda.                  | `ADM` | E    | `[IMPLEMENTADO]` |
| RF-83 | Botões rápidos "saí por 1 hora", "saí por 2 horas" e "fechar o resto do dia".                  | `ADM` | D    | `[IMPLEMENTADO]` |

> RF-81: o expediente é **individual por profissional** (RF-34), com **folgas
> recorrentes** próprias de cada um; o bloqueio pontual de RF-82 continua para
> exceções de data. O "Horário de funcionamento" exibido no site é a **união**
> dos expedientes dos profissionais ativos (um dia abre se ao menos um atende).

## Módulo 12 — Autenticação e controle de acesso

| ID    | Requisito                                                                                                 | Ator         | Prio | Situação         |
| ----- | --------------------------------------------------------------------------------------------------------- | ------------ | ---- | ---------------- |
| RF-84 | Primeiro acesso com a senha do ambiente; painel travado (só Configurações) até definir uma senha própria. | `ADM`        | E    | `[IMPLEMENTADO]` |
| RF-85 | Login individual do barbeiro por e-mail e senha, com papel.                                               | `BARB`       | E    | `[IMPLEMENTADO]` |
| RF-86 | Recuperação de senha do barbeiro por e-mail.                                                              | `BARB`       | I    | `[IMPLEMENTADO]` |
| RF-87 | Trocar a própria senha e o próprio e-mail, confirmando a senha atual.                                     | `BARB`       | I    | `[IMPLEMENTADO]` |
| RF-88 | Papel Administrador com acesso completo ao painel.                                                        | `ADM`        | E    | `[IMPLEMENTADO]` |
| RF-89 | Papel Barbeiro com acesso restrito (própria agenda, concluir atendimento; sem financeiro nem config).     | `BARB`       | I    | `[PLANEJADO]`    |
| RF-90 | Papel Superadmin/Desenvolvedor com área técnica: migrations, logs e saúde do sistema.                     | `SADM`       | I    | `[PLANEJADO]`    |
| RF-91 | Segundo fator (TOTP) obrigatório para os papéis Administrador e Superadmin.                               | `ADM` `SADM` | E    | `[PLANEJADO]`    |
| RF-92 | Convidar um barbeiro por e-mail e reenviar o convite.                                                     | `ADM`        | I    | `[IMPLEMENTADO]` |

> RF-89: papel para uma fase posterior. O Barbeiro restrito enxerga só o
> necessário para operar — a própria agenda, os atendimentos e concluí-los
> (o `no-show` é automático) — sem financeiro, configurações gerais nem gestão
> administrativa.
> RF-90: o Superadmin usa o mesmo mecanismo de login (papel `superadmin`); o
> próprio login identifica o nível e encaminha o usuário para a área certa. A
> área técnica fica **separada** do painel da barbearia (rota `/admin/sistema`).
> O Administrador (o dono) não enxerga nem acessa as funções do Superadmin.
> RF-91: obrigatório, não opcional, por esses papéis acessarem dados e
> configurações sensíveis.

## Módulo 13 — Notificações

| ID    | Requisito                                                                                                          | Ator  | Prio | Situação      |
| ----- | ------------------------------------------------------------------------------------------------------------------ | ----- | ---- | ------------- |
| RF-93 | Avisar o cliente pelo bot de WhatsApp a cada mudança de status do agendamento.                                     | `SIS` | I    | `[PLANEJADO]` |
| RF-94 | Enviar a confirmação do agendamento ao cliente por e-mail, quando ele é confirmado.                                | `SIS` | I    | `[PLANEJADO]` |
| RF-95 | Enviar o lembrete ao cliente por WhatsApp e e-mail, na antecedência que ele escolheu.                              | `SIS` | D    | `[PLANEJADO]` |
| RF-96 | Notificar o administrador, dentro do painel, sobre novo agendamento, cancelamento, remarcação e mudança de status. | `SIS` | I    | `[PLANEJADO]` |
| RF-97 | Não há notificação administrativa de "agendamento próximo" — decisão de escopo.                                    | —     | —    | `[PLANEJADO]` |

> O bot usa a **WhatsApp Business Platform / Cloud API oficial** (número
> próprio da barbearia), não links nem serviços de terceiros. O bot comunica só
> o status; o detalhe fica no painel do cliente.

## Módulo 14 — Bad-list (controle de faltas)

| ID     | Requisito                                                                                                               | Ator         | Prio | Situação      |
| ------ | ----------------------------------------------------------------------------------------------------------------------- | ------------ | ---- | ------------- |
| RF-98  | Contar os no-shows consecutivos de cada cliente (zerando a cada atendimento concluído).                                 | `SIS`        | I    | `[PLANEJADO]` |
| RF-99  | Incluir o cliente na bad-list ao atingir 3 `no-show` sem conclusão entre eles (cancelamento não interrompe a contagem). | `SIS`        | I    | `[PLANEJADO]` |
| RF-100 | Retirar o cliente da bad-list automaticamente quando ele voltar a comparecer.                                           | `SIS`        | I    | `[PLANEJADO]` |
| RF-101 | Mostrar a situação da bad-list ao barbeiro/admin, sem bloquear agendamento e sem notificar o cliente.                   | `ADM` `BARB` | I    | `[PLANEJADO]` |

## Módulo 15 — Operação e infraestrutura

| ID     | Requisito                                                                                                                                                                                              | Ator   | Prio | Situação         |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ---- | ---------------- |
| RF-102 | Migrations versionadas, aplicadas por comando, com trava de boot se a versão não bater.                                                                                                                | `SADM` | E    | `[IMPLEMENTADO]` |
| RF-103 | Endpoint de health check para um monitor externo.                                                                                                                                                      | `SADM` | I    | `[IMPLEMENTADO]` |
| RF-104 | Trilha de auditoria de toda mutação de agendamento, sem guardar nome ou telefone do cliente.                                                                                                           | `SIS`  | I    | `[IMPLEMENTADO]` |
| RF-105 | Backup automático diário em produção (banco + uploads) para um armazenamento externo ao ambiente, com retenção inicial de 30 dias.                                                                     | `SADM` | E    | `[PLANEJADO]`    |
| RF-106 | Runbook de restauração de backup, testado.                                                                                                                                                             | `SADM` | E    | `[PLANEJADO]`    |
| RF-107 | Rotinas periódicas (lembretes, marcação de `no-show`, limpeza) acionadas por um **agendador externo** que chama endpoints internos protegidos — sem depender de um processo Node em execução contínua. | `SIS`  | E    | `[PLANEJADO]`    |

---

## Requisitos não-funcionais

| ID     | Requisito                                                                                                                                                                                                                                               | Situação                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| RNF-01 | O banco (`better-sqlite3`) é síncrono e o Next roda em uma thread: toda query bloqueia o event loop. Consultas de relatório e caixa precisam ser indexadas e limitadas.                                                                                 | restrição de arquitetura |
| RNF-02 | A gravação de agendamento é à prova de corrida, garantida pelo banco: transação `BEGIN IMMEDIATE` que reconfere a disponibilidade, mais índice único parcial.                                                                                           | `[IMPLEMENTADO]`         |
| RNF-03 | O site nunca pode aceitar um agendamento em horário já ocupado, mesmo sob concorrência. Parada curta de serviço é tolerável; agendamento duplicado não.                                                                                                 | alvo                     |
| RNF-04 | Em produção, backup automático diário de `data/` e `public/uploads/` para um armazenamento externo ao ambiente principal, com múltiplas cópias (retenção inicial de 30 dias) e restauração testada periodicamente.                                      | `[PLANEJADO]`            |
| RNF-05 | Cookie de sessão `HttpOnly`, `SameSite=Strict`, `Secure` em produção, assinado com HMAC-SHA256 e com validade embutida; versão de sessão para invalidação em massa.                                                                                     | `[IMPLEMENTADO]`         |
| RNF-06 | Senhas guardadas como hash `scrypt` com os parâmetros de custo embutidos; comparação em tempo constante.                                                                                                                                                | `[IMPLEMENTADO]`         |
| RNF-07 | Rate limiter próprio (em SQLite) para login e agendamento público, com disjuntor global contra rotação de IP.                                                                                                                                           | `[IMPLEMENTADO]`         |
| RNF-08 | CSP com nonce por requisição no middleware, além de `X-Frame-Options`, `nosniff`, HSTS e verificação de `Origin` nas mutações (CSRF).                                                                                                                   | `[IMPLEMENTADO]`         |
| RNF-09 | Upload de imagem validado pela assinatura do arquivo (não pelo nome), reprocessado com `sharp` e salvo com nome UUID.                                                                                                                                   | `[IMPLEMENTADO]`         |
| RNF-10 | LGPD: a auditoria nunca guarda nome ou telefone do cliente; a conta pode ser excluída a pedido (anonimizando também os agendamentos); base legal e uso dos dados exibidos na área do cliente.                                                           | `[IMPLEMENTADO]`         |
| RNF-11 | O acesso ao banco fica isolado em `src/lib/db.js`, para permitir trocar SQLite por Postgres/Turso sem tocar no resto do sistema.                                                                                                                        | `[IMPLEMENTADO]`         |
| RNF-12 | Todo cálculo de disponibilidade acontece no fuso da barbearia (`America/Sao_Paulo`), configurável por `TZ`.                                                                                                                                             | `[IMPLEMENTADO]`         |
| RNF-13 | O agendamento público se completa em cerca de seis cliques, com layout pensado primeiro para o celular.                                                                                                                                                 | `[IMPLEMENTADO]` / alvo  |
| RNF-14 | Animações respeitam `prefers-reduced-motion`. Cobertura de acessibilidade (foco visível, contraste, navegação por teclado) a ampliar.                                                                                                                   | `[PARCIAL]`              |
| RNF-15 | Design system em CSS custom properties num único arquivo; a documentação desta pasta é mantida em dia com o código.                                                                                                                                     | `[IMPLEMENTADO]`         |
| RNF-16 | Suíte de testes no runner nativo do Node (`node --test`), sem framework. Hoje 136 testes, todos passando. Toda regra crítica nova entra com teste.                                                                                                      | `[IMPLEMENTADO]`         |
| RNF-17 | Logging estruturado em stdout; sem stack de observabilidade externa, por opção.                                                                                                                                                                         | `[IMPLEMENTADO]`         |
| RNF-18 | Em produção sem `SESSION_SECRET` de verdade, o sistema se recusa a subir em vez de assinar sessões com um valor previsível.                                                                                                                             | `[IMPLEMENTADO]`         |
| RNF-19 | Node 18.19 ou superior; `.nvmrc` fixa a versão 22.                                                                                                                                                                                                      | `[IMPLEMENTADO]`         |
| RNF-20 | Interface só em português do Brasil; sem camada de internacionalização.                                                                                                                                                                                 | decisão de escopo        |
| RNF-21 | As notificações ao cliente dependem de um provedor externo de WhatsApp (WhatsApp Business / Cloud API oficial) e de um provedor de e-mail (SMTP). A indisponibilidade deles não pode derrubar o agendamento — o envio é assíncrono e tolerante a falha. | `[PLANEJADO]`            |
| RNF-22 | As rotinas periódicas rodam por acionamento externo (agendador do provedor de hospedagem ou serviço de cron) chamando endpoints internos protegidos por segredo — o processo Node não precisa ficar de pé para elas acontecerem.                        | `[PLANEJADO]`            |

---

## Fora de escopo (registro de decisão)

- **Pagamento pela plataforma.** O cliente paga presencialmente, e o barbeiro
  ou o administrador registra a forma de pagamento depois.
- **Integração com Google Calendar.** A agenda do próprio sistema é a fonte.
- **Status "em atendimento".** O ciclo do agendamento não tem esse estado.
- **Bloqueio automático de cliente na bad-list.** O sistema só sinaliza; a
  decisão é do barbeiro.
- **Escolha do canal de lembrete pelo cliente.** O cliente escolhe só a
  antecedência; o envio vai por WhatsApp e e-mail.
- **Notificação administrativa de agendamento próximo.**

## Adiado (fora do primeiro release, sem data)

- **Exportação de relatórios em CSV/PDF.** O primeiro release traz só
  visualização com filtros (RF-67).
- **Aplicativo mobile.** É o próximo grande passo, depois de o site estar
  concluído.
