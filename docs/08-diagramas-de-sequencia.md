# 08 — Diagramas de sequência

Sequências dos processos principais. As `[IMPLEMENTADO]` refletem o código
atual (rotas em `src/app/api/**`, domínio em `src/lib/**`); as `[PLANEJADO]`
são a especificação a construir.

---

## 1. Agendamento `[IMPLEMENTADO]`

Hoje o cliente é anônimo. Na situação alvo (RN-50), o fluxo começa com login ou
cadastro e os dados de contato vêm da conta; o resto da sequência é o mesmo.

```mermaid
sequenceDiagram
    actor Cliente
    participant Site as Site /agendar
    participant API as Route Handlers
    participant Ag as lib/agendamentos
    participant DB as SQLite

    Cliente->>Site: abre /agendar
    Site->>API: GET /api/public
    API->>DB: serviços ativos, equipe, dias
    DB-->>Site: catálogo

    Cliente->>Site: escolhe serviço, profissional, dia
    Site->>API: GET /api/horarios (barbeiro, servico, data)
    API->>Ag: horariosLivres(...)
    Ag->>DB: expediente, agendamentos, bloqueios
    Ag-->>Site: horários livres

    Cliente->>Site: escolhe horário, informa nome e WhatsApp, confirma
    Site->>API: POST /api/agendamentos
    API->>API: rate limit (chave agendar por IP, 6/10min)
    API->>Ag: criarAgendamento(origem: publico)
    Ag->>DB: BEGIN IMMEDIATE
    Ag->>DB: reconfere disponibilidade (lock preso)
    alt horário ainda livre
        Ag->>DB: INSERT agendamento (pendente ou confirmado)
        Ag->>DB: INSERT auditoria (sem PII)
        Ag->>DB: COMMIT
        Ag-->>Site: agendamento + whatsapp da barbearia
        Site-->>Cliente: tela de confirmação
    else horário ocupado no meio-tempo
        Ag->>DB: ROLLBACK
        Ag-->>Site: 409 "escolha outro horário"
        Site-->>Cliente: volta ao passo do horário
    end
```

---

## 2. Login individual do barbeiro `[IMPLEMENTADO]`

```mermaid
sequenceDiagram
    actor Barbeiro
    participant Painel as /admin
    participant API as /api/admin/*
    participant Auth as lib/auth
    participant DB as SQLite

    Painel->>API: GET /api/admin/sessao
    API->>Auth: modoBootstrap()
    Auth-->>Painel: modoBootstrap = false
    Painel-->>Barbeiro: tela de login (e-mail + senha)

    Barbeiro->>Painel: e-mail e senha
    Painel->>API: POST /api/admin/login
    API->>API: rate limit (por IP 8/15min + global 50/15min)
    API->>Auth: autenticarBarbeiro(email, senha)
    Auth->>DB: busca barbeiro por lower(email)
    Auth->>Auth: scrypt sempre (mesmo se e-mail não existe)
    alt credenciais corretas e login_ativo
        Auth-->>API: ok
        API->>Auth: criarSessaoBarbeiro(id)
        Auth-->>Painel: Set-Cookie admin_sessao (HMAC, 12h)
        Painel-->>Barbeiro: painel autenticado
    else falha
        API->>API: registra tentativa (IP + global)
        API-->>Painel: 401 "E-mail ou senha incorretos."
    end
```

---

## 3. Configuração inicial (bootstrap) `[IMPLEMENTADO]`

```mermaid
sequenceDiagram
    actor Admin
    participant Painel as /admin
    participant API as /api/admin/*
    participant Auth as lib/auth
    participant DB as SQLite

    Painel->>API: GET /api/admin/sessao
    API-->>Painel: modoBootstrap = true
    Painel-->>Admin: tela de bootstrap (só senha)

    Admin->>Painel: senha do ambiente (ADMIN_PASSWORD)
    Painel->>API: POST /api/admin/login
    API->>Auth: senhaBootstrapConfere(senha)
    Auth-->>Painel: Set-Cookie admin_sessao (sessão de bootstrap)
    Note over Painel: painel travado — só Configurações abre

    Admin->>Painel: escolhe profissional ou informa nome, define e-mail e senha
    Painel->>API: POST /api/admin/bootstrap
    API->>Auth: concluirBootstrap(barbeiroId, nome, email, senha)
    Auth->>DB: cria/promove barbeiro a admin com login
    Auth->>DB: bump config.sessao_versao (derruba sessões de bootstrap)
    API->>DB: INSERT auditoria (concluir_bootstrap)
    API->>Auth: criarSessaoBarbeiro(novoId)
    Auth-->>Painel: nova sessão de barbeiro
    Painel-->>Admin: painel destravado
```

---

## 4. Recuperação de senha do painel `[IMPLEMENTADO]`

```mermaid
sequenceDiagram
    actor Barbeiro
    participant Painel as /admin
    participant API as /api/admin/*
    participant Auth as lib/auth
    participant Mail as lib/email
    participant DB as SQLite

    Barbeiro->>Painel: informa o e-mail
    Painel->>API: POST /api/admin/esqueci-senha
    API->>API: rate limit (ip 5/15min, email 3/60min)
    API->>DB: busca barbeiro por e-mail
    alt existe e login_ativo
        API->>Auth: gerarTokenReset(barbeiroId, ip)
        Auth->>DB: grava hash do token, expira em 30 min
        API->>Mail: envia link /admin?token=...
    end
    API-->>Barbeiro: 200 mensagem genérica (não revela se o e-mail existe)

    Barbeiro->>Painel: abre /admin?token=...
    Painel-->>Barbeiro: formulário de nova senha
    Barbeiro->>Painel: nova senha + confirmação
    Painel->>API: POST /api/admin/redefinir-senha
    API->>Auth: consumirTokenReset(token, novaSenha)
    Auth->>DB: valida hash + expiração + não usado
    alt token válido
        Auth->>DB: grava nova senha, marca token usado, apaga pendentes
        Auth->>DB: bump barbeiros.sessao_versao (derruba sessões dele)
        API-->>Barbeiro: 200 ok
    else inválido / expirado / já usado
        API-->>Barbeiro: 400 "Link inválido ou expirado." (sem distinguir o motivo)
    end
```

