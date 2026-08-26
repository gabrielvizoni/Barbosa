import Link from "next/link";
import {
  lerConfig,
  lerExpediente,
  listarBarbeiros,
  listarProdutos,
  listarServicos,
} from "@/lib/db";
import { moeda, iniciais, NOME_PADRAO } from "@/lib/format";
import { Local, Relogio, Seta, WhatsApp, Instagram } from "@/components/Icones";
import Header from "@/components/Header";
import ServicosSecao from "@/components/ServicosSecao";
import Animacoes from "@/components/Animacoes";

export const dynamic = "force-dynamic";

const NOMES_DIAS = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
];

/** Agrupa dias seguidos com o mesmo horário: "Segunda a sexta: 9h às 20h". */
function resumirExpediente(expediente) {
  const linhas = [];
  let grupo = null;
  for (const dia of [...expediente].sort((a, b) => a.dia - b.dia)) {
    const chave = dia.aberto ? `${dia.abre}-${dia.fecha}` : "fechado";
    if (grupo && grupo.chave === chave) {
      grupo.fim = dia.dia;
    } else {
      if (grupo) linhas.push(grupo);
      grupo = {
        chave,
        inicio: dia.dia,
        fim: dia.dia,
        aberto: dia.aberto,
        dados: dia,
      };
    }
  }
  if (grupo) linhas.push(grupo);

  return linhas.map((g) => {
    const nome =
      g.inicio === g.fim
        ? NOMES_DIAS[g.inicio]
        : `${NOMES_DIAS[g.inicio]} a ${NOMES_DIAS[g.fim].toLowerCase()}`;
    const horas = g.aberto ? `${g.dados.abre} às ${g.dados.fecha}` : "Fechado";
    return { nome, horas };
  });
}

