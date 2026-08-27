# The Barbosa — Sistema de Agendamento para Barbearia

![Next.js](https://img.shields.io/badge/Next.js-14-black?logo=next.js)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-003B57?logo=sqlite&logoColor=white)
![Testes](https://img.shields.io/badge/testes-114%20passando-2e7d32)
![Autenticação](https://img.shields.io/badge/autentica%C3%A7%C3%A3o-sem%20biblioteca-c6a02c)
![Projeto](https://img.shields.io/badge/projeto-cliente%20real%20em%20produ%C3%A7%C3%A3o-8a2be2)

**Plataforma completa de agendamento para uma barbearia real, em produção, construída sozinho de
ponta a ponta** — Next.js 14 (App Router), React 18 e SQLite. Sem ORM, sem biblioteca de
componentes, sem biblioteca de autenticação.

> 🇬🇧 **In short** — A full booking platform for a real barbershop client, live in production,
> built solo end to end with Next.js 14 (App Router), React 18 and SQLite. A public booking flow
> (5-step wizard, live slot availability, double-booking-safe writes) plus a complete admin panel
> (schedule, staff, services, pricing, financial dashboard, image uploads). Auth is hand-built:
> scrypt password hashing, HMAC-signed session cookies, timing-safe comparisons, and a
> self-contained SQLite rate limiter — no bcrypt, no Redis, no NextAuth. 114 tests on Node's
> built-in runner. The prose below is in Portuguese (Brazilian client and commit history); the
> code and the engineering decisions carry across.

O cliente marca em **6 cliques**, informando só nome e WhatsApp. O dono da barbearia administra
tudo — agenda, equipe, serviços, preços e faturamento — por um painel próprio em `/admin`.

Não é boilerplate nem um tutorial seguido à risca. As decisões descritas abaixo vieram de
problemas reais que apareceram durante o desenvolvimento e o uso: dois agendamentos disputando o
mesmo horário, um calendário nativo do navegador impossível de estilizar dentro de um modal, um
gráfico que estourava em tela larga, um texto sumindo por causa de uma classe de CSS esquecida.
O histórico de commits conta essa história em ordem.

---

## Em números

| | |
| --- | --- |
| Agendamento do cliente | **~6 cliques**, só nome + WhatsApp |
| Testes automatizados | **114**, no runner nativo do Node — zero framework de teste |
| Dependências de autenticação | **0** — só o módulo `crypto` do Node |
| Dependências de runtime (total) | 6 (`next`, `react`, `react-dom`, `better-sqlite3`, `sharp`, `animejs`) |
| Migrations versionadas | 5, com trava de boot por versão |
| Código | ~10 mil linhas de JS/JSX + ~2,5 mil de CSS num único design system |
| Time | 1 pessoa, do schema do banco ao CSS |

---

## O que o sistema faz

### Agendamento público — `/agendar`

Assistente de 5 passos: **serviço → profissional → dia → horário → contato**.

- **Calendário próprio**, desenhado do zero: mostra a grade real da semana (segunda a domingo, 7
  colunas sempre), com os dias sem expediente visíveis e desabilitados em vez de simplesmente
  sumirem, e só habilita o que está dentro da janela de agendamento configurada.
- **Disponibilidade calculada ao vivo** contra o banco, no fuso da barbearia, respeitando
  expediente, duração do serviço, agendamentos já marcados, bloqueios e antecedência mínima.
- **Gravação à prova de corrida**: a disponibilidade é reconferida no instante de salvar, dentro
  de uma transação; quem chegou depois recebe o aviso e escolhe outro horário.
- Entra **confirmado** ou **pendente**, conforme a configuração da barbearia.

### Painel administrativo — `/admin`

- **Visão geral** — o dia de hoje: quantos agendamentos, quanto está previsto entrar, quem
  trabalha e o que acabou de chegar.
- **Agenda** — a régua do dia por profissional (hora a hora, com telefone e observação à vista)
  ou a lista completa, com busca por nome/telefone e filtros por status, profissional e data.
  Confirmar, concluir, cancelar, excluir, chamar no WhatsApp e _Encaixar cliente_ que chegou sem
  marcar.
- **Profissionais, Serviços, Produtos** — cadastro completo. Em Serviços você define preço,
  duração e **quem executa cada um** — é isso que monta a segunda tela do agendamento.
- **Horários e folgas** — o expediente de cada dia e os bloqueios. Os botões _Saí por 1 hora_,
  _Saí por 2 horas_ e _Fechar o resto do dia_ fecham a agenda a partir daquele minuto, com um
  clique; os horários somem do site na hora.
- **Financeiro** — recebido e a receber no mês, comparado com outro mês à escolha, evolução dos
  últimos 12 meses (com sobreposição opcional do mesmo período do ano anterior), serviços mais
  feitos e desempenho por profissional. Gráficos SVG desenhados à mão, claro/escuro incluído.
- **Configurações** — identidade da barbearia, WhatsApp, endereço, granularidade dos horários,
  antecedência mínima, janela de dias à frente e se o agendamento já entra confirmado.

---

## Destaques de engenharia

**Autenticação construída do zero, sem biblioteca pronta.** Senha guardada como hash `scrypt`
(nunca em texto), com os parâmetros de custo gravados no próprio hash para poderem evoluir sem
invalidar senhas já definidas. O cookie de sessão é assinado com HMAC-SHA256 e carrega a própria
validade — não é um ID que confia numa consulta ao banco. Comparações em tempo constante
(`timingSafeEqual`) para não vazar informação pelo tempo de resposta. Um número de versão de
sessão que, ao trocar a senha, invalida todos os cookies emitidos antes — sem tabela de sessões
ativas. Em produção, sem `SESSION_SECRET` de verdade, o painel se recusa a funcionar em vez de
assinar sessões com um valor previsível.

**Controle de tentativas sem Redis nem serviço externo.** O limitador (login e agendamento
público) é uma tabela SQLite: cada tentativa é uma linha, e a janela de tempo decide se a
próxima passa. Além do limite por chave, há um disjuntor global — se o total de falhas de login
estoura a janela, qualquer tentativa fica bloqueada por alguns segundos, fechando a porta para
quem rotaciona IP. Limpeza amostrada (1 em 100 chamadas) para a tabela não crescer.

**Escrita à prova de corrida, garantida pelo banco.** Dois clientes podem estar olhando o mesmo
horário livre. A gravação acontece dentro de uma transação `BEGIN IMMEDIATE` que reconfere a
disponibilidade depois de já ter o lock de escrita; e um **índice único parcial**
(`idx_ag_sem_duplicidade`) é a garantia final — se a revalidação passar por algum motivo, o
índice barra, e o erro de constraint vira um "escolha outro horário" para o cliente.

**Máquina de estados para o ciclo do agendamento.** `pendente → confirmado → concluído`, com
`cancelado` podendo voltar — mas só por transições legais e revalidando o horário na volta.
Isso evita um caso concreto: cliente cancela, o horário é reoferecido, outra pessoa marca, e o
barbeiro clica em "Confirmar" na linha do cancelado — dois agendamentos no mesmo horário.

**Upload de imagem validado pelo conteúdo, não pelo nome.** O endpoint lê os primeiros bytes
(assinatura / _magic number_) para confirmar que é mesmo PNG, JPG, WEBP ou GIF — um arquivo
malicioso renomeado não passa, mesmo que o `Content-Type` diga o contrário. O que passa é
reprocessado com `sharp` (reduzido a 700px de largura, convertido para WebP) e salvo com nome
UUID; o caminho do arquivo anterior só é apagado se casar exatamente com o formato esperado.

**Cadastro nunca é apagado, só desativado — e toda mudança fica registrada.** Um serviço ou
profissional que sai do quadro some do site, mas os atendimentos antigos continuam intactos no
financeiro. Agendamento excluído é _soft delete_ (`excluido_em`), e cada criação, remarcação,
mudança de status e exclusão grava uma linha na tabela `auditoria` com o antes e o depois —
necessário porque o painel usa uma senha compartilhada pela equipe, então não há usuário
individual para responsabilizar. A auditoria nunca guarda nome ou telefone do cliente.

**Calendário próprio no lugar do controle nativo.** No fluxo público, `<input type="date">`
resolve no protótipo, mas o menu que o navegador desenha por cima é praticamente impossível de
estilizar e, num modal com `overflow: hidden`, fica cortado. O calendário próprio mostra a grade
real da semana e trata um detalhe que o controle nativo esconde: um horário livre fora da grade
fixa de 30 minutos (ex.: 9h45, logo depois de um atendimento curto) aparece para o cliente em
vez de ser engolido até o próximo múltiplo.

**CSP com nonce por requisição, no middleware.** A política de segurança de conteúdo é montada a
cada requisição com um nonce novo, porque o Next injeta scripts inline com o payload de
streaming dos Server Components — `script-src 'self'` sozinho quebraria o site em produção. Mora
no middleware (e não no `next.config`) justamente por precisar do nonce por request; acompanha
`X-Frame-Options`, `nosniff`, HSTS e verificação de `Origin` nas mutações (CSRF).

**Design system em CSS puro, sem framework.** Sem Tailwind, sem biblioteca de componentes:
paleta, tipografia, espaçamento e raios de borda vivem como CSS custom properties no topo de um
único arquivo. Mudou a variável, mudou o site inteiro e o painel junto.

---

## Stack

| Camada | Escolha | Por quê |
| --- | --- | --- |
| Framework | **Next.js 14** (App Router) | Server Components para dados, Route Handlers para as ações do painel, tudo num só projeto. |
| UI | **React 18**, CSS puro | Sem biblioteca de componentes — cada peça (modal, calendário, gráficos) foi construída sob medida. |
| Banco | **SQLite** via `better-sqlite3` | Um arquivo, zero infraestrutura para operar. Toda consulta usa _prepared statements_ — sem ORM, sem query builder. |
| Imagens | **sharp** | Reprocessa todo upload: redimensiona e converte para WebP no servidor. |
| Animação | **anime.js** | Entrada dos cartões e da capa, sensível a `prefers-reduced-motion`. |
| Autenticação | **zero dependências** | `crypto` nativo do Node: scrypt, HMAC, comparação em tempo constante. |
| Testes | **runner nativo do Node** (`node --test`) | 114 testes, sem Jest nem Vitest. |

---

## Testes

```bash
npm test
```

114 testes no runner embutido do Node, cobrindo a lógica que não pode quebrar:

- **Concorrência** — dois agendamentos disputando o mesmo horário em processos separados; só um grava.
- **Autenticação e sessão** — assinatura do cookie, expiração, versão de sessão, hash `scrypt` (formato novo e legado).
- **Autorização** — rotas do painel bloqueadas sem sessão, trava enquanto a senha inicial não for trocada, checagem de `Origin`.
- **Cálculo de horários livres** — expediente, duração, bloqueios, antecedência, horários fora da grade fixa.
- **Máquina de estados** — todas as transições legais e ilegais de status.
- **Validação e upload** — campos obrigatórios, telefone, detecção de tipo de arquivo por assinatura.
- **Relatórios do financeiro** — agrupamento por mês e somas de recebido/a receber.

---

## Como o código está organizado

```text
src/
  app/
    page.jsx                    Página inicial
    agendar/                    Fluxo de agendamento em 5 passos
    admin/                      Painel administrativo
    api/
      public/                   Serviços, equipe e dias disponíveis
      horarios/                 Horários livres de um profissional num dia
      agendamentos/             Recebe o agendamento do cliente
      health/                   Health check para monitor externo
      admin/                    Rotas protegidas por sessão
  components/
    Icones.jsx                  Ícones em SVG
    admin/                      Telas do painel e componentes de base
  lib/
    db.js                       Conexão e leitura/escrita do banco
    migrations.js               Migrations versionadas do schema
    agendamentos.js             Criar, remarcar e mudar status (com a máquina de estados)
    slots.js                    Cálculo dos horários livres
    auth.js                     Sessão do painel (scrypt, HMAC, timing-safe)
    limitador.js                Controle de tentativas (rate limit em SQLite)
    auditoria.js                Trilha de auditoria das mutações
    validacao.js                Validação central de entrada
    log.js                      Logging estruturado
    format.js                   Moeda, telefone, datas, link do WhatsApp
  middleware.js                 CSP com nonce + headers de segurança
scripts/
  migrate.js                    `npm run migrate` — aplica as migrations pendentes
tests/                          114 testes no runner nativo do Node
```

---

## Rodar na sua máquina

Precisa do [Node.js 18.19+](https://nodejs.org) (o projeto usa `22` no `.nvmrc`).

```bash
npm install
cp .env.example .env      # depois abra o .env e troque a senha
npm run migrate           # cria/atualiza data/app.db
npm run dev
```

Abra `http://localhost:3000`. O painel fica em `http://localhost:3000/admin`.

`npm run migrate` aplica as migrations versionadas de `src/lib/migrations.js` — obrigatório antes
da primeira execução e sempre que uma migration nova entrar; sem isso, `getDb()` se recusa a
subir. O banco criado vem **vazio**: é um sistema white-label, cadastre a própria equipe e os
serviços no painel. Enquanto não houver nenhum serviço, o agendamento fica fechado.

Na primeira vez que entrar com a senha do `ADMIN_PASSWORD`, o painel fica travado — só
Configurações abre — até você definir uma senha própria em **Configurações → Senha do painel**.
É de propósito: evita que o site fique no ar com a senha padrão de instalação. A partir daí a
senha vive no banco como hash `scrypt`, e a do `.env` deixa de valer.

---

<details>
<summary><strong>Operação e deploy</strong> (variáveis de ambiente, hospedagem, backup, recuperação de senha)</summary>

### Variáveis de ambiente

| Variável | Para que serve |
| --- | --- |
| `ADMIN_PASSWORD` | Senha **só do primeiro acesso**. Depois de trocada no painel, deixa de valer. |
| `SESSION_SECRET` | Assina o cookie de sessão. Gere um valor aleatório. **Obrigatório em produção** — com `NODE_ENV=production` e sem ele, o painel fica indisponível de propósito. |
| `DATABASE_PATH` | Onde o banco fica salvo. Em produção, aponte para um disco persistente. |
| `TZ` | `America/Sao_Paulo` — fuso usado para calcular os horários livres. |
| `TRUST_PROXY` | `1` só se houver um proxy reverso confiável reescrevendo `X-Forwarded-For` / `X-Real-IP`. |

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Depois, no painel, preencha o WhatsApp da barbearia em **Configurações** — sem ele, o botão de
confirmação não aparece para o cliente no fim do agendamento.

### Onde hospedar

Os dados ficam num arquivo SQLite, então é preciso um servidor com **disco persistente** que
cubra tanto `data/` (o banco) quanto `public/uploads/` (as imagens do painel):

- **Railway**, **Render** ou **Fly.io** — adicione um volume e aponte `DATABASE_PATH` para dentro
  dele (ex.: `/data/app.db`), com `public/uploads/` no mesmo volume persistente.
- **VPS** (Hostinger, DigitalOcean, Contabo) com `npm run build && npm start` atrás de Nginx, ou
  com PM2.

> **Vercel:** o plano padrão não guarda arquivos entre execuções, então o banco seria apagado.
> Para usar a Vercel, troque o SQLite por um banco gerenciado (Postgres, Turso) — o único arquivo
> a mexer é `src/lib/db.js`; o resto do sistema não sabe qual banco está por baixo.

```bash
npm run build
npm run migrate
npm start
```

### Backup

Copie `data/app.db` periodicamente (agendamentos, serviços, produtos, equipe e configurações) e
a pasta `public/uploads/` junto (logo e fotos).

### Se a senha do painel for esquecida

Apague o hash do banco e a senha do `.env` volta a valer, dando um novo primeiro acesso:

```bash
sqlite3 data/app.db "DELETE FROM config WHERE chave = 'senha_hash';"
```

Nenhum outro dado é afetado.

</details>

---

## Paleta e tipografia

Verde escuro `#1b3b2c` (primária), marrom `#4b2e1c` (secundária), dourado `#c6a02c` (terciária),
sobre creme `#f4ecdc`. Títulos em Playfair Display, texto em Karla, números e etiquetas em IBM
Plex Mono. Tudo no topo de `src/app/globals.css`, em variáveis CSS — mudou lá, mudou no site e no
painel inteiro.
