"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CampoEmail, CampoSenha } from "@/components/campos";
import { ModalConfirmacao } from "@/components/admin/base";
import { mascararTelefone, somenteDigitos } from "@/lib/format";

const SENHA_MINIMA = 6;

/** Chama /api/conta/* e transforma erro de resposta em exceção com mensagem legível. */
async function chamar(caminho, opcoes = {}) {
  const url = caminho ? `/api/conta/${caminho}` : "/api/conta";
  const resposta = await fetch(url, {
    headers: opcoes.body ? { "Content-Type": "application/json" } : undefined,
    ...opcoes,
    body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
  });
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    const erro = new Error(corpo.erro || "Não consegui completar a ação.");
    erro.status = resposta.status;
    throw erro;
  }
  return corpo;
}

/** `retorno` só pode ser um caminho interno — nunca uma URL absoluta (open redirect). */
function retornoSeguro(valor) {
  return valor && valor.startsWith("/") && !valor.startsWith("//")
    ? valor
    : null;
}

export default function AreaCliente() {
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams.get("token") || "", [searchParams]);
  const retorno = useMemo(
    () => retornoSeguro(searchParams.get("retorno")),
    [searchParams],
  );

  // verificando | entrar | cadastrar | esqueci | redefinir | dentro
  const [estado, setEstado] = useState("verificando");
  const [cliente, setCliente] = useState(null);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState("");

  // formulários
  const [entrarForm, setEntrarForm] = useState({ email: "", senha: "" });
  const [cadastroForm, setCadastroForm] = useState({
    nome: "",
    telefone: "",
    email: "",
    senha: "",
    confirmacao: "",
  });
  const [emailEsqueci, setEmailEsqueci] = useState("");
  const [resetForm, setResetForm] = useState({ nova: "", confirmacao: "" });
  const [resetOk, setResetOk] = useState(false);

  // "Meus dados"
  const [dados, setDados] = useState({ nome: "", telefone: "", email: "" });
  const [dadosOriginais, setDadosOriginais] = useState(null);
  const [senhaParaEmail, setSenhaParaEmail] = useState("");
  const [senhaForm, setSenhaForm] = useState({
    atual: "",
    nova: "",
    confirmacao: "",
  });
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);

  const irParaDentro = useCallback((c) => {
    setCliente(c);
    setDados({ nome: c.nome, telefone: c.telefone, email: c.email });
    setDadosOriginais({ nome: c.nome, telefone: c.telefone, email: c.email });
    setEstado("dentro");
  }, []);

  const concluirLogin = useCallback(async () => {
    const r = await chamar("sessao");
    if (retorno) {
      window.location.href = retorno;
      return;
    }
    irParaDentro(r.cliente);
  }, [retorno, irParaDentro]);

  useEffect(() => {
    if (token) {
      setEstado("redefinir");
      return;
    }
    chamar("sessao")
      .then((r) => {
        if (r.autenticado) irParaDentro(r.cliente);
        else setEstado("entrar");
      })
      .catch(() => setEstado("entrar"));
  }, [token, irParaDentro]);

  function mostrarAviso(texto) {
    setAviso(texto);
    setTimeout(() => setAviso(""), 3500);
  }

  async function entrar(evento) {
    evento.preventDefault();
    setErro("");
    setOcupado(true);
    try {
      await chamar("login", { method: "POST", body: entrarForm });
      await concluirLogin();
    } catch (e) {
      setErro(e.message);
    } finally {
      setOcupado(false);
    }
  }

  async function cadastrar(evento) {
    evento.preventDefault();
    setErro("");
    if (cadastroForm.senha.length < SENHA_MINIMA) {
      return setErro(
        `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`,
      );
    }
    if (cadastroForm.senha !== cadastroForm.confirmacao) {
      return setErro("A confirmação não bate com a senha.");
    }
    setOcupado(true);
    try {
      await chamar("cadastro", {
        method: "POST",
        body: {
          nome: cadastroForm.nome,
          telefone: somenteDigitos(cadastroForm.telefone),
          email: cadastroForm.email,
          senha: cadastroForm.senha,
        },
      });
      await concluirLogin();
    } catch (e) {
      setErro(e.message);
    } finally {
      setOcupado(false);
    }
  }

  async function pedirRecuperacao(evento) {
    evento.preventDefault();
    setErro("");
    setOcupado(true);
    try {
      const r = await chamar("esqueci-senha", {
        method: "POST",
        body: { email: emailEsqueci },
      });
      setAviso(r.mensagem);
    } catch (e) {
      setAviso(e.message);
    } finally {
      setOcupado(false);
    }
  }

  async function redefinir(evento) {
    evento.preventDefault();
    setErro("");
    if (resetForm.nova.length < SENHA_MINIMA) {
      return setErro(
        `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`,
      );
    }
    if (resetForm.nova !== resetForm.confirmacao) {
      return setErro("A confirmação não bate com a senha nova.");
    }
    setOcupado(true);
    try {
      await chamar("redefinir-senha", {
        method: "POST",
        body: {
          token,
          novaSenha: resetForm.nova,
          confirmacao: resetForm.confirmacao,
        },
      });
      setResetOk(true);
    } catch (e) {
      setErro(e.message);
    } finally {
      setOcupado(false);
    }
  }

  const dadosSujos =
    dadosOriginais &&
    (dados.nome !== dadosOriginais.nome ||
      somenteDigitos(dados.telefone) !==
        somenteDigitos(dadosOriginais.telefone) ||
      dados.email.trim().toLowerCase() !==
        dadosOriginais.email.trim().toLowerCase());
  const trocandoEmail =
    dadosOriginais &&
    dados.email.trim().toLowerCase() !==
      dadosOriginais.email.trim().toLowerCase();

  async function salvarDados(evento) {
    evento.preventDefault();
    setErro("");
    if (trocandoEmail && !senhaParaEmail) {
      return setErro("Informe sua senha atual para trocar o e-mail.");
    }
    setOcupado(true);
    try {
      const r = await chamar("perfil", {
        method: "PATCH",
        body: {
          nome: dados.nome,
          telefone: somenteDigitos(dados.telefone),
          email: dados.email,
          senhaAtual: senhaParaEmail,
        },
      });
      setSenhaParaEmail("");
      irParaDentro(r);
      mostrarAviso("Dados salvos.");
    } catch (e) {
      setErro(e.message);
    } finally {
      setOcupado(false);
    }
  }

  async function trocarSenha(evento) {
    evento.preventDefault();
    setErro("");
    if (senhaForm.nova.length < SENHA_MINIMA) {
      return setErro(
        `A senha nova precisa ter pelo menos ${SENHA_MINIMA} caracteres.`,
      );
    }
    if (senhaForm.nova !== senhaForm.confirmacao) {
      return setErro("A confirmação não bate com a senha nova.");
    }
    setOcupado(true);
    try {
      await chamar("perfil/senha", {
        method: "POST",
        body: {
          senhaAtual: senhaForm.atual,
          novaSenha: senhaForm.nova,
          confirmacao: senhaForm.confirmacao,
        },
      });
      setSenhaForm({ atual: "", nova: "", confirmacao: "" });
      mostrarAviso("Senha trocada.");
    } catch (e) {
      setErro(e.message);
    } finally {
      setOcupado(false);
    }
  }

  async function sair() {
    await chamar("logout", { method: "POST" }).catch(() => {});
    setCliente(null);
    setEstado("entrar");
  }

  async function excluirConta() {
    setConfirmandoExclusao(false);
    setOcupado(true);
    try {
      await chamar("", { method: "DELETE" });
      setCliente(null);
      setEstado("entrar");
      mostrarAviso("Sua conta foi excluída.");
    } catch (e) {
      setErro(e.message);
    } finally {
      setOcupado(false);
    }
  }

  /* ------------------------------ Telas ------------------------------ */

  if (estado === "verificando") {
    return <p className="painel-ajuda">Carregando…</p>;
  }

  const cartao = (titulo, conteudo) => (
    <div className="acesso-cartao" style={{ maxWidth: 440, margin: "0 auto" }}>
      <div className="acesso-cartao-topo">
        <span className="sobrenome">Sua conta</span>
        <h1>{titulo}</h1>
      </div>
      {erro ? <div className="aviso aviso-erro">{erro}</div> : null}
      {conteudo}
      {aviso ? (
        <div className="aviso" style={{ marginTop: 12 }}>
          {aviso}
        </div>
      ) : null}
    </div>
  );

  if (estado === "redefinir") {
    return cartao(
      "Redefinir senha",
      resetOk ? (
        <>
          <div className="aviso">Senha definida! Já pode entrar com ela.</div>
          <a className="btn btn-verde btn-bloco" href="/conta">
            Ir para o login
          </a>
        </>
      ) : (
        <form onSubmit={redefinir}>
          <p className="painel-ajuda" style={{ marginTop: 0 }}>
            Escolha uma senha nova para a sua conta.
          </p>
          <CampoSenha
            label="Senha nova"
            valor={resetForm.nova}
            aoMudar={(v) => setResetForm({ ...resetForm, nova: v })}
            autoFocus
            autoComplete="new-password"
          />
          <CampoSenha
            label="Repita a senha nova"
            valor={resetForm.confirmacao}
            aoMudar={(v) => setResetForm({ ...resetForm, confirmacao: v })}
            autoComplete="new-password"
          />
          <button className="btn btn-verde btn-bloco" disabled={ocupado}>
            {ocupado ? "Salvando…" : "Definir senha"}
          </button>
        </form>
      ),
    );
  }

  if (estado === "esqueci") {
    return cartao(
      "Recuperar senha",
      <form onSubmit={pedirRecuperacao}>
        <p className="painel-ajuda" style={{ marginTop: 0 }}>
          Informe o e-mail da conta. Se ele existir, enviamos um link para
          redefinir a senha.
        </p>
        <CampoEmail
          label="E-mail"
          valor={emailEsqueci}
          aoMudar={setEmailEsqueci}
          autoFocus
          autoComplete="email"
        />
        <button className="btn btn-verde btn-bloco" disabled={ocupado}>
          {ocupado ? "Enviando…" : "Enviar link"}
        </button>
        <button
          type="button"
          className="link-simples"
          style={{ marginTop: 14, display: "block" }}
          onClick={() => {
            setErro("");
            setEstado("entrar");
          }}
        >
          Voltar
        </button>
      </form>,
    );
  }

  if (estado === "cadastrar") {
    return cartao(
      "Criar conta",
      <form onSubmit={cadastrar}>
        <p className="painel-ajuda" style={{ marginTop: 0 }}>
          Precisamos disso para vincular seus agendamentos e falar com você.
        </p>
        <label className="campo">
          <span>Nome</span>
          <input
            className="entrada"
            value={cadastroForm.nome}
            onChange={(e) =>
              setCadastroForm({ ...cadastroForm, nome: e.target.value })
            }
            autoComplete="name"
            autoFocus
          />
        </label>
        <label className="campo">
          <span>WhatsApp com DDD</span>
          <input
            className="entrada mono"
            value={cadastroForm.telefone}
            onChange={(e) =>
              setCadastroForm({
                ...cadastroForm,
                telefone: mascararTelefone(e.target.value),
              })
            }
            placeholder="(44) 99999-0000"
            inputMode="numeric"
            autoComplete="tel"
          />
        </label>
        <CampoEmail
          label="E-mail"
          valor={cadastroForm.email}
          aoMudar={(v) => setCadastroForm({ ...cadastroForm, email: v })}
          autoComplete="email"
        />
        <CampoSenha
          label="Senha"
          valor={cadastroForm.senha}
          aoMudar={(v) => setCadastroForm({ ...cadastroForm, senha: v })}
          autoComplete="new-password"
        />
        <CampoSenha
          label="Repita a senha"
          valor={cadastroForm.confirmacao}
          aoMudar={(v) => setCadastroForm({ ...cadastroForm, confirmacao: v })}
          autoComplete="new-password"
        />
        <button className="btn btn-verde btn-bloco" disabled={ocupado}>
          {ocupado ? "Criando…" : "Criar conta"}
        </button>
        <button
          type="button"
          className="link-simples"
          style={{ marginTop: 14, display: "block" }}
          onClick={() => {
            setErro("");
            setEstado("entrar");
          }}
        >
          Já tenho conta
        </button>
      </form>,
    );
  }

  if (estado === "entrar") {
    return cartao(
      "Entrar",
      <form onSubmit={entrar}>
        <CampoEmail
          label="E-mail"
          valor={entrarForm.email}
          aoMudar={(v) => setEntrarForm({ ...entrarForm, email: v })}
          autoFocus
          autoComplete="email"
        />
        <CampoSenha
          label="Senha"
          valor={entrarForm.senha}
          aoMudar={(v) => setEntrarForm({ ...entrarForm, senha: v })}
          autoComplete="current-password"
        />
        <button className="btn btn-verde btn-bloco" disabled={ocupado}>
          {ocupado ? "Entrando…" : "Entrar"}
        </button>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 14,
          }}
        >
          <button
            type="button"
            className="link-simples"
            onClick={() => {
              setErro("");
              setEstado("cadastrar");
            }}
          >
            Criar conta
          </button>
          <button
            type="button"
            className="link-simples"
            onClick={() => {
              setErro("");
              setEstado("esqueci");
            }}
          >
            Esqueci a senha
          </button>
        </div>
      </form>,
    );
  }

  // estado === "dentro" — Meus dados
  return (
    <div style={{ maxWidth: 560, margin: "0 auto" }}>
      <div className="conteudo-topo">
        <div>
          <h1>Meus dados</h1>
          <p>Olá, {cliente?.nome?.split(" ")[0]}.</p>
        </div>
        <button className="btn btn-contorno" onClick={sair}>
          Sair
        </button>
      </div>

      {erro ? <div className="aviso aviso-erro">{erro}</div> : null}
      {aviso ? <div className="aviso">{aviso}</div> : null}

      <section className="bloco">
        <h2>Dados cadastrais</h2>
        <form onSubmit={salvarDados}>
          <label className="campo">
            <span>Nome</span>
            <input
              className="entrada"
              value={dados.nome}
              onChange={(e) => setDados({ ...dados, nome: e.target.value })}
              autoComplete="name"
            />
          </label>
          <label className="campo">
            <span>WhatsApp com DDD</span>
            <input
              className="entrada mono"
              value={mascararTelefone(dados.telefone)}
              onChange={(e) => setDados({ ...dados, telefone: e.target.value })}
              inputMode="numeric"
              autoComplete="tel"
            />
          </label>
          <CampoEmail
            label="E-mail"
            valor={dados.email}
            aoMudar={(v) => setDados({ ...dados, email: v })}
            autoComplete="email"
          />
          {trocandoEmail ? (
            <CampoSenha
              label="Sua senha atual (para confirmar a troca de e-mail)"
              valor={senhaParaEmail}
              aoMudar={setSenhaParaEmail}
              autoComplete="current-password"
            />
          ) : null}
          <button className="btn btn-verde" disabled={ocupado || !dadosSujos}>
            {ocupado ? "Salvando…" : "Salvar dados"}
          </button>
        </form>
      </section>

      <section className="bloco">
        <h2>Trocar senha</h2>
        <form onSubmit={trocarSenha}>
          <CampoSenha
            label="Senha atual"
            valor={senhaForm.atual}
            aoMudar={(v) => setSenhaForm({ ...senhaForm, atual: v })}
            autoComplete="current-password"
          />
          <CampoSenha
            label="Senha nova"
            valor={senhaForm.nova}
            aoMudar={(v) => setSenhaForm({ ...senhaForm, nova: v })}
            autoComplete="new-password"
          />
          <CampoSenha
            label="Repita a senha nova"
            valor={senhaForm.confirmacao}
            aoMudar={(v) => setSenhaForm({ ...senhaForm, confirmacao: v })}
            autoComplete="new-password"
          />
          <button className="btn btn-verde" disabled={ocupado}>
            {ocupado ? "Trocando…" : "Trocar senha"}
          </button>
        </form>
      </section>

      <section className="bloco">
        <h2>Uso dos seus dados</h2>
        <p style={{ fontSize: 13.5, color: "var(--tinta-suave)" }}>
          Guardamos seu <strong>nome</strong>, <strong>telefone</strong>,{" "}
          <strong>e-mail</strong> e o{" "}
          <strong>histórico dos seus agendamentos</strong>. Usamos esses dados
          só para registrar e confirmar seus horários, entrar em contato sobre
          eles e, quando você pedir, enviar lembretes. A base legal é a execução
          do agendamento que você solicita. Você pode editar seus dados aqui a
          qualquer momento, ou pedir a exclusão da conta abaixo — nesse caso,
          seus dados pessoais são apagados e os agendamentos passados ficam sem
          identificação, mantidos apenas para o controle financeiro da
          barbearia.
        </p>
        <button
          className="btn btn-contorno btn-perigo"
          onClick={() => setConfirmandoExclusao(true)}
          disabled={ocupado}
        >
          Excluir minha conta
        </button>
      </section>

      <p style={{ textAlign: "center", marginTop: 8 }}>
        <Link href="/agendar" className="link-simples">
          Ir para o agendamento
        </Link>
      </p>

      {confirmandoExclusao ? (
        <ModalConfirmacao
          titulo="Excluir minha conta"
          mensagem="Isso apaga seus dados pessoais e desvincula seus agendamentos passados. A ação não pode ser desfeita."
          confirmarLabel="Excluir minha conta"
          perigo
          exigirTexto="EXCLUIR"
          aoConfirmar={excluirConta}
          aoFechar={() => setConfirmandoExclusao(false)}
        />
      ) : null}
    </div>
  );
}
