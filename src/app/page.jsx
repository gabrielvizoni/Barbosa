import Link from 'next/link';
import { lerConfig, lerExpediente, listarBarbeiros, listarServicos } from '@/lib/db';
import { moeda, iniciais } from '@/lib/format';
import { Local, Relogio, Seta, Zap } from '@/components/Icones';

export const dynamic = 'force-dynamic';

const NOMES_DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

/** Agrupa dias seguidos com o mesmo horário: "Segunda a sexta: 9h às 20h". */
function resumirExpediente(expediente) {
  const linhas = [];
  let grupo = null;
  for (const dia of [...expediente].sort((a, b) => a.dia - b.dia)) {
    const chave = dia.aberto ? `${dia.abre}-${dia.fecha}` : 'fechado';
    if (grupo && grupo.chave === chave) {
      grupo.fim = dia.dia;
    } else {
      if (grupo) linhas.push(grupo);
      grupo = { chave, inicio: dia.dia, fim: dia.dia, aberto: dia.aberto, dados: dia };
    }
  }
  if (grupo) linhas.push(grupo);

  return linhas.map((g) => {
    const nome =
      g.inicio === g.fim
        ? NOMES_DIAS[g.inicio]
        : `${NOMES_DIAS[g.inicio]} a ${NOMES_DIAS[g.fim].toLowerCase()}`;
    const horas = g.aberto ? `${g.dados.abre} às ${g.dados.fecha}` : 'Fechado';
    return { nome, horas };
  });
}

export default function PaginaInicial() {
  const config = lerConfig();
  const servicos = listarServicos({ somenteAtivos: true });
  const barbeiros = listarBarbeiros({ somenteAtivos: true });
  const expediente = resumirExpediente(lerExpediente());
  const nome = config.nome_barbearia || 'The Barbosa Barbearia';

  return (
    <>
      <header className="cabecalho">
        <div className="container cabecalho-interno">
          <Link href="/" className="marca">
            <span className="marca-poste" aria-hidden="true" />
            <span className="marca-nome">The Barbosa</span>
          </Link>
          <nav className="menu">
            <span className="menu-secundario">
              <a href="#servicos">Serviços</a>
            </span>
            <span className="menu-secundario">
              <a href="#equipe">Equipe</a>
            </span>
            <Link href="/agendar" className="btn btn-ouro btn-mini">
              Agendar
            </Link>
          </nav>
        </div>
      </header>

      <main>
        {/* Capa */}
        <section className="capa">
          <div className="container capa-interna">
            <div>
              <span className="sobrenome">Barbearia clássica · Maringá, PR</span>
              <h1>
                Cadeira
                <br />
                <em>reservada.</em>
              </h1>
              <p className="capa-texto">{config.slogan}</p>
              <div className="capa-acoes">
                <Link href="/agendar" className="btn btn-ouro">
                  Agendar horário <Seta />
                </Link>
                <a href="#servicos" className="btn btn-claro">
                  Ver serviços
                </a>
              </div>
              <dl className="capa-dados">
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

            <div className="cartaz">
              <span className="cartaz-linha">Desde 2021</span>
              <span className="cartaz-poste" aria-hidden="true" />
              <span className="cartaz-titulo">The Barbosa</span>
              <span className="cartaz-linha">Corte · Barba · Navalha</span>
            </div>
          </div>
        </section>

        <div className="poste" aria-hidden="true" />

        {/* Serviços */}
        <section className="secao secao-creme" id="servicos">
          <div className="container">
            <div className="secao-cabeca">
              <span className="sobrenome">O que fazemos</span>
              <h2>Nossos serviços</h2>
              <p>Escolha o serviço na hora de agendar — o preço e a duração já vêm junto.</p>
            </div>

            {servicos.length === 0 ? (
              <div className="vazio">
                <strong>Nenhum serviço cadastrado ainda</strong>
                Entre no painel administrativo e cadastre os serviços da casa. Eles aparecem
                aqui e no agendamento na mesma hora.
              </div>
            ) : (
              <div className="grade">
                {servicos.map((servico) => (
                  <article className="cartao-servico" key={servico.id}>
                    <span className="sobrenome" style={{ marginBottom: 0 }}>
                      {servico.categoria}
                    </span>
                    <h3>{servico.nome}</h3>
                    <p>{servico.descricao}</p>
                    <div className="cartao-rodape">
                      <span className="preco">{moeda(servico.preco_centavos)}</span>
                      <span className="duracao">{servico.duracao_min} min</span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Equipe */}
        <section className="secao secao-verde" id="equipe">
          <div className="container">
            <div className="secao-cabeca">
              <span className="sobrenome">Quem cuida de você</span>
              <h2>Nossa equipe</h2>
            </div>

            {barbeiros.length === 0 ? (
              <div className="vazio">
                <strong>Equipe em montagem</strong>
                Cadastre os profissionais no painel para que os clientes possam escolher com
                quem querem ser atendidos.
              </div>
            ) : (
              <div className="grade-equipe">
                {barbeiros.map((barbeiro) => (
                  <article className="cartao-barbeiro" key={barbeiro.id}>
                    {barbeiro.foto ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img className="retrato" src={barbeiro.foto} alt={barbeiro.nome} />
                    ) : (
                      <div className="retrato" aria-hidden="true">
                        {iniciais(barbeiro.nome)}
                      </div>
                    )}
                    <h3>{barbeiro.nome}</h3>
                    <p className="funcao">{barbeiro.funcao}</p>
                    <p>{barbeiro.bio}</p>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Chamada final */}
        <section className="chamada">
          <div className="container chamada-interna">
            <div>
              <span className="sobrenome">Reserve seu horário</span>
              <h2>Seu próximo corte está a seis cliques.</h2>
              <p>
                Escolha serviço, profissional, dia e hora. Depois é só o nome e o WhatsApp —
                a confirmação chega por mensagem.
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
                <span className="marca-poste" aria-hidden="true" />
                <span className="marca-nome">The Barbosa</span>
              </div>
              <p style={{ margin: 0, maxWidth: '34ch' }}>{config.slogan}</p>
            </div>

            <div>
              <h4>Horário de funcionamento</h4>
              <ul>
                {expediente.map((linha) => (
                  <li key={linha.nome}>
                    <Relogio width={13} height={13} style={{ verticalAlign: -2, opacity: 0.6 }} />{' '}
                    {linha.nome}: {linha.horas}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4>Onde estamos</h4>
              <ul>
                <li>
                  <Local width={13} height={13} style={{ verticalAlign: -2, opacity: 0.6 }} />{' '}
                  {config.endereco}
                </li>
                {config.whatsapp ? (
                  <li>
                    <Zap width={13} height={13} style={{ verticalAlign: -2, opacity: 0.6 }} />{' '}
                    {config.whatsapp}
                  </li>
                ) : null}
              </ul>
              <Link href="/agendar" className="btn btn-ouro btn-mini" style={{ marginTop: 14 }}>
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
    </>
  );
}