---

## 5. Encaixe de cliente pelo painel `[IMPLEMENTADO]`

```mermaid
sequenceDiagram
    actor Operador
    participant Painel as /admin (Agenda)
    participant API as /api/admin/agendamentos
    participant Ag as lib/agendamentos
    participant DB as SQLite

    Operador->>Painel: "Encaixar cliente"
    Painel->>API: PUT /api/admin/agendamentos (grade para encaixe)
    API->>Ag: horariosLivres(barbeiro, servico, data)
    Ag-->>Painel: horários (encaixe pode ser fora do expediente)
    Operador->>Painel: nome, serviço, profissional, data, hora
    Painel->>API: POST /api/admin/agendamentos
    API->>Ag: criarAgendamento(origem: painel)
    Ag->>DB: BEGIN IMMEDIATE + verifica conflito (atendimento/bloqueio)
    alt sem sobreposição
        Ag->>DB: INSERT agendamento (confirmado) + auditoria + COMMIT
        API-->>Painel: 201 com o id
    else sobrepõe outro atendimento ou bloqueio
        Ag->>DB: ROLLBACK
        API-->>Painel: 409 com a mensagem do conflito
    end
```

---

## 6. Conclusão, comanda e caixa `[PLANEJADO]`

```mermaid
sequenceDiagram
    actor Barbeiro
    actor Caixa as Admin/Caixa
    participant Painel as /admin
    participant API as /api/admin/*
    participant DB as SQLite

    Caixa->>API: abre o caixa do dia (valor inicial)
    API->>DB: INSERT caixa_sessoes (aberto)

    Barbeiro->>Painel: abre comanda do agendamento
    Painel->>API: cria comanda (1:1 com o agendamento)
    API->>DB: INSERT comandas (aberta)
    Barbeiro->>Painel: adiciona serviços e produtos
    Painel->>API: adiciona itens
    alt produto com estoque suficiente
        API->>DB: INSERT comanda_itens; recalcula total
    else estoque insuficiente
        API-->>Painel: 409 "estoque insuficiente" (item não entra)
    end

    Barbeiro->>Painel: marca agendamento como concluido
    Painel->>API: PATCH /api/admin/agendamentos/[id] { status: concluido }
    API->>DB: UPDATE status (conta como comparecimento)

    Caixa->>Painel: fecha a comanda (uma ou mais formas de pagamento)
    Painel->>API: fecha comanda
    API->>API: exige agendamento vinculado em concluido
    API->>DB: INSERT pagamentos (1..N, uma linha por forma)
    API->>DB: INSERT caixa_movimentos (tipo = pagamento)
    API->>DB: UPDATE produtos SET estoque = estoque - qtd
    API->>DB: UPDATE comandas SET status = fechada

    Caixa->>API: fecha o caixa do dia (valor conferido)
    API->>DB: UPDATE caixa_sessoes (fechado, diferença)
```

A ordem é fixa: **concluir o agendamento → fechar a comanda → pagamento no
caixa** (RN-33). O item de produto é validado contra o estoque no momento de
entrar na comanda; o estoque nunca fica negativo (RN-34).

---

## 7. Rotinas periódicas: lembretes e no-show `[PLANEJADO]`

Acionadas por um **agendador externo** (cron do provedor de hospedagem ou
serviço de terceiros), que chama endpoints internos protegidos por segredo — o
processo Node não precisa ficar de pé para isso (RNF-22).

```mermaid
sequenceDiagram
    participant Sched as Agendador externo
    participant API as Endpoint interno protegido
    participant DB as SQLite
    participant Bot as WhatsApp e e-mail
    actor Cliente

    Sched->>API: POST /api/tarefas/marcar-no-show (segredo)
    API->>DB: confirmados cujo horário passou sem conclusão
    loop cada um
        API->>DB: UPDATE status = no-show (libera o horário)
        API->>DB: contador de faltas +1; bad-list se chegou a 3
    end

    Sched->>API: POST /api/tarefas/lembretes (segredo)
    API->>DB: confirmados cujo (horário - antecedência) caiu na janela
    loop cada agendamento
        API->>DB: revalida status = confirmado e lembrete não enviado
        alt ainda válido
            API->>Bot: envia lembrete por WhatsApp e e-mail
            Bot-->>Cliente: "seu horário é às HH:MM"
            API->>DB: marca lembrete como enviado
        else cancelado / remarcado / no-show
            API->>DB: ignora
        end
    end
```

---

## Decisões registradas

- **Sequência 6:** concluir o agendamento é pré-requisito para fechar a comanda;
  o item de produto sem estoque é bloqueado; a comanda aceita 1..N formas de
  pagamento.
- **Sequência 7:** as rotinas rodam por agendador externo chamando endpoints
  protegidos, não por processo Node contínuo; o `no-show` é automático; o
  lembrete vai por WhatsApp e e-mail, com o cliente escolhendo só a antecedência.
