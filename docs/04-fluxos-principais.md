# 04 — Fluxos principais

Cada fluxo descreve o caminho feliz, as alternativas e as exceções. Situação
segue a [legenda](README.md#legenda-de-situação). Os fluxos `[IMPLEMENTADO]`
refletem o código atual; os `[PLANEJADO]` são a especificação a construir.

Índice:

1. [Agendamento](#1-agendamento)
2. [Cancelamento pelo cliente](#2-cancelamento-pelo-cliente-planejado)
3. [Remarcação](#3-remarcação)
4. [Confirmação e notificações](#4-confirmação-e-notificações-planejado)
5. [Atendimento, conclusão, comanda e caixa](#5-atendimento-conclusão-comanda-e-caixa-planejado)
6. [Lembrete automático](#6-lembrete-automático-planejado)
7. [Faltas e bad-list](#7-faltas-e-bad-list-planejado)
8. [Acesso ao painel: login e bootstrap](#8-acesso-ao-painel-login-e-bootstrap-implementado)
9. [Recuperação de senha do painel](#9-recuperação-de-senha-do-painel-implementado)
10. [Bloqueio de horário e saídas rápidas](#10-bloqueio-de-horário-e-saídas-rápidas-implementado)

---

## 1. Agendamento

`[IMPLEMENTADO]` hoje (anônimo) · alvo: autenticado.

**Ator:** cliente. **Entrada:** `/agendar`. **Regras:** RN-01 a RN-13, RN-21.
**Alvo:** RN-50 — agendar exige conta de cliente.

**Fluxo principal**

0. _(situação alvo)_ Cliente entra na conta ou cria uma; os dados de contato passam a vir da conta. Hoje esse passo não existe.
1. O site carrega serviços, equipe e dias disponíveis (`GET /api/public`).
2. Cliente escolhe o **serviço**.
3. Cliente escolhe o **profissional** entre os que realizam o serviço.
4. Cliente escolhe o **dia** no calendário próprio (só dias com expediente dentro da janela de `dias_futuros`).
5. O site busca os **horários livres** do par profissional + serviço naquele dia (`GET /api/horarios`).
6. Cliente escolhe o **horário**.
7. Cliente informa **nome** e **WhatsApp** (hoje); na situação alvo, confere os dados da conta.
8. Cliente confere o **resumo** (serviço, profissional, data, hora, duração, valor).
9. Cliente confirma (`POST /api/agendamentos`). O servidor abre uma transação imediata, **reconfere a disponibilidade com o lock preso** e grava o agendamento como `confirmado` (se `confirmacao_automatica = "1"`) ou `pendente`.
10. O site mostra a **confirmação** com o botão de WhatsApp da barbearia. Na situação alvo, dispara a confirmação por e-mail e pelo bot (fluxo 4).

**Alternativas**

- 0a — _(alvo)_ Cliente sem conta: é levado ao cadastro antes de escolher o serviço.
- 4a / 5a — Dia sem expediente ou agenda cheia: nenhum horário aparece; o cliente volta ao passo 4.
- 9a — `confirmacao_automatica` desligada: o agendamento entra `pendente` e aguarda ação do painel (fluxo 4).

**Exceções**

- 9b — O horário foi ocupado entre os passos 6 e 9 (RN-09): resposta **409**, o cliente volta ao passo 5 com aviso.
- 9c — Serviço ou profissional desativado no intervalo: **400**.
- 9d — Mais de 6 tentativas em 10 minutos: **429**.
- 9e — Falha inesperada: **500** genérico; nada é gravado (transação desfeita).

---

## 2. Cancelamento pelo cliente `[PLANEJADO]`

**Ator:** cliente autenticado. **Entrada:** área do cliente → histórico. **Regra:** RN-22.

**Fluxo principal**

1. Cliente abre o histórico e seleciona um agendamento futuro.
2. Sistema verifica que faltam **mais de 30 minutos** para o horário.
3. Cliente confirma o cancelamento.
4. Status vai para `cancelado`; o horário volta a ficar disponível (o índice de duplicidade ignora `cancelado`).
5. Sistema dispara o aviso de status (fluxo 4).

**Exceções**

- 2a — Faltam 30 minutos ou menos: a ação fica bloqueada, com orientação para falar pelo WhatsApp da barbearia.
- 3a — O agendamento já está `concluido`, `cancelado` ou `no-show`: a ação não é oferecida.

---

## 3. Remarcação

**Pelo painel — `[IMPLEMENTADO]`** (`PATCH /api/admin/agendamentos/[id]`, modo B)

1. Operador escolhe novo dia, horário e, opcionalmente, profissional ou serviço.
2. Sistema revalida disponibilidade dentro de transação; se trocou o serviço, **recota** preço, duração e fim.
3. Grava a nova data/hora **sem mudar o status**.

- Exceção: agendamento `concluido` ou `cancelado` não pode ser remarcado (**400**); conflito de horário → **409**.

**Pelo cliente — `[PLANEJADO]`**: igual ao cancelamento (fluxo 2) quanto ao corte de 30 minutos; em seguida o cliente escolhe um novo horário entre os disponíveis e o sistema revalida e grava.

---

## 4. Confirmação e notificações `[PLANEJADO]`

**Ator:** sistema + operador do painel.

**Fluxo principal**

1. Agendamento entra `pendente` (confirmação manual) ou `confirmado` (automática).
2. Se `pendente`: operador **confirma** na agenda.
3. Ao ficar `confirmado`, o sistema:
   - registra o agendamento na agenda administrativa (já ocorre);
   - envia **confirmação por e-mail** ao endereço da conta do cliente;
   - envia **confirmação pelo bot de WhatsApp**.
4. O cliente vê a confirmação também no painel do cliente.
5. Toda mudança de status posterior (`concluido`, `cancelado`, `no-show`) dispara um aviso pelo bot de WhatsApp e uma **notificação administrativa** no painel (novo agendamento, cancelamento, remarcação, mudança de status).

**Regras / decisões**

- O canal é a **WhatsApp Business Platform / Cloud API oficial** (número
  próprio da barbearia), não links nem serviços de terceiros.
- A **confirmação por e-mail** sai só quando o agendamento é confirmado.
  Cancelamento e remarcação são comunicados pelo bot, conforme o status.
- O bot comunica **apenas o status**; o detalhe fica no painel do cliente.
- O envio é **assíncrono e tolerante a falha** — a indisponibilidade do
  provedor de WhatsApp ou de e-mail não impede confirmar o agendamento.
- **Não há** notificação administrativa de "agendamento próximo".
- Sem integração com Google Calendar.

---

## 5. Atendimento, conclusão, comanda e caixa `[PLANEJADO]`

**Atores:** barbeiro, administrador, caixa.

**Fluxo principal**

1. Início do dia: o administrador **abre o caixa** com o valor inicial.
2. Cliente é atendido. O barbeiro (ou o admin) abre a **comanda** vinculada ao agendamento.
3. Acrescenta à comanda os **serviços realizados** e os **produtos** consumidos ou vendidos. Cada produto valida o estoque na hora.
4. Ao terminar, o barbeiro marca o agendamento como **`concluido`** — isso conta como comparecimento nas métricas do cliente. **A comanda só pode ser fechada depois disso** (RN-33).
5. O cliente paga presencialmente. O operador **fecha a comanda**, registrando **uma ou mais formas de pagamento** que somem o total (RN-30).
6. O sistema lança o(s) pagamento(s) no **caixa** e dá **baixa no estoque** dos produtos.
7. Fim do dia: o administrador **fecha o caixa**; o sistema apura o total esperado e registra o valor conferido, com a diferença.

**Alternativas**

- 2a — **Venda avulsa** (produto sem atendimento): comanda avulsa, sem agendamento nem passo 4, segue dos passos 3 a 6.
- 4a — Cliente **não compareceu**: o agendamento vai para `no-show` (fluxo 7); nenhuma comanda é aberta.

**Exceções**

- 3a / 5a — Estoque insuficiente para um item de produto: o sistema **impede** de adicionar o item (ou de fechar a comanda) e avisa o administrador; o estoque nunca fica negativo (RN-34).
- 5b — Tentativa de fechar a comanda com o agendamento ainda não `concluido`: bloqueada (RN-33).

---

## 6. Lembrete automático `[PLANEJADO]`

**Ator:** sistema, acionado por **agendador externo** (RNF-22).

**Fluxo principal**

1. O cliente define, na conta ou no agendamento, a antecedência do lembrete (15, 30, 45 min; 1, 2, 3, 6, 12 ou 24 h). O cliente escolhe só o tempo — o envio vai sempre por **WhatsApp e e-mail**.
2. O agendador externo chama, de tempos em tempos, um endpoint interno protegido por segredo.
3. A rotina seleciona os agendamentos `confirmado` cujo horário menos a antecedência escolhida caiu no intervalo desde a última execução.
4. Para cada um, revalida o status, envia o lembrete pelo bot e por e-mail e marca como enviado, para não repetir.

**Exceções**

- 4a — Agendamento cancelado, remarcado ou já `no-show` na hora do disparo: o envio é suprimido.
- 2a — Chamada sem o segredo correto: **401/403**, nada é processado.

---

## 7. Faltas e bad-list `[PLANEJADO]`

**Ator:** sistema, por rotina periódica (agendador externo — RNF-22).

**Fluxo principal**

1. A rotina varre os agendamentos `confirmado` cujo horário **já passou** sem conclusão e marca cada um como **`no-show`** (RN-18). O horário volta a ficar disponível.
2. Para cada `no-show`, incrementa o contador de **faltas** do cliente.
3. Se o contador chega a **3** `no-show` sem nenhuma conclusão entre eles, o cliente entra na **bad-list**. Um cancelamento **não** interrompe a contagem (RN-24) — ex.: 2 `no-show` → cancelamento → `no-show` = 3.
4. A situação da bad-list aparece para o barbeiro/admin na ficha do cliente e na linha do agendamento.
5. Quando esse cliente **comparece** e o atendimento é **concluído**, o contador zera e ele **sai** da bad-list (RN-25).

**Regras**

- O admin pode **reverter** um `no-show` marcado por engano (cliente que na verdade compareceu).
- A bad-list **não** bloqueia novos agendamentos, **não** notifica o cliente e **não** dispara nenhuma ação automática além da sinalização. A conduta fica a critério do barbeiro.

---

## 8. Acesso ao painel: login e bootstrap `[IMPLEMENTADO]`

**Entrada:** `/admin`. **Regras:** RN-35, RN-36.

**Fluxo — primeiro acesso (bootstrap)**

1. `GET /api/admin/sessao` responde `modoBootstrap: true`.
2. A tela pede **só a senha** (a do ambiente, `ADMIN_PASSWORD`).
3. `POST /api/admin/login` confere a senha de bootstrap e abre uma sessão de bootstrap. O painel fica **travado** — só Configurações abre.
4. O administrador conclui o bootstrap (`POST /api/admin/bootstrap`): escolhe um profissional ou informa um nome, define e-mail e senha.
5. O sistema promove/cria o `admin` com login, derruba as sessões de bootstrap e abre uma sessão de barbeiro. O painel destrava.

**Fluxo — acesso normal**

1. `GET /api/admin/sessao` responde `modoBootstrap: false`.
2. A tela pede **e-mail e senha**.
3. `POST /api/admin/login` chama `autenticarBarbeiro`; em acerto, emite o cookie `admin_sessao` (HttpOnly, SameSite=Strict, 12 h, Secure em produção).

**Situação alvo:** entre os passos 2 e 3, os papéis `admin` e `superadmin`
informam o código TOTP; a sessão só é emitida com o segundo fator conferido
(RN-40).

**Exceções**

- Servidor mal configurado em produção (sem `SESSION_SECRET`): **503** com mensagem para quem cuida da hospedagem.
- Senha ou e-mail incorretos: **401**. 8 falhas por IP em 15 min, ou 50 no total, disparam **429** (bloqueio global de 60 s).
- Sessão expirada, assinatura inválida ou `sessao_versao` defasada: **401** nas rotas protegidas.
- Requisição de mutação com `Origin` de host diferente do `Host`: **403** (proteção CSRF).

---

## 9. Recuperação de senha do painel `[IMPLEMENTADO]`

**Regra:** RN-37, RN-38. **Janela do token:** 30 minutos, uso único.

**Fluxo principal**

1. Na tela de login, o barbeiro informa o e-mail (`POST /api/admin/esqueci-senha`).
2. O sistema **sempre** responde a mesma mensagem genérica (não revela se o e-mail existe). Se existir e tiver login ativo, gera um token, grava o **hash** dele e envia por e-mail um link `\/admin?token=…`.
3. O barbeiro abre o link; a tela de `/admin` detecta o `token` e mostra o formulário de nova senha.
4. `POST /api/admin/redefinir-senha` consome o token (nunca diz se era inexistente, expirado ou já usado), grava a nova senha, apaga os tokens pendentes daquele barbeiro e derruba as sessões dele.

**Variante — convite de profissional** (`POST /api/admin/barbeiros/[id]/reenviar-convite`): mesmo mecanismo de token, com o texto do e-mail ajustado para "ative sua conta". Exige que o profissional tenha e-mail cadastrado e login ativo.

**Limites:** 5 pedidos por IP em 15 min e 3 por e-mail em 60 min → **429**.

---

## 10. Bloqueio de horário e saídas rápidas `[IMPLEMENTADO]`

**Ator:** administrador. **Entrada:** painel → Horários e folgas.

**Fluxo principal**

1. O administrador cria um **bloqueio**: data, início, fim, motivo e, opcionalmente, o profissional (sem profissional = toda a equipe).
2. `POST /api/admin/bloqueios` grava e devolve a lista de **`atropelados`** — os agendamentos ativos que caem dentro do intervalo bloqueado.
3. Os horários bloqueados somem imediatamente do site (o cálculo de disponibilidade os exclui).

**Variante — saídas rápidas:** os botões "saí por 1 hora", "saí por 2 horas" e "fechar o resto do dia" criam um bloqueio a partir do minuto atual até o fim da janela escolhida, com um clique.

**Exceção:** `fim <= inicio` é barrado pelo validador e pelo `CHECK` do banco.

---

## Decisões registradas

Definições que fecharam os pontos antes em aberto nestes fluxos:

- **Fluxo 4** — canal é a WhatsApp Business Platform / Cloud API oficial, número
  próprio da barbearia; envio assíncrono e tolerante a falha.
- **Fluxo 5** — concluir o agendamento é pré-requisito para fechar a comanda; a
  venda de produto sem estoque é bloqueada (nunca fica negativo); a comanda
  aceita múltiplas formas de pagamento.
- **Fluxo 6** — lembrete por WhatsApp e e-mail; o cliente escolhe só a
  antecedência. Disparo por agendador externo, não por processo Node contínuo.
- **Fluxo 7** — o `no-show` é automático: toda rotina marca os `confirmado` que
  passaram do horário sem conclusão.
