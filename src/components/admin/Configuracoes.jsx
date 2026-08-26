"use client";

import { useEffect, useState } from "react";
import { api, CampoImagem } from "./base";
import { mascararTelefone, somenteDigitos } from "@/lib/format";

const SENHAS_VAZIAS = { atual: "", nova: "", confirmacao: "" };
const SENHA_MINIMA = 6;

export default function Configuracoes({ avisar, tratarErro, aoTrocarSenha }) {
  const [config, setConfig] = useState(null);
  const [salvando, setSalvando] = useState(false);

  const [senhas, setSenhas] = useState(SENHAS_VAZIAS);
  const [senhaInicial, setSenhaInicial] = useState(false);
  const [erroSenha, setErroSenha] = useState("");
  const [trocando, setTrocando] = useState(false);

  useEffect(() => {
    api("config")
      .then((r) => {
        setConfig(r.config);
        setSenhaInicial(!!r.senhaInicial);
      })
      .catch(tratarErro);
  }, [tratarErro]);

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
      await api("senha", {
        method: "POST",
        body: {
          senhaAtual: senhas.atual,
          novaSenha: senhas.nova,
          confirmacao: senhas.confirmacao,
        },
      });
      setSenhas(SENHAS_VAZIAS);
      setSenhaInicial(false);
      aoTrocarSenha?.();
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
      await api("config", {
        method: "PUT",
        body: {
          config: { ...config, whatsapp: somenteDigitos(config.whatsapp) },
        },
      });
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
          Sem esse número, o botão de confirmação no WhatsApp não aparece para o
          cliente no fim do agendamento.
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
          style={{ fontSize: 13.5, color: "var(--tinta-suave)", marginTop: 10 }}
        >
          Desmarcado, todo agendamento entra como pendente e espera você
          confirmar na tela de Agendamentos.
        </p>
      </section>

      <button className="btn btn-ouro" onClick={salvar} disabled={salvando}>
        {salvando ? "Salvando…" : "Salvar configurações"}
      </button>

      <section className="bloco" style={{ marginTop: 24 }}>
        <h2>Senha do painel</h2>

        {senhaInicial ? (
          <div className="aviso">
            Você ainda está usando a senha inicial, a mesma que veio na
            instalação. Defina uma senha sua agora.
          </div>
        ) : null}

        {erroSenha ? <div className="aviso aviso-erro">{erroSenha}</div> : null}

        <div className="linha-campos">
          <label className="campo">
            <span>Senha atual</span>
            <input
              className="entrada"
              type="password"
              value={senhas.atual}
              onChange={(e) => setSenhas({ ...senhas, atual: e.target.value })}
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
          Mínimo de 6 caracteres. Ao trocar, qualquer outro aparelho que esteja
          com o painel aberto é desconectado — só este continua logado.
        </p>
      </section>
    </>
  );
}
