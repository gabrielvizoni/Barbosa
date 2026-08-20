# The Barbosa Barbearia

Site de agendamento com painel administrativo. O cliente marca em **6 cliques**, informando
só nome e WhatsApp. Você administra tudo por `/admin`.

---

## Rodar na sua máquina

Precisa do [Node.js 18 ou mais novo](https://nodejs.org).

```bash
npm install
cp .env.example .env      # depois abra o .env e troque a senha
npm run dev
```

Abra `http://localhost:3000`. O painel fica em `http://localhost:3000/admin`.

Na primeira execução o banco é criado sozinho em `data/barbosa.db`, já com Heitor Lampa e
Ana Donegá cadastrados. **Os serviços começam vazios** — cadastre-os no painel, em Serviços.
Enquanto não houver nenhum serviço, o agendamento fica fechado.

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
sqlite3 data/barbosa.db "DELETE FROM config WHERE chave = 'senha_hash';"
```

Nenhum outro dado é afetado — agendamentos, serviços e histórico continuam intactos.

---

## Onde hospedar

O sistema guarda os dados em um arquivo SQLite, então precisa de um servidor com **disco
persistente** — e o mesmo disco precisa cobrir tanto `data/` (o banco) quanto
`public/uploads/` (as imagens enviadas pelo painel). Funcionam bem:

- **Railway**, **Render** ou **Fly.io** — adicione um volume e aponte `DATABASE_PATH` para
  dentro dele (ex.: `/data/barbosa.db`), garantindo que `public/uploads/` também esteja
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
npm start
```

### Backup

Copie `data/barbosa.db` periodicamente e você tem o backup dos dados: agendamentos,
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
    admin/                      Telas do painel
  lib/
    db.js                       Banco e estrutura das tabelas
    slots.js                    Cálculo dos horários livres
    auth.js                     Sessão do painel
    format.js                   Moeda, telefone, datas, link do WhatsApp
```

---

## O que o painel faz

**Visão geral** — o dia de hoje: quantos agendamentos, quanto está previsto entrar, quem
trabalha e o que acabou de chegar.

**Agenda do dia** — a agenda de cada barbeiro hora a hora, com telefone e observação do
cliente à vista.

**Agendamentos** — a lista completa, com busca por nome ou telefone e filtros por status,
profissional e data. Dá para confirmar, concluir, cancelar, excluir, chamar o cliente no
WhatsApp e registrar quem chegou sem marcar (botão *Encaixar cliente*).

**Profissionais, Serviços, Produtos** — cadastro completo: incluir, editar e excluir. Em
Serviços você define preço, duração e **quem executa cada um** — é isso que monta a segunda
tela do agendamento.

**Horários e folgas** — o expediente de cada dia da semana e os bloqueios. Se precisar sair,
os botões *Saí por 1 hora*, *Saí por 2 horas* e *Fechar o resto do dia* fecham a agenda a
partir daquele minuto, com um clique. Os horários somem do site na hora.

**Financeiro** — faturamento do mês comparado com outro mês à sua escolha, evolução dos
últimos 12 meses, serviços mais feitos e desempenho por profissional.

**Configurações** — nome, frase de apresentação, WhatsApp, endereço, de quanto em quanto
tempo abrir horários, antecedência mínima, quantos dias à frente aceitar e se o agendamento
já entra confirmado ou fica pendente.

---

## Detalhes que evitam dor de cabeça

- **Dois clientes no mesmo horário:** o horário é conferido de novo contra o banco na hora
  de salvar. Se alguém tiver pego no meio do caminho, o cliente recebe o aviso e volta para
  escolher outro.
- **Serviço ou profissional com histórico não é apagado:** é desativado. Some do site e do
  agendamento, mas os atendimentos antigos continuam no financeiro.
- **Encaixe manual pode ser fora do expediente** (o cliente que aparece às 21h), mas nunca
  em cima de outro atendimento ou de um bloqueio (folga/ausência) do mesmo barbeiro.
- **Fotos e logo:** cada cadastro (Profissionais, Serviços, Produtos, Configurações → Logo)
  tem um campo de upload próprio — clique em "Enviar imagem", escolha o arquivo do seu
  computador e pronto. As imagens ficam salvas em `public/uploads/`, dentro do mesmo disco
  onde está o banco (por isso, em produção, precisam do mesmo disco persistente do
  `data/barbosa.db`).

---

## Paleta e tipografia

Marrom `#4b2e1c` (primária), verde escuro `#1b3b2c` (secundária), dourado `#c6a02c`
(terciária), sobre creme `#f4ecdc`. Títulos em Playfair Display, texto em Karla, números e
etiquetas em IBM Plex Mono.

Tudo isso está no topo de `src/app/globals.css`, em variáveis CSS. Mudou lá, mudou no site
e no painel inteiro.
