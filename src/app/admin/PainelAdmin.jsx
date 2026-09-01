"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ModalConfirmacao } from "@/components/admin/base";
import { CampoEmail, CampoSenha } from "@/components/campos";
import { ConfigProvider } from "@/components/admin/ConfigContext";
import { NOME_PADRAO } from "@/lib/format";
import VisaoGeral from "@/components/admin/VisaoGeral";
import Agendamentos from "@/components/admin/Agendamentos";
import Clientes from "@/components/admin/Clientes";
import Profissionais from "@/components/admin/Profissionais";
import Servicos from "@/components/admin/Servicos";
import Produtos from "@/components/admin/Produtos";
import Horarios from "@/components/admin/Horarios";
import Financeiro from "@/components/admin/Financeiro";
import Configuracoes from "@/components/admin/Configuracoes";
import {
  Caixa,
  Calendario,
  Casa,
  Engrenagem,
  Equipe,
  Grafico,
  Pausa,
  Pessoa,
  Sair,
  Tesoura,
} from "@/components/Icones";

const SECOES = [
  { id: "visao", rotulo: "Visão geral", Icone: Casa, Tela: VisaoGeral },
  { id: "agenda", rotulo: "Agenda", Icone: Calendario, Tela: Agendamentos },
  { id: "clientes", rotulo: "Clientes", Icone: Pessoa, Tela: Clientes },
  {
    id: "profissionais",
    rotulo: "Profissionais",
    Icone: Equipe,
    Tela: Profissionais,
  },
  { id: "servicos", rotulo: "Serviços", Icone: Tesoura, Tela: Servicos },
  { id: "produtos", rotulo: "Produtos", Icone: Caixa, Tela: Produtos },
  { id: "horarios", rotulo: "Horários e folgas", Icone: Pausa, Tela: Horarios },
  { id: "financeiro", rotulo: "Financeiro", Icone: Grafico, Tela: Financeiro },
  {
    id: "config",
    rotulo: "Configurações",
    Icone: Engrenagem,
    Tela: Configuracoes,
  },
];

const SENHA_MINIMA = 6;

/** Link de redefinir senha chega como /admin?token=... — lido uma única vez, no primeiro render. */
function pegarTokenDaUrl() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("token") || "";
}

// Componente de apoio das telas de acesso — definido FORA de PainelAdmin de
// propósito. Um componente declarado dentro de outro muda de identidade a
// cada render do pai, e o React desmonta e remonta a árvore inteira dele
// (mesma causa-raiz do bug corrigido no Modal — ver src/components/admin/base.jsx).
// CampoSenha/CampoEmail vêm de @/components/campos, compartilhados com a
// área da conta do cliente.

/** Painel de marca (lado esquerdo) das telas de acesso — mesmo conteúdo em todas. */
function PainelMarca({ nome }) {
  return (
    <div className="acesso-marca">
      <div className="acesso-marca-brilho" aria-hidden="true" />
      <div className="acesso-marca-conteudo">
        <div className="acesso-marca-logo">
          <span className="acesso-marca-poste" aria-hidden="true" />
          <span className="acesso-marca-nome">{nome || NOME_PADRAO}</span>
        </div>
        <span className="sobrenome" style={{ margin: 0 }}>
          Autenticação segura
        </span>
        <h1>
          Bem-<em>vindo!</em>
        </h1>
        <p className="acesso-marca-texto">
          Agenda, financeiro e equipe reunidos em um único painel — com o mesmo
          cuidado de sempre.
        </p>
      </div>
      <div className="acesso-marca-rodape">
        Acesso restrito à equipe · conexão criptografada
      </div>
    </div>
  );
}

