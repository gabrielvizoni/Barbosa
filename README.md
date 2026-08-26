# The Barbosa — Sistema de Agendamento para Barbearia

![Next.js](https://img.shields.io/badge/Next.js-14-black?logo=next.js)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-003B57?logo=sqlite&logoColor=white)
![CSS](https://img.shields.io/badge/CSS-hand--rolled%20design%20system-1572B6?logo=css3&logoColor=white)
![License](https://img.shields.io/badge/uso-projeto%20de%20cliente%20real-8a2be2)

> 🇬🇧 **In short:** a full booking platform for a real barbershop client, built solo end-to-end
> with Next.js 14 (App Router), React 18 and SQLite — no ORM, no UI framework, no auth library.
> Public booking flow (5-step wizard, real-time slot availability, double-booking-safe writes)
> plus a full admin panel (schedule, staff, services, pricing, financial dashboard, image
> uploads). Auth is hand-built: scrypt password hashing, HMAC-signed session cookies,
> timing-safe comparisons, and a self-contained SQLite-backed rate limiter — no bcrypt, no
> Redis, no NextAuth. Everything below is in Portuguese (the client and the commit history
> are Brazilian), but the code and the engineering decisions speak for themselves.

O cliente marca em **6 cliques**, informando só nome e WhatsApp. O dono da barbearia administra
tudo — agenda, equipe, serviços, preços e faturamento — por um painel próprio em `/admin`.

Este é um projeto real, em produção para uma cliente de verdade (não é um boilerplate nem um
tutorial seguido à risca): as decisões abaixo vieram de problemas reais que apareceram durante
o desenvolvimento e o uso — dois agendamentos disputando o mesmo horário, calendário nativo do
navegador que não dava pra estilizar, gráfico que ficava enorme em tela larga, texto sumindo
por causa de uma classe de CSS esquecida. O histórico de commits conta essa história em ordem.

---

## Destaques técnicos

**Autenticação construída do zero, sem biblioteca pronta.** Senha guardada como hash `scrypt`
(nunca em texto), cookie de sessão assinado com HMAC-SHA256 (não é só um ID que confia numa
consulta ao banco — o próprio cookie carrega e prova sua validade), comparação em tempo
constante (`timingSafeEqual`) para não vazar informação pelo tempo de resposta, e um número de
versão de sessão que, ao trocar a senha, invalida todos os outros cookies emitidos antes —
sem precisar de uma tabela de sessões ativas. Em produção, se `SESSION_SECRET` não estiver
configurado, o painel recusa a funcionar de propósito, em vez de assinar sessões com um valor
previsível.

**Controle de tentativas sem Redis nem serviço externo.** O limitador de requisições (login e
agendamento público) é uma tabela SQLite: cada tentativa vira uma linha, e a janela de tempo
decide se a próxima passa. Simples, sem infraestrutura extra, e resolve o problema real (força
bruta e spam de agendamento) sem trazer uma dependência pesada para um problema pequeno.

**Escrita à prova de corrida.** Dois clientes podem estar olhando o mesmo horário livre ao
mesmo tempo — a disponibilidade é conferida de novo contra o banco no instante de salvar,
dentro de uma verificação atômica. Se alguém tiver marcado no meio do caminho, quem chegou
depois recebe o aviso e escolhe outro horário, em vez de sobrescrever silenciosamente.

**Upload de imagem validado pelo conteúdo, não pelo nome.** O endpoint de upload lê os
primeiros bytes do arquivo (assinatura/"magic number") para confirmar que é mesmo um PNG,
JPG, WEBP ou GIF — um arquivo malicioso renomeado com extensão de imagem não passa, mesmo que
o `Content-Type` enviado pelo navegador diga o contrário.

**Calendário próprio no lugar dos controles nativos.** `<input type="date">` e `<select>`
resolvem no protótipo, mas o menu de opções que o navegador desenha por cima é praticamente
impossível de estilizar — e, num modal com `overflow: hidden`, ele simplesmente fica cortado.
A solução foi construir um seletor de data e uma lista suspensa próprios, desenhados num
portal React fixado à janela (escapando de qualquer contêiner com `overflow` ou `z-index`
concorrente), com posicionamento calculado a partir do elemento que os abre e ajuste automático
de lado quando não cabe embaixo. O calendário do agendamento público vai além: mostra a grade
real da semana (segunda a domingo), com os dias sem expediente visíveis e desabilitados em vez
de simplesmente desaparecerem — porque um horário livre fora da grade fixa de 30 minutos (ex.:
9h45, logo depois de um atendimento curto) não podia ficar escondido do cliente.

**Cadastro nunca é apagado, só desativado.** Um serviço ou profissional que sai do quadro some
do site e do fluxo de agendamento, mas os atendimentos antigos continuam intactos no
financeiro — histórico não é sacrificado por uma exclusão.

**Design system em CSS puro, sem framework.** Sem Tailwind, sem biblioteca de componentes:
paleta, tipografia, espaçamento e raios de borda vivem como CSS custom properties no topo de
um único arquivo. Mudou a variável, mudou o site inteiro e o painel administrativo junto —
inclusive claro/escuro dos gráficos SVG desenhados à mão para o painel financeiro.

---

## Stack

| Camada | Escolha | Por quê |
|---|---|---|
| Framework | **Next.js 14** (App Router) | Server components para dados, rotas de API para as ações do painel, tudo num só projeto. |
| UI | **React 18**, CSS puro | Sem dependência de biblioteca de componentes — cada peça de UI (modal, seletor de data, calendário) foi construída sob medida para o caso de uso. |
| Banco | **SQLite** via `better-sqlite3` | Um arquivo, zero infraestrutura de banco para operar. Toda consulta usa *prepared statements* — sem ORM, sem query builder. |
| Animação | **anime.js** | Entrada dos cartões e da capa, sensível a `prefers-reduced-motion`. |
| Autenticação | Zero dependências | `crypto` nativo do Node: scrypt, HMAC, comparação em tempo constante. |

---

## Rodar na sua máquina

Precisa do [Node.js 18 ou mais novo](https://nodejs.org).

```bash
npm install
cp .env.example .env      # depois abra o .env e troque a senha
npm run migrate           # cria/atualiza data/app.db
npm run dev
```

Abra `http://localhost:3000`. O painel fica em `http://localhost:3000/admin`.

`npm run migrate` aplica as migrations versionadas de `src/lib/migrations.js` — é obrigatório
antes da primeira execução, e de novo sempre que uma migration nova for adicionada; sem isso
`getDb()` se recusa a subir. O banco criado vem **vazio**: zero profissionais, zero serviços,
zero produtos — é um sistema white-label, cadastre sua própria equipe e seus serviços no
painel. Enquanto não houver nenhum serviço, o agendamento fica fechado.

---

## Antes de publicar

Abra o `.env` e defina:

| Variável | Para que serve |
|---|---|
| `ADMIN_PASSWORD` | Senha **só do primeiro acesso**. Depois que a senha for trocada dentro do painel, esta deixa de valer (veja "Senha do painel" abaixo). |
| `SESSION_SECRET` | Assina o cookie de sessão. Gere um valor aleatório (comando abaixo). **Obrigatório em produção** — com `NODE_ENV=production` e sem essa variável, o painel fica indisponível de propósito (em vez de assinar sessões com um valor fraco e previsível). |
| `DATABASE_PATH` | Onde o banco fica salvo. Em produção, aponte para um disco que não se apaga. |
| `TZ` | `America/Sao_Paulo` — é o fuso usado para calcular os horários livres. |

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Depois, no painel, vá em **Configurações** e preencha o WhatsApp da barbearia. Sem ele, o
botão de confirmação não aparece para o cliente no fim do agendamento.

Na primeira vez que entrar com a senha do `ADMIN_PASSWORD`, o painel fica travado — só
Configurações abre — até você definir uma senha própria em **Configurações → Senha do
painel**. É de propósito: evita que o site fique no ar com a senha padrão de instalação.

---

## Senha do painel

Entre a primeira vez com a senha do `ADMIN_PASSWORD`. Em **Configurações → Senha do painel**,
defina uma senha própria — o painel avisa enquanto isso não for feito.

A partir daí a senha vive no banco, guardada como hash `scrypt`: nem o painel nem um backup
do arquivo mostram a senha em texto. **A do `.env` deixa de funcionar.** Trocar a senha
desconecta qualquer outro aparelho com o painel aberto; quem trocou continua logado.

### Se a senha for esquecida

Apague o hash do banco e a senha do `.env` volta a valer, dando um novo primeiro acesso:

```bash
sqlite3 data/app.db "DELETE FROM config WHERE chave = 'senha_hash';"
```

Nenhum outro dado é afetado — agendamentos, serviços e histórico continuam intactos.

---

## Onde hospedar

O sistema guarda os dados em um arquivo SQLite, então precisa de um servidor com **disco
persistente** — e o mesmo disco precisa cobrir tanto `data/` (o banco) quanto
`public/uploads/` (as imagens enviadas pelo painel). Funcionam bem:

- **Railway**, **Render** ou **Fly.io** — adicione um volume e aponte `DATABASE_PATH` para
  dentro dele (ex.: `/data/app.db`), garantindo que `public/uploads/` também esteja
  nesse volume (ou em outro volume igualmente persistente).
- **VPS** (Hostinger, DigitalOcean, Contabo) com `npm run build && npm start` atrás de um
  Nginx, ou rodando com PM2.

> **Atenção com a Vercel:** o plano padrão não guarda arquivos entre execuções, então o
> banco seria apagado. Para usar a Vercel, troque o SQLite por um banco gerenciado
> (Postgres, Turso). Se quiser seguir esse caminho, o único arquivo a mexer é
> `src/lib/db.js` — o resto do sistema não sabe qual banco está por baixo.

Build de produção:

```bash
npm run build
npm run migrate
npm start
```

### Backup

Copie `data/app.db` periodicamente e você tem o backup dos dados: agendamentos,
serviços, produtos, equipe e configurações. As imagens enviadas pelo painel (logo, fotos
de profissionais/serviços/produtos) ficam em `public/uploads/` — copie essa pasta junto
para o backup incluir também as fotos.

---

## Como o sistema está organizado

```
src/
  app/
    page.jsx                    Página inicial
    agendar/                    Fluxo de agendamento em 5 passos
    admin/                      Painel administrativo
    api/
      public/                   Serviços, equipe e dias disponíveis
      horarios/                 Horários livres de um barbeiro num dia
      agendamentos/             Recebe o agendamento do cliente
      admin/                    Rotas protegidas por senha
  components/
    Icones.jsx                  Ícones em SVG
    admin/                      Telas do painel (inclui o seletor de data/lista próprios)
  lib/
    db.js                       Conexão e funções de leitura/escrita do banco
    migrations.js               Migrations versionadas do schema
    slots.js                    Cálculo dos horários livres
    auth.js                     Sessão do painel
    limitador.js                Controle de tentativas (rate limit)
    format.js                   Moeda, telefone, datas, link do WhatsApp
scripts/
  migrate.js                    `npm run migrate` — aplica as migrations pendentes
```

---

## O que o painel faz

**Visão geral** — o dia de hoje: quantos agendamentos, quanto está previsto entrar, quem
trabalha e o que acabou de chegar.

**Agenda** — alterna entre a visão do dia por profissional (hora a hora, com telefone e
observação do cliente à vista) e a lista completa, com busca por nome ou telefone e filtros
por status, profissional e data. Dá para confirmar, concluir, cancelar, excluir, chamar o
cliente no WhatsApp e registrar quem chegou sem marcar (botão *Encaixar cliente*).

**Profissionais, Serviços, Produtos** — cadastro completo: incluir, editar e excluir. Em
Serviços você define preço, duração e **quem executa cada um** — é isso que monta a segunda
tela do agendamento.

**Horários e folgas** — o expediente de cada dia da semana e os bloqueios. Se precisar sair,
os botões *Saí por 1 hora*, *Saí por 2 horas* e *Fechar o resto do dia* fecham a agenda a
partir daquele minuto, com um clique. Os horários somem do site na hora.

**Financeiro** — faturamento já recebido e a receber no mês, comparado com outro mês à sua
escolha, evolução dos últimos 12 meses (com opção de sobrepor o mesmo período do ano
anterior), serviços mais feitos e desempenho por profissional.

**Configurações** — nome, frase de apresentação, WhatsApp, endereço, de quanto em quanto
tempo abrir horários, antecedência mínima, quantos dias à frente aceitar e se o agendamento
já entra confirmado ou fica pendente.

---

## Paleta e tipografia

Marrom `#4b2e1c` (primária), verde escuro `#1b3b2c` (secundária), dourado `#c6a02c`
(terciária), sobre creme `#f4ecdc`. Títulos em Playfair Display, texto em Karla, números e
etiquetas em IBM Plex Mono.

Tudo isso está no topo de `src/app/globals.css`, em variáveis CSS. Mudou lá, mudou no site
e no painel inteiro.
