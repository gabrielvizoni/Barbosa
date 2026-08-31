"use client";

import { useEffect, useState } from "react";
import { api, CampoImagem } from "./base";
import { mascararTelefone, somenteDigitos } from "@/lib/format";

const SENHAS_VAZIAS = { atual: "", nova: "", confirmacao: "" };
const SENHA_MINIMA = 6;

export default function Configuracoes({ avisar, tratarErro, aoAlterar }) {
  const [aba, setAba] = useState("dados");
  const [config, setConfig] = useState(null);
  const [configOriginal, setConfigOriginal] = useState(null);
  const [salvando, setSalvando] = useState(false);

  const [perfil, setPerfil] = useState(null);
  const [emailForm, setEmailForm] = useState({ email: "", senhaAtual: "" });
  const [erroEmail, setErroEmail] = useState("");
  const [trocandoEmail, setTrocandoEmail] = useState(false);

  const [senhas, setSenhas] = useState(SENHAS_VAZIAS);
  const [erroSenha, setErroSenha] = useState("");
  const [trocando, setTrocando] = useState(false);

  useEffect(() => {
    api("config")
      .then((r) => {
        setConfig(r.config);
        setConfigOriginal(r.config);
      })
      .catch(tratarErro);
    api("perfil")
      .then((r) => {
        setPerfil(r);
        setEmailForm({ email: r.email, senhaAtual: "" });
      })
      .catch(() => {});
  }, [tratarErro]);

  // "Salvar configurações" e "Minha conta" são ações independentes — o
  // usuário preenchia a senha nova, clicava em "Salvar configurações", via
  // "Configurações salvas" e achava que tinha trocado a senha (não tinha).
  // Separadas em abas, cada botão só existe dentro da ação que ele executa.
  // Também avisa o painel quando há campo editado e não salvo, em qualquer
  // uma das abas, para não descartar em silêncio ao trocar de seção.
  const configSujo =
    !!configOriginal &&
    JSON.stringify(config) !== JSON.stringify(configOriginal);
  const emailSujo = !!perfil && emailForm.email !== perfil.email;
  const senhaSuja = !!(senhas.atual || senhas.nova || senhas.confirmacao);
  useEffect(() => {
    aoAlterar?.(configSujo || emailSujo || senhaSuja);
  }, [configSujo, emailSujo, senhaSuja, aoAlterar]);

  async function trocarEmail() {
    setErroEmail("");
    if (!emailForm.email.trim()) return setErroEmail("Informe o e-mail.");
    if (!emailForm.senhaAtual) {
      return setErroEmail("Informe sua senha atual para confirmar.");
    }

    setTrocandoEmail(true);
    try {
      await api("perfil", {
        method: "PATCH",
        body: { email: emailForm.email, senhaAtual: emailForm.senhaAtual },
      });
      setPerfil((p) => ({ ...p, email: emailForm.email }));
      setEmailForm((f) => ({ ...f, senhaAtual: "" }));
      avisar("E-mail atualizado.");
    } catch (erro) {
      if (erro.status === 401) return tratarErro(erro);
      setErroEmail(erro.message);
    } finally {
      setTrocandoEmail(false);
    }
  }

  async function trocarSenha() {
    setErroSenha("");
    if (!senhas.atual || !senhas.nova) {
      return setErroSenha("Preencha a senha atual e a nova.");
    }
    if (senhas.nova.length < SENHA_MINIMA) {
      return setErroSenha(
        `A senha nova precisa ter pelo menos ${SENHA_MINIMA} caracteres.`,
      );
    }
    if (senhas.nova !== senhas.confirmacao) {
      return setErroSenha("A confirmação não bate com a senha nova.");
    }
    if (senhas.nova === senhas.atual) {
      return setErroSenha("A senha nova é igual à atual.");
    }

    setTrocando(true);
    try {
      await api("perfil/senha", {
        method: "POST",
        body: {
          senhaAtual: senhas.atual,
          novaSenha: senhas.nova,
          confirmacao: senhas.confirmacao,
        },
      });
      setSenhas(SENHAS_VAZIAS);
      avisar("Senha trocada. Use a nova no próximo acesso.");
    } catch (erro) {
      if (erro.status === 401) return tratarErro(erro);
      setErroSenha(erro.message);
    } finally {
      setTrocando(false);
    }
  }

  if (!config) return <p>Carregando…</p>;

  function mudar(chave, valor) {
    setConfig({ ...config, [chave]: valor });
  }

  async function salvar() {
    setSalvando(true);
    try {
      const r = await api("config", {
        method: "PUT",
        body: {
          config: { ...config, whatsapp: somenteDigitos(config.whatsapp) },
        },
      });
      setConfig(r.config);
      setConfigOriginal(r.config);
      avisar("Configurações salvas.");
    } catch (erro) {
      tratarErro(erro);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <div className="conteudo-topo">
        <div>
          <h1>Configurações</h1>
          <p>Dados da barbearia e as regras que o agendamento segue.</p>
        </div>
      </div>

      <div
        className="agenda-filtros"
        role="tablist"
        style={{ marginBottom: 20 }}
      >
        <button
          type="button"
          role="tab"
          id="aba-dados"
          aria-selected={aba === "dados"}
          aria-controls="painel-dados"
          className={`pilula ${aba === "dados" ? "ativa" : ""}`}
          onClick={() => setAba("dados")}
        >
          Configurações{configSujo ? " •" : ""}
        </button>
        <button
          type="button"
          role="tab"
          id="aba-senha"
          aria-selected={aba === "senha"}
          aria-controls="painel-senha"
          className={`pilula ${aba === "senha" ? "ativa" : ""}`}
          onClick={() => setAba("senha")}
        >
          Minha conta{emailSujo || senhaSuja ? " •" : ""}
        </button>
      </div>

      <div
        role="tabpanel"
        id="painel-dados"
        aria-labelledby="aba-dados"
        hidden={aba !== "dados"}
      >
        <section className="bloco">
          <h2>Identificação</h2>

          <CampoImagem
            label="Logo da barbearia (opcional)"
            valor={config.logo_url}
            aoMudar={(url) => mudar("logo_url", url)}
            pasta="logo"
            avisar={avisar}
          />

          <label className="campo">
            <span>Nome da barbearia</span>
            <input
              className="entrada"
              value={config.nome_barbearia}
              onChange={(e) => mudar("nome_barbearia", e.target.value)}
            />
          </label>

          <label className="campo">
            <span>Frase de apresentação</span>
            <textarea
              className="entrada"
              value={config.slogan}
              onChange={(e) => mudar("slogan", e.target.value)}
            />
          </label>

          <div className="linha-campos">
            <label className="campo">
              <span>WhatsApp da barbearia</span>
              <input
                className="entrada mono"
                value={mascararTelefone(config.whatsapp)}
                onChange={(e) => mudar("whatsapp", e.target.value)}
                placeholder="(44) 99999-0000"
              />
            </label>
            <label className="campo">
              <span>Endereço</span>
              <input
                className="entrada"
                value={config.endereco}
                onChange={(e) => mudar("endereco", e.target.value)}
              />
            </label>
          </div>

          <label className="campo">
            <span>Instagram (usuário, sem @)</span>
            <input
              className="entrada"
              value={config.instagram}
              onChange={(e) =>
                mudar("instagram", e.target.value.replace(/^@/, ""))
              }
              placeholder="seuusuario"
            />
          </label>

          <div className="aviso">
            Sem esse número, o botão de confirmação no WhatsApp não aparece para
            o cliente no fim do agendamento.
          </div>
        </section>

        <section className="bloco">
          <h2>Regras do agendamento</h2>

          <div className="linha-campos">
            <label className="campo">
              <span>De quanto em quanto tempo</span>
              <select
                className="entrada"
                value={config.intervalo_min}
                onChange={(e) => mudar("intervalo_min", e.target.value)}
              >
                <option value="15">15 minutos</option>
                <option value="20">20 minutos</option>
                <option value="30">30 minutos</option>
                <option value="60">1 hora</option>
              </select>
            </label>

            <label className="campo">
              <span>Antecedência mínima</span>
              <select
                className="entrada"
                value={config.antecedencia_min}
                onChange={(e) => mudar("antecedencia_min", e.target.value)}
              >
                <option value="0">Sem antecedência</option>
                <option value="30">30 minutos</option>
                <option value="60">1 hora</option>
                <option value="120">2 horas</option>
                <option value="1440">1 dia</option>
              </select>
            </label>

            <label className="campo">
              <span>Quantos dias à frente</span>
              <select
                className="entrada"
                value={config.dias_futuros}
                onChange={(e) => mudar("dias_futuros", e.target.value)}
              >
                <option value="7">7 dias</option>
                <option value="15">15 dias</option>
                <option value="30">30 dias</option>
                <option value="60">60 dias</option>
                <option value="90">90 dias (3 meses)</option>
              </select>
            </label>
          </div>

          <label className="caixa">
            <input
              type="checkbox"
              checked={config.confirmacao_automatica === "1"}
              onChange={(e) =>
                mudar("confirmacao_automatica", e.target.checked ? "1" : "0")
              }
            />
            Marcar como confirmado assim que o cliente agenda
          </label>

          <p
            style={{
              fontSize: 13.5,
              color: "var(--tinta-suave)",
              marginTop: 10,
            }}
          >
            Desmarcado, todo agendamento entra como pendente e espera você
            confirmar na tela de Agendamentos.
          </p>
        </section>

        <button className="btn btn-ouro" onClick={salvar} disabled={salvando}>
          {salvando ? "Salvando…" : "Salvar configurações"}
        </button>
      </div>

      <div
        role="tabpanel"
        id="painel-senha"
        aria-labelledby="aba-senha"
        hidden={aba !== "senha"}
      >
        <section className="bloco">
          <h2>E-mail de login</h2>

          {erroEmail ? (
            <div className="aviso aviso-erro">{erroEmail}</div>
          ) : null}

          <div className="linha-campos">
            <label className="campo">
              <span>E-mail</span>
              <input
                className="entrada"
                type="email"
                value={emailForm.email}
                onChange={(e) =>
                  setEmailForm({ ...emailForm, email: e.target.value })
                }
                autoComplete="username"
              />
            </label>
            <label className="campo">
              <span>Sua senha atual</span>
              <input
                className="entrada"
                type="password"
                value={emailForm.senhaAtual}
                onChange={(e) =>
                  setEmailForm({ ...emailForm, senhaAtual: e.target.value })
                }
                autoComplete="current-password"
              />
            </label>
          </div>

          <button
            className="btn btn-verde"
            onClick={trocarEmail}
            disabled={trocandoEmail}
          >
            {trocandoEmail ? "Salvando…" : "Salvar e-mail"}
          </button>

          <p
            style={{
              fontSize: 13.5,
              color: "var(--tinta-suave)",
              marginTop: 12,
              marginBottom: 0,
            }}
          >
            Confirma com a senha atual — é o e-mail que você usa para entrar e
            para receber o link de redefinir senha.
          </p>
        </section>

        <section className="bloco">
          <h2>Trocar senha</h2>

          {erroSenha ? (
            <div className="aviso aviso-erro">{erroSenha}</div>
          ) : null}

          <div className="linha-campos">
            <label className="campo">
              <span>Senha atual</span>
              <input
                className="entrada"
                type="password"
                value={senhas.atual}
                onChange={(e) =>
                  setSenhas({ ...senhas, atual: e.target.value })
                }
                autoComplete="current-password"
              />
            </label>
            <label className="campo">
              <span>Senha nova</span>
              <input
                className="entrada"
                type="password"
                value={senhas.nova}
                onChange={(e) => setSenhas({ ...senhas, nova: e.target.value })}
                autoComplete="new-password"
              />
            </label>
            <label className="campo">
              <span>Repita a senha nova</span>
              <input
                className="entrada"
                type="password"
                value={senhas.confirmacao}
                onChange={(e) =>
                  setSenhas({ ...senhas, confirmacao: e.target.value })
                }
                autoComplete="new-password"
              />
            </label>
          </div>

          <button
            className="btn btn-verde"
            onClick={trocarSenha}
            disabled={trocando}
          >
            {trocando ? "Trocando…" : "Trocar senha"}
          </button>

          <p
            style={{
              fontSize: 13.5,
              color: "var(--tinta-suave)",
              marginTop: 12,
              marginBottom: 0,
            }}
          >
            Mínimo de 6 caracteres. Ao trocar, qualquer outro aparelho que
            esteja com o painel aberto é desconectado — só este continua logado.
          </p>
        </section>
      </div>
    </>
  );
}