export default function PainelAdmin() {
  // verificando | fora | bootstrap | redefinir | dentro
  const [estado, setEstado] = useState("verificando");
  const [configuracaoInsegura, setConfiguracaoInsegura] = useState(false);
  const [fuso, setFuso] = useState("America/Sao_Paulo");
  const [nome, setNome] = useState("");
  const [barbeiroLogado, setBarbeiroLogado] = useState(null);

  // Login normal (e-mail + senha)
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erroLogin, setErroLogin] = useState("");
  const [entrando, setEntrando] = useState(false);

  // "Esqueceu a senha?"
  const [mostrarEsqueci, setMostrarEsqueci] = useState(false);
  const [emailEsqueci, setEmailEsqueci] = useState("");
  const [enviandoEsqueci, setEnviandoEsqueci] = useState(false);
  const [mensagemEsqueci, setMensagemEsqueci] = useState("");

  // Redefinir senha (chegando pelo link do e-mail)
  const [tokenReset] = useState(pegarTokenDaUrl);
  const [novaSenhaReset, setNovaSenhaReset] = useState("");
  const [confirmacaoReset, setConfirmacaoReset] = useState("");
  const [erroReset, setErroReset] = useState("");
  const [redefinindo, setRedefinindo] = useState(false);
  const [redefinido, setRedefinido] = useState(false);

  // Bootstrap: escolher/cadastrar o primeiro admin
  const [barbeirosBootstrap, setBarbeirosBootstrap] = useState([]);
  const [escolhaBootstrap, setEscolhaBootstrap] = useState("novo");
  const [nomeBootstrap, setNomeBootstrap] = useState("");
  const [emailBootstrap, setEmailBootstrap] = useState("");
  const [senhaBootstrap, setSenhaBootstrap] = useState("");
  const [confirmacaoBootstrap, setConfirmacaoBootstrap] = useState("");
  const [erroBootstrap, setErroBootstrap] = useState("");
  const [enviandoBootstrap, setEnviandoBootstrap] = useState(false);

  const [secaoAtiva, setSecaoAtiva] = useState("visao");
  const [pendentes, setPendentes] = useState(0);
  const [recado, setRecado] = useState(null);
  // Editar o expediente ou as configurações e trocar de seção descartava
  // tudo em silêncio — a tela em uso avisa aqui quando tem algo não salvo,
  // e a troca de seção passa a pedir confirmação antes de perder.
  const [sujo, setSujo] = useState(false);
  const [secaoPretendida, setSecaoPretendida] = useState(null);

  useEffect(() => {
    if (!sujo) return;
    function aoFechar(e) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", aoFechar);
    return () => window.removeEventListener("beforeunload", aoFechar);
  }, [sujo]);

  function pedirTrocaSecao(id) {
    if (sujo) setSecaoPretendida(id);
    else setSecaoAtiva(id);
  }

  function confirmarTrocaSecao() {
    setSujo(false);
    setSecaoAtiva(secaoPretendida);
    setSecaoPretendida(null);
  }

  // /api/public não exige sessão — é a única forma de mostrar o nome da
  // barbearia já na tela de login, antes de qualquer autenticação.
  useEffect(() => {
    fetch("/api/public")
      .then((r) => r.json())
      .then((r) => setNome(r.barbearia?.nome || ""))
      .catch(() => {});
  }, []);

  const carregarBarbeirosBootstrap = useCallback(() => {
    api("barbeiros")
      .then((r) => setBarbeirosBootstrap(r.itens || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    // Um link de redefinir senha vale para qualquer estado de sessão — nem
    // precisa estar deslogado (ex.: pediu de outro navegador).
    if (tokenReset) {
      setEstado("redefinir");
      return;
    }

    fetch("/api/admin/sessao")
      .then((r) => r.json())
      .then(async (r) => {
        setConfiguracaoInsegura(!!r.configuracaoInsegura);
        if (r.configuracaoInsegura || !r.autenticado) {
          setEstado("fora");
          return;
        }
        if (r.modoBootstrap) {
          carregarBarbeirosBootstrap();
          setEstado("bootstrap");
          return;
        }
        setBarbeiroLogado(r.barbeiro);
        try {
          const cfg = await api("config");
          setFuso(cfg.fuso || "America/Sao_Paulo");
        } catch {
          // Sem acesso ao fuso real, segue com o default — melhor que travar a entrada.
        }
        setEstado("dentro");
      })
      .catch(() => setEstado("fora"));
  }, [tokenReset, carregarBarbeirosBootstrap]);

  const avisar = useCallback((texto, tipo = "ok") => {
    setRecado({ texto, tipo });
    setTimeout(() => setRecado(null), 3500);
  }, []);

  /** Um erro 401 significa sessão vencida: devolve para a tela de entrada. */
  const tratarErro = useCallback(
    (erro) => {
      if (erro?.status === 401) {
        setEstado("fora");
        avisar("Sua sessão expirou. Entre novamente.", "erro");
      } else {
        avisar(erro?.message || "Algo deu errado.", "erro");
      }
    },
    [avisar],
  );

  const atualizarPendentes = useCallback(() => {
    api("pendentes")
      .then((r) => setPendentes(r.total || 0))
      .catch(tratarErro);
  }, [tratarErro]);

  useEffect(() => {
    if (estado === "dentro") atualizarPendentes();
  }, [estado, secaoAtiva, atualizarPendentes]);

  async function entrar(evento) {
    evento.preventDefault();
    setErroLogin("");
    setEntrando(true);
    try {
      await api("login", { method: "POST", body: { email, senha } });
      setSenha("");
      const r = await fetch("/api/admin/sessao").then((x) => x.json());
      if (r.modoBootstrap) {
        carregarBarbeirosBootstrap();
        setEstado("bootstrap");
      } else {
        setBarbeiroLogado(r.barbeiro);
        setEstado("dentro");
      }
    } catch (erro) {
      setErroLogin(erro.message);
    } finally {
      setEntrando(false);
    }
  }

  async function pedirRecuperacao(evento) {
    evento.preventDefault();
    setEnviandoEsqueci(true);
    try {
      const r = await api("esqueci-senha", {
        method: "POST",
        body: { email: emailEsqueci },
      });
      setMensagemEsqueci(r.mensagem);
    } catch (erro) {
      // Mesmo um erro real (rate limit, JSON inválido) mostra uma mensagem —
      // nunca deixa a tela em branco sem explicação nenhuma.
      setMensagemEsqueci(erro.message);
    } finally {
      setEnviandoEsqueci(false);
    }
  }

  async function confirmarRedefinicao(evento) {
    evento.preventDefault();
    setErroReset("");
    if (novaSenhaReset.length < SENHA_MINIMA) {
      return setErroReset(
        `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`,
      );
    }
    if (novaSenhaReset !== confirmacaoReset) {
      return setErroReset("A confirmação não bate com a senha nova.");
    }
    setRedefinindo(true);
    try {
      await api("redefinir-senha", {
        method: "POST",
        body: {
          token: tokenReset,
          novaSenha: novaSenhaReset,
          confirmacao: confirmacaoReset,
        },
      });
      setRedefinido(true);
    } catch (erro) {
      setErroReset(erro.message);
    } finally {
      setRedefinindo(false);
    }
  }

  async function concluirBootstrap(evento) {
    evento.preventDefault();
    setErroBootstrap("");
    if (senhaBootstrap.length < SENHA_MINIMA) {
      return setErroBootstrap(
        `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`,
      );
    }
    if (senhaBootstrap !== confirmacaoBootstrap) {
      return setErroBootstrap("A confirmação não bate com a senha.");
    }

    setEnviandoBootstrap(true);
    try {
      const corpo = {
        email: emailBootstrap,
        senha: senhaBootstrap,
        confirmacao: confirmacaoBootstrap,
      };
      if (escolhaBootstrap === "novo") corpo.nome = nomeBootstrap;
      else corpo.barbeiroId = Number(escolhaBootstrap);

      await api("bootstrap", { method: "POST", body: corpo });
      const r = await fetch("/api/admin/sessao").then((x) => x.json());
      setBarbeiroLogado(r.barbeiro);
      setEstado("dentro");
    } catch (erro) {
      setErroBootstrap(erro.message);
    } finally {
      setEnviandoBootstrap(false);
    }
  }

  async function sair() {
    await api("logout", { method: "POST" }).catch(() => {});
    setSujo(false);
    setBarbeiroLogado(null);
    setEstado("fora");
  }

  if (estado === "verificando") {
    return (
      <div className="portao">
        <p style={{ color: "var(--creme)" }}>Carregando…</p>
      </div>
    );
  }

  if (configuracaoInsegura) {
    return (
      <div className="acesso">
        <PainelMarca nome={nome} />
        <div className="acesso-conteudo">
          <div className="acesso-coluna">
            <div className="acesso-cartao">
              <div className="acesso-cartao-topo">
                <span className="sobrenome">Painel administrativo</span>
                <h1>{nome || NOME_PADRAO}</h1>
              </div>
              <div className="aviso aviso-erro">
                O painel está indisponível: falta configurar o servidor com
                segurança (<code>SESSION_SECRET</code>/
                <code>ADMIN_PASSWORD</code>). Avise quem cuida da hospedagem — o
                site público continua funcionando normalmente.
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (estado === "redefinir") {
    return (
      <div className="acesso">
        <PainelMarca nome={nome} />
        <div className="acesso-conteudo">
          <div className="acesso-coluna">
            <div className="acesso-cartao">
              <div className="acesso-cartao-topo">
                <span className="sobrenome">Redefinir senha</span>
                <h1>{nome || NOME_PADRAO}</h1>
              </div>
              {redefinido ? (
                <>
                  <div className="aviso">
                    Senha definida! Já pode entrar com ela.
                  </div>
                  <a className="btn btn-verde btn-bloco" href="/admin">
                    Ir para o login
                  </a>
                </>
              ) : (
                <form onSubmit={confirmarRedefinicao}>
                  <p
                    style={{
                      marginTop: 0,
                      color: "var(--tinta-suave)",
                      fontSize: 14,
                    }}
                  >
                    Escolha uma senha nova para sua conta.
                  </p>
                  {erroReset ? (
                    <div className="aviso aviso-erro">{erroReset}</div>
                  ) : null}
                  <CampoSenha
                    label="Senha nova"
                    valor={novaSenhaReset}
                    aoMudar={setNovaSenhaReset}
                    autoFocus
                    autoComplete="new-password"
                  />
                  <CampoSenha
                    label="Repita a senha nova"
                    valor={confirmacaoReset}
                    aoMudar={setConfirmacaoReset}
                    autoComplete="new-password"
                  />
                  <button
                    className="btn btn-verde btn-bloco"
                    disabled={redefinindo}
                  >
                    {redefinindo ? "Salvando…" : "Definir senha"}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (estado === "fora") {
    return (
      <div className="acesso">
        <PainelMarca nome={nome} />
        <div className="acesso-conteudo">
          <div className="acesso-coluna">
            <div className="acesso-cartao">
              <div className="acesso-cartao-topo">
                <span className="sobrenome">Painel administrativo</span>
                <h1>{nome || NOME_PADRAO}</h1>
              </div>

              {mostrarEsqueci ? (
                mensagemEsqueci ? (
                  <>
                    <div className="aviso">{mensagemEsqueci}</div>
                    <button
                      type="button"
                      className="btn btn-contorno btn-bloco"
                      onClick={() => {
                        setMostrarEsqueci(false);
                        setMensagemEsqueci("");
                        setEmailEsqueci("");
                      }}
                    >
                      Voltar para o login
                    </button>
                  </>
                ) : (
                  <form onSubmit={pedirRecuperacao}>
                    <p
                      style={{
                        marginTop: 0,
                        color: "var(--tinta-suave)",
                        fontSize: 14,
                      }}
                    >
                      Informe o e-mail cadastrado. Se ele existir, enviamos um
                      link para redefinir a senha.
                    </p>
                    <CampoEmail
                      label="E-mail"
                      valor={emailEsqueci}
                      aoMudar={setEmailEsqueci}
                      autoFocus
                      autoComplete="email"
                    />
                    <button
                      className="btn btn-verde btn-bloco"
                      disabled={enviandoEsqueci}
                    >
                      {enviandoEsqueci ? "Enviando…" : "Enviar link"}
                    </button>
                    <button
                      type="button"
                      className="link-simples"
                      style={{ marginTop: 14, display: "block" }}
                      onClick={() => setMostrarEsqueci(false)}
                    >
                      Voltar
                    </button>
                  </form>
                )
              ) : (
                <form onSubmit={entrar}>
                  {erroLogin ? (
                    <div className="aviso aviso-erro">{erroLogin}</div>
                  ) : null}
                  <CampoEmail
                    label="E-mail"
                    valor={email}
                    aoMudar={setEmail}
                    autoFocus
                    autoComplete="username"
                  />
                  <CampoSenha
                    label="Senha"
                    valor={senha}
                    aoMudar={setSenha}
                    autoComplete="current-password"
                  />
                  <button
                    className="btn btn-verde btn-bloco"
                    disabled={entrando}
                  >
                    {entrando ? "Entrando…" : "Entrar"}
                  </button>
                  <button
                    type="button"
                    className="link-simples"
                    style={{ marginTop: 14, display: "block" }}
                    onClick={() => setMostrarEsqueci(true)}
                  >
                    Esqueceu a senha?
                  </button>
                </form>
              )}
            </div>
            <p className="acesso-ajuda">
              Problemas para entrar? Fale com quem administra o servidor.
            </p>
          </div>
        </div>
        {recado ? (
          <div className={`recado ${recado.tipo === "erro" ? "erro" : ""}`}>
            {recado.texto}
          </div>
        ) : null}
      </div>
    );
  }

  if (estado === "bootstrap") {
    return (
      <div className="acesso">
        <PainelMarca nome={nome} />
        <div className="acesso-conteudo">
          <div className="acesso-coluna" style={{ maxWidth: 420 }}>
            <div className="acesso-cartao">
              <div className="acesso-cartao-topo">
                <span className="sobrenome">Configuração inicial</span>
                <h1>{nome || NOME_PADRAO}</h1>
              </div>
              <form onSubmit={concluirBootstrap}>
                <p
                  style={{
                    marginTop: 0,
                    color: "var(--tinta-suave)",
                    fontSize: 14,
                  }}
                >
                  Escolha quem vai ser o primeiro administrador do painel.
                  Depois disso, a senha compartilhada deixa de funcionar — cada
                  pessoa passa a entrar com o próprio e-mail e senha.
                </p>
                {erroBootstrap ? (
                  <div className="aviso aviso-erro">{erroBootstrap}</div>
                ) : null}

                {barbeirosBootstrap.length > 0 ? (
                  <label className="campo">
                    <span>Quem é você?</span>
                    <select
                      className="entrada"
                      value={escolhaBootstrap}
                      onChange={(e) => setEscolhaBootstrap(e.target.value)}
                    >
                      <option value="novo">
                        Cadastrar um novo profissional
                      </option>
                      {barbeirosBootstrap.map((b) => (
                        <option key={b.id} value={String(b.id)}>
                          {b.nome}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {escolhaBootstrap === "novo" ? (
                  <label className="campo">
                    <span>Nome</span>
                    <input
                      className="entrada"
                      value={nomeBootstrap}
                      onChange={(e) => setNomeBootstrap(e.target.value)}
                      autoFocus
                    />
                  </label>
                ) : null}

                <CampoEmail
                  label="Seu e-mail"
                  valor={emailBootstrap}
                  aoMudar={setEmailBootstrap}
                  autoComplete="username"
                />
                <CampoSenha
                  label="Escolha uma senha"
                  valor={senhaBootstrap}
                  aoMudar={setSenhaBootstrap}
                  autoComplete="new-password"
                />
                <CampoSenha
                  label="Repita a senha"
                  valor={confirmacaoBootstrap}
                  aoMudar={setConfirmacaoBootstrap}
                  autoComplete="new-password"
                />
                <button
                  className="btn btn-verde btn-bloco"
                  disabled={enviandoBootstrap}
                >
                  {enviandoBootstrap ? "Salvando…" : "Concluir configuração"}
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const secao = SECOES.find((s) => s.id === secaoAtiva) || SECOES[0];
  const Tela = secao.Tela;

  return (
    <div className="admin">
      <nav className="lateral">
        <div className="lateral-topo">
          <span className="sobrenome">Painel</span>
          <strong>{nome || NOME_PADRAO}</strong>
        </div>

        <div className="lateral-menu">
          {SECOES.map(({ id, rotulo, Icone }) => (
            <button
              key={id}
              className={`item-menu ${id === secaoAtiva ? "ativo" : ""}`}
              onClick={() => pedirTrocaSecao(id)}
            >
              <Icone width={17} height={17} />
              {rotulo}
              {id === "agenda" && pendentes > 0 ? (
                <span className="contador">{pendentes}</span>
              ) : null}
            </button>
          ))}
        </div>

        <div className="lateral-base">
          {barbeiroLogado ? (
            <div
              style={{
                padding: "0 14px 10px",
                fontSize: 12.5,
                color: "rgba(247,243,234,0.6)",
              }}
            >
              Logado como{" "}
              <strong style={{ color: "var(--creme-alto)" }}>
                {barbeiroLogado.nome}
              </strong>
            </div>
          ) : null}
          <button className="item-menu" onClick={sair}>
            <Sair width={17} height={17} />
            Sair
          </button>
        </div>
      </nav>

      <main className="conteudo">
        <ConfigProvider nome={nome} fuso={fuso}>
          <Tela
            avisar={avisar}
            tratarErro={tratarErro}
            aoMudar={atualizarPendentes}
            aoAlterar={setSujo}
          />
        </ConfigProvider>
      </main>

      {secaoPretendida ? (
        <ModalConfirmacao
          titulo="Alterações não salvas"
          mensagem="Você tem alterações não salvas nesta tela. Sair mesmo assim? Elas serão perdidas."
          confirmarLabel="Sair sem salvar"
          perigo
          aoConfirmar={confirmarTrocaSecao}
          aoFechar={() => setSecaoPretendida(null)}
        />
      ) : null}

      {recado ? (
        <div className={`recado ${recado.tipo === "erro" ? "erro" : ""}`}>
          {recado.texto}
        </div>
      ) : null}
    </div>
  );
}
