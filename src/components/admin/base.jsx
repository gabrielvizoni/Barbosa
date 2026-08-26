"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Xis } from "@/components/Icones";

/** Chama a API do painel e transforma erro de resposta em exceção com mensagem legível. */
export async function api(caminho, opcoes = {}) {
  const resposta = await fetch(`/api/admin/${caminho}`, {
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

const SELETOR_FOCAVEIS =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Prende o foco dentro do modal (Tab/Shift+Tab não escapam para o resto da
 * página), fecha com Escape e devolve o foco a quem abriu o modal ao
 * fechar — para quem navega só com teclado, era o defeito mais grave da
 * interface antes desta correção.
 */
export function Modal({ titulo, children, aoFechar, rodape }) {
  const caixa = useRef(null);
  const gatilhoAnterior = useRef(null);

  useEffect(() => {
    gatilhoAnterior.current = document.activeElement;
    const foco = caixa.current?.querySelector(SELETOR_FOCAVEIS);
    (foco || caixa.current)?.focus();

    function aoTeclar(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        aoFechar();
        return;
      }
      if (e.key !== "Tab" || !caixa.current) return;
      const focaveis = Array.from(
        caixa.current.querySelectorAll(SELETOR_FOCAVEIS),
      );
      if (focaveis.length === 0) return;
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    }

    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("keydown", aoTeclar);
      gatilhoAnterior.current?.focus?.();
    };
  }, [aoFechar]);

  return (
    <div
      className="fundo-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) aoFechar();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        tabIndex={-1}
        ref={caixa}
      >
        <div className="modal-topo">
          <h2>{titulo}</h2>
          <button className="fechar" onClick={aoFechar} aria-label="Fechar">
            <Xis width={20} height={20} />
          </button>
        </div>
        <div className="modal-corpo">{children}</div>
        {rodape ? <div className="modal-base">{rodape}</div> : null}
      </div>
    </div>
  );
}

/**
 * Substitui o `confirm()` nativo do navegador por um modal do próprio
 * sistema. Quando `exigirTexto` é passado, o botão de confirmar só habilita
 * depois de digitar exatamente esse texto — fricção proposital para ações
 * mais arriscadas (ex.: excluir um agendamento, exigindo o nome do cliente).
 */
export function ModalConfirmacao({
  titulo,
  mensagem,
  confirmarLabel = "Confirmar",
  cancelarLabel = "Cancelar",
  perigo = false,
  exigirTexto,
  confirmando = false,
  aoConfirmar,
  aoFechar,
}) {
  const [digitado, setDigitado] = useState("");
  const bloqueado =
    confirmando ||
    (exigirTexto !== undefined && digitado.trim() !== exigirTexto);

  return (
    <Modal
      titulo={titulo}
      aoFechar={aoFechar}
      rodape={
        <>
          <button className="btn btn-contorno" onClick={aoFechar}>
            {cancelarLabel}
          </button>
          <button
            className={`btn ${perigo ? "btn-perigo" : "btn-ouro"}`}
            onClick={aoConfirmar}
            disabled={bloqueado}
          >
            {confirmarLabel}
          </button>
        </>
      }
    >
      <div style={{ marginBottom: exigirTexto !== undefined ? 14 : 0 }}>
        {mensagem}
      </div>
      {exigirTexto !== undefined ? (
        <label className="campo" style={{ marginBottom: 0 }}>
          <span>
            Digite <strong>{exigirTexto}</strong> para confirmar
          </span>
          <input
            className="entrada"
            value={digitado}
            onChange={(e) => setDigitado(e.target.value)}
            autoFocus
          />
        </label>
      ) : null}
    </Modal>
  );
}

export function Etiqueta({ status }) {
  const rotulos = {
    pendente: "Pendente",
    confirmado: "Confirmado",
    concluido: "Concluído",
    cancelado: "Cancelado",
  };
  return (
    <span className={`etiqueta etiqueta-${status}`}>
      {rotulos[status] || status}
    </span>
  );
}

/** Campo de upload de imagem: mostra a prévia e envia pro servidor assim que o arquivo é escolhido. */
export function CampoImagem({ label, valor, aoMudar, pasta, avisar }) {
  const [enviando, setEnviando] = useState(false);
  const idEntrada = useId();

  async function selecionar(evento) {
    const arquivo = evento.target.files?.[0];
    evento.target.value = "";
    if (!arquivo) return;

    setEnviando(true);
    try {
      const corpo = new FormData();
      corpo.append("arquivo", arquivo);
      corpo.append("pasta", pasta);
      // Manda a imagem atual para o servidor apagar depois de gravar a
      // nova — senão a antiga fica órfã no disco para sempre.
      if (valor) corpo.append("anterior", valor);
      const resposta = await fetch("/api/admin/upload", {
        method: "POST",
        body: corpo,
      });
      const dados = await resposta.json().catch(() => ({}));
      if (!resposta.ok)
        throw new Error(dados.erro || "Não consegui enviar a imagem.");
      aoMudar(dados.url);
    } catch (erro) {
      avisar?.(erro.message, "erro");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="campo">
      <span>{label}</span>
      <div className="campo-imagem">
        {valor ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            className="campo-imagem-previa"
            src={valor}
            alt=""
            width={64}
            height={64}
            loading="lazy"
          />
        ) : (
          <div className="campo-imagem-vazia">Sem imagem</div>
        )}
        <div className="campo-imagem-acoes">
          <label className="btn btn-contorno btn-mini" htmlFor={idEntrada}>
            {enviando ? "Enviando…" : valor ? "Trocar imagem" : "Enviar imagem"}
          </label>
          <input
            id={idEntrada}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            style={{ display: "none" }}
            onChange={selecionar}
            disabled={enviando}
          />
          {valor ? (
            <button
              type="button"
              className="icone-btn perigo"
              onClick={() => aoMudar("")}
              title="Remover imagem"
            >
              <Xis width={14} height={14} />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function Vazio({ titulo, children }) {
  return (
    <div className="vazio">
      <strong>{titulo}</strong>
      {children}
    </div>
  );
}