export default function PaginaInicial() {
  const config = lerConfig();
  const todosServicos = listarServicos({ somenteAtivos: true });
  const servicos = todosServicos.filter((s) => s.barbeiros.length > 0);
  const produtos = listarProdutos({ somenteAtivos: true });
  const barbeiros = listarBarbeiros({ somenteAtivos: true });
  const expediente = resumirExpediente(lerExpediente());
  const nome = config.nome_barbearia || NOME_PADRAO;
  const linkInstagram = config.instagram
    ? `https://instagram.com/${config.instagram}`
    : null;
  const linkWhats = config.whatsapp
    ? `https://wa.me/${config.whatsapp.replace(/\D/g, "").startsWith("55") ? config.whatsapp.replace(/\D/g, "") : `55${config.whatsapp.replace(/\D/g, "")}`}`
    : null;
  const linkMapa = config.endereco
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(config.endereco)}`
    : null;

  const links = [
    { href: "#servicos", label: "Serviços" },
    { href: "#equipe", label: "Equipe" },
    ...(produtos.length > 0 ? [{ href: "#produtos", label: "Produtos" }] : []),
    { href: "#contato", label: "Contato" },
  ];

  return (
    <>
      <Header
        nome={nome}
        logoUrl={config.logo_url}
        links={links}
        cta={
          <Link href="/agendar" className="btn btn-ouro btn-mini">
            Agendar
          </Link>
        }
      />

      <main>
        {/* Capa */}
        <section className="capa">
          <div className="container capa-interna">
            <span className="sobrenome anim-entrada">Estilo & Precisão</span>
            <h1 className="anim-entrada">
              Aqui, padrão não é promessa
              <br />
              <em>É Resultado</em>
            </h1>
            <p className="capa-texto anim-entrada">
              Tradição, precisão e estilo. Onde cada detalhe é tratado com a
              seriedade que você merece.
            </p>
            <div className="capa-acoes anim-entrada">
              <Link href="/agendar" className="btn btn-ouro">
                Agendar Agora — É Grátis
              </Link>
              <a href="#servicos" className="capa-link">
                Nossos Serviços <Seta />
              </a>
            </div>
            <dl className="capa-dados anim-entrada">
              <div>
                <dt>6</dt>
                <dd>cliques até marcar</dd>
              </div>
              <div>
                <dt>2</dt>
                <dd>campos pra preencher</dd>
              </div>
              <div>
                <dt>0</dt>
                <dd>cadastro necessário</dd>
              </div>
            </dl>
          </div>
        </section>

        {/* Serviços */}
        <section className="secao secao-creme" id="servicos">
          <div className="container">
            <div className="secao-cabeca">
              <span className="sobrenome">O que fazemos</span>
              <h2>Nossos serviços</h2>
              <p>
                Escolha o serviço na hora de agendar — o preço, a duração e quem
                atende já vêm junto.
              </p>
            </div>

            {servicos.length === 0 ? (
              <div className="vazio">
                <strong>Nenhum serviço cadastrado ainda</strong>
                Entre no painel administrativo e cadastre os serviços da casa.
                Eles aparecem aqui e no agendamento na mesma hora.
              </div>
            ) : (
              <ServicosSecao servicos={servicos} barbeiros={barbeiros} />
            )}
          </div>
        </section>

        {/* Equipe */}
        <section className="secao secao-marrom" id="equipe">
          <div className="container">
            <div className="secao-cabeca">
              <span className="sobrenome">Quem cuida de você</span>
              <h2>Nossa equipe</h2>
            </div>

            {barbeiros.length === 0 ? (
              <div className="vazio">
                <strong>Equipe em montagem</strong>
                Cadastre os profissionais no painel para que os clientes possam
                escolher com quem querem ser atendidos.
              </div>
            ) : (
              <div className="grade-equipe">
                {barbeiros.map((barbeiro) => (
                  <article className="cartao-barbeiro" key={barbeiro.id}>
                    {barbeiro.foto ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        className="retrato"
                        src={barbeiro.foto}
                        alt={barbeiro.nome}
                      />
                    ) : (
                      <div className="retrato" aria-hidden="true">
                        {iniciais(barbeiro.nome)}
                      </div>
                    )}
                    <h3>{barbeiro.nome}</h3>
                    <p className="funcao">{barbeiro.funcao}</p>
                    <p>{barbeiro.bio}</p>
                    <Link href="/agendar" className="cartao-barbeiro-cta">
                      Agendar com {barbeiro.nome.split(" ")[0]}{" "}
                      <Seta width={13} height={13} />
                    </Link>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Produtos */}
        {produtos.length > 0 ? (
          <section className="secao secao-creme" id="produtos">
            <div className="container">
              <div className="secao-cabeca">
                <span className="sobrenome">O que vendemos</span>
                <h2>Nossos produtos</h2>
                <p>
                  Pomadas, óleos e cuidados que também levam a assinatura da
                  casa.
                </p>
              </div>

              <div className="grade">
                {produtos.map((produto) => (
                  <article className="cartao-servico" key={produto.id}>
                    {produto.imagem ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        className="cartao-servico-imagem"
                        src={produto.imagem}
                        alt=""
                      />
                    ) : null}
                    {produto.marca ? (
                      <span className="sobrenome" style={{ marginBottom: 0 }}>
                        {produto.marca}
                      </span>
                    ) : null}
                    <h3>{produto.nome}</h3>
                    <div className="cartao-rodape">
                      <span className="preco">
                        {moeda(produto.preco_centavos)}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {/* Contato / localização */}
        <section className="secao secao-alta" id="contato">
          <div className="container">
            <div className="secao-cabeca">
              <span className="sobrenome">Fale com a gente</span>
              <h2>Onde estamos</h2>
            </div>

            <div className="contato-grade">
              <div className="contato-bloco">
                {config.endereco ? (
                  <div className="contato-item">
                    <span className="icone">
                      <Local width={17} height={17} />
                    </span>
                    <div>
                      <h4>Endereço</h4>
                      {linkMapa ? (
                        <a
                          href={linkMapa}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {config.endereco}
                        </a>
                      ) : (
                        <p>{config.endereco}</p>
                      )}
                    </div>
                  </div>
                ) : null}
                <div className="contato-item">
                  <span className="icone">
                    <Relogio width={17} height={17} />
                  </span>
                  <div>
                    <h4>Horário de funcionamento</h4>
                    {expediente.map((linha) => (
                      <p key={linha.nome}>
                        {linha.nome}: {linha.horas}
                      </p>
                    ))}
                  </div>
                </div>
                {linkInstagram ? (
                  <div className="contato-item">
                    <span className="icone">
                      <Instagram width={17} height={17} />
                    </span>
                    <div>
                      <h4>Instagram</h4>
                      <a
                        href={linkInstagram}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        @{config.instagram}
                      </a>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="contato-cta">
                <span
                  className="sobrenome"
                  style={{ color: "var(--dourado-claro)" }}
                >
                  Prefere marcar agora?
                </span>
                <h3>Seu horário em menos de um minuto.</h3>
                <p>
                  Escolha o serviço, o profissional e o horário — sem ligar, sem
                  cadastro.
                </p>
                <Link
                  href="/agendar"
                  className="btn btn-ouro"
                  style={{ marginTop: 6 }}
                >
                  Agendar horário <Seta />
                </Link>
                {linkWhats ? (
                  <a
                    href={linkWhats}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-claro"
                  >
                    <WhatsApp width={16} height={16} /> Falar no WhatsApp
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        {/* Chamada final */}
        <section className="chamada">
          <div className="container chamada-interna">
            <div>
              <span className="sobrenome">Reserve seu horário</span>
              <h2>Seu próximo corte está a seis cliques.</h2>
              <p>
                Escolha serviço, profissional, dia e hora. Depois é só o nome e
                o WhatsApp — a confirmação chega por mensagem.
              </p>
            </div>
            <Link href="/agendar" className="btn btn-ouro">
              Agendar agora <Seta />
            </Link>
          </div>
        </section>
      </main>

      <footer className="rodape">
        <div className="container">
          <div className="rodape-grade">
            <div>
              <div className="marca" style={{ marginBottom: 14 }}>
                {config.logo_url ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    className="marca-logo"
                    src={config.logo_url}
                    alt={nome}
                  />
                ) : (
                  <span className="marca-poste" aria-hidden="true" />
                )}
                <span className="marca-nome">{nome}</span>
              </div>
              {config.slogan ? (
                <p style={{ margin: 0, maxWidth: "34ch" }}>{config.slogan}</p>
              ) : null}
            </div>

            <div>
              <h4>Horário de funcionamento</h4>
              <ul>
                {expediente.map((linha) => (
                  <li key={linha.nome}>
                    <Relogio
                      width={13}
                      height={13}
                      style={{ opacity: 0.6, flexShrink: 0 }}
                    />
                    {linha.nome}: {linha.horas}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4>Onde estamos</h4>
              <ul>
                {config.endereco ? (
                  <li>
                    <Local
                      width={13}
                      height={13}
                      style={{ opacity: 0.6, flexShrink: 0 }}
                    />
                    {config.endereco}
                  </li>
                ) : null}
                {config.whatsapp ? (
                  <li>
                    <WhatsApp
                      width={13}
                      height={13}
                      style={{ opacity: 0.6, flexShrink: 0 }}
                    />
                    {config.whatsapp}
                  </li>
                ) : null}
                {linkInstagram ? (
                  <li>
                    <Instagram
                      width={13}
                      height={13}
                      style={{ opacity: 0.6, flexShrink: 0 }}
                    />
                    <a
                      href={linkInstagram}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      @{config.instagram}
                    </a>
                  </li>
                ) : null}
              </ul>
              <Link
                href="/agendar"
                className="btn btn-ouro btn-mini"
                style={{ marginTop: 14 }}
              >
                Agendar horário
              </Link>
            </div>
          </div>

          <div className="rodape-base">
            <span>
              © {new Date().getFullYear()} {nome}
            </span>
            <Link href="/admin">Painel administrativo</Link>
          </div>
        </div>
      </footer>

      <Animacoes />
    </>
  );
}
