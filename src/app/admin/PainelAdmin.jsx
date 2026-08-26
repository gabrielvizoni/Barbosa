"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/components/admin/base";
import { ConfigProvider } from "@/components/admin/ConfigContext";
import { NOME_PADRAO } from "@/lib/format";
import VisaoGeral from "@/components/admin/VisaoGeral";
import Agendamentos from "@/components/admin/Agendamentos";
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
  Cadeado,
  Dinheiro,
  Engrenagem,
  Equipe,
  Grafico,
  Pausa,
  Sair,
  Tesoura,
} from "@/components/Icones";

const SECOES = [
  { id: "visao", rotulo: "Visão geral", Icone: Casa, Tela: VisaoGeral },
  { id: "agenda", rotulo: "Agenda", Icone: Calendario, Tela: Agendamentos },
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

export default function PainelAdmin() {
  const [estado, setEstado] = useState("verificando"); // verificando | fora | dentro
  const [senha, setSenha] = useState("");
  const [erroLogin, setErroLogin] = useState("");
  const [entrando, setEntrando] = useState(false);
  const [configuracaoInsegura, setConfiguracaoInsegura] = useState(false);
  const [senhaInicial, setSenhaInicial] = useState(false);
  const [fuso, setFuso] = useState("America/Sao_Paulo");
  const [nome, setNome] = useState("");

  const [secaoAtiva, setSecaoAtiva] = useState("visao");
  const [pendentes, setPendentes] = useState(0);
  const [recado, setRecado] = useState(null);

  // /api/public não exige sessão — é a única forma de mostrar o nome da
  // barbearia já na tela de login, antes de qualquer autenticação.
  useEffect(() => {
    fetch("/api/public")
      .then((r) => r.json())
      .then((r) => setNome(r.barbearia?.nome || ""))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/admin/sessao")
      .then((r) => r.json())
      .then(async (r) => {
        setConfiguracaoInsegura(!!r.configuracaoInsegura);
        setSenhaInicial(!!r.senhaInicial);
        // Busca o fuso ANTES de liberar a tela: assim nenhuma tela monta com
        // o default e recalcula "hoje" depois, quando o valor de verdade chega.
        if (r.autenticado) {
          try {
            const cfg = await api("config");
            setFuso(cfg.fuso || "America/Sao_Paulo");
          } catch {
            // Sem acesso ao fuso real, segue com o default — melhor que travar a entrada.
          }
        }
        setEstado(r.autenticado ? "dentro" : "fora");
      })
      .catch(() => setEstado("fora"));
  }, []);

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
      const r = await api("login", { method: "POST", body: { senha } });
      setSenha("");
      setSenhaInicial(!!r.senhaInicial);
      setEstado("dentro");
    } catch (erro) {
      setErroLogin(erro.message);
    } finally {
      setEntrando(false);
    }
  }

  async function sair() {
    await api("logout", { method: "POST" }).catch(() => {});
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
      <div className="portao">
        <div className="portao-caixa">
          <div className="portao-topo">
            <span className="sobrenome">Painel administrativo</span>
            <h1>{nome || NOME_PADRAO}</h1>
          </div>
          <div className="portao-corpo">
            <div className="aviso aviso-erro">
              O painel está indisponível: falta configurar a variável{" "}
              <code>SESSION_SECRET</code> no servidor. Avise quem cuida da
              hospedagem — o site público continua funcionando normalmente.
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (estado === "fora") {
    return (
      <div className="portao">
        <div className="portao-caixa">
          <div className="portao-topo">
            <span className="sobrenome">Painel administrativo</span>
            <h1>{nome || NOME_PADRAO}</h1>
          </div>
          <form className="portao-corpo" onSubmit={entrar}>
            {erroLogin ? (
              <div className="aviso aviso-erro">{erroLogin}</div>
            ) : null}
            <label className="campo">
              <span>Senha</span>
              <input
                className="entrada"
                type="password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                autoFocus
                autoComplete="current-password"
              />
            </label>
            <button className="btn btn-verde btn-bloco" disabled={entrando}>
              {entrando ? "Entrando…" : "Entrar"}
            </button>
          </form>
        </div>
        {recado ? (
          <div className={`recado ${recado.tipo === "erro" ? "erro" : ""}`}>
            {recado.texto}
          </div>
        ) : null}
      </div>
    );
  }

  // Enquanto a senha ainda for a inicial, só Configurações fica acessível —
  // é lá que está o formulário de troca de senha.
  const secaoEfetiva = senhaInicial ? "config" : secaoAtiva;
  const secao = SECOES.find((s) => s.id === secaoEfetiva) || SECOES[0];
  const Tela = secao.Tela;

  return (
    <div className="admin">
      <nav className="lateral">
        <div className="lateral-topo">
          <span className="sobrenome">Painel</span>
          <strong>{nome || NOME_PADRAO}</strong>
        </div>

        {senhaInicial ? (
          <div className="aviso-lateral" style={{ margin: "0 16px 12px" }}>
            <Cadeado
              width={14}
              height={14}
              style={{ flexShrink: 0, marginTop: 1 }}
            />
            Defina uma senha própria para liberar o resto do painel.
          </div>
        ) : null}

        <div className="lateral-menu">
          {SECOES.map(({ id, rotulo, Icone }) => {
            const bloqueado = senhaInicial && id !== "config";
            return (
              <button
                key={id}
                className={`item-menu ${id === secaoEfetiva ? "ativo" : ""}`}
                onClick={() => (bloqueado ? null : setSecaoAtiva(id))}
                disabled={bloqueado}
                title={
                  bloqueado ? "Defina uma senha própria primeiro" : undefined
                }
                aria-disabled={bloqueado}
              >
                <Icone width={17} height={17} />
                {rotulo}
                {id === "agenda" && pendentes > 0 ? (
                  <span className="contador">{pendentes}</span>
                ) : null}
                {bloqueado ? (
                  <Cadeado
                    width={13}
                    height={13}
                    style={{ marginLeft: "auto", opacity: 0.6 }}
                  />
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="lateral-base">
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
            aoTrocarSenha={() => setSenhaInicial(false)}
          />
        </ConfigProvider>
      </main>

      {recado ? (
        <div className={`recado ${recado.tipo === "erro" ? "erro" : ""}`}>
          {recado.texto}
        </div>
      ) : null}
    </div>
  );
}
