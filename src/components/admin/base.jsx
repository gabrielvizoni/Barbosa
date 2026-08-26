"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calendario, Seta, SetaEsquerda, Xis } from "@/components/Icones";
import { dataBr } from "@/lib/format";
import { hojeLocal } from "@/lib/datas-cliente";
import { usePainelConfig } from "./ConfigContext";

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

export function Modal({ titulo, children, aoFechar, rodape }) {
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
          <img className="campo-imagem-previa" src={valor} alt="" />
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

const DIAS_SEMANA_LETRA = ["D", "S", "T", "Q", "Q", "S", "S"];
const MESES_LONGOS_CALENDARIO = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/** As 6 semanas (42 dias) que cobrem o mês, incluindo as pontas dos meses vizinhos. */
function gradeDoMes(ano, mes) {
  const inicio = new Date(Date.UTC(ano, mes, 1));
  inicio.setUTCDate(inicio.getUTCDate() - inicio.getUTCDay());
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(inicio);
    d.setUTCDate(inicio.getUTCDate() + i);
    return {
      chave: d.toISOString().slice(0, 10),
      dia: d.getUTCDate(),
      foraDoMes: d.getUTCMonth() !== mes,
    };
  });
}

// Tamanho aproximado do painel — usado só pra decidir de que lado ele abre,
// antes mesmo do primeiro paint (por isso não dá pra medir o elemento real).
const PAINEL_LARGURA = 284;
const PAINEL_ALTURA = 370;

/**
 * Calendário próprio, com o mesmo formato do seletor nativo do navegador
 * (cabeçalho do mês, dias da semana em uma letra, grade de 6 semanas,
 * "Limpar" e "Hoje" no rodapé) — só que na cara da casa, em vez do azul
 * padrão do sistema. O painel é desenhado num portal fixado à janela, pra
 * não ficar cortado por modais e outros contêineres com overflow: hidden.
 */
export function SeletorData({ value, onChange, className = "" }) {
  const { fuso } = usePainelConfig();
  const [aberto, setAberto] = useState(false);
  const [cursor, setCursor] = useState(() => {
    const base = value ? new Date(`${value}T00:00:00Z`) : new Date();
    return { ano: base.getUTCFullYear(), mes: base.getUTCMonth() };
  });
  const [posicao, setPosicao] = useState(null);
  const gatilho = useRef(null);
  const painel = useRef(null);

  useEffect(() => {
    if (!aberto) return;
    function aoClicarFora(e) {
      if (
        gatilho.current?.contains(e.target) ||
        painel.current?.contains(e.target)
      )
        return;
      setAberto(false);
    }
    document.addEventListener("mousedown", aoClicarFora);
    return () => document.removeEventListener("mousedown", aoClicarFora);
  }, [aberto]);

  useEffect(() => {
    if (!aberto) return;
    function posicionar() {
      const r = gatilho.current?.getBoundingClientRect();
      if (!r) return;
      const cabeAbaixo = r.bottom + 8 + PAINEL_ALTURA <= window.innerHeight;
      setPosicao({
        top: cabeAbaixo ? r.bottom + 8 : Math.max(8, r.top - 8 - PAINEL_ALTURA),
        left: Math.min(r.left, window.innerWidth - PAINEL_LARGURA - 12),
      });
    }
    posicionar();
    window.addEventListener("resize", posicionar);
    window.addEventListener("scroll", posicionar, true);
    return () => {
      window.removeEventListener("resize", posicionar);
      window.removeEventListener("scroll", posicionar, true);
    };
  }, [aberto]);

  function alternar() {
    const base = value ? new Date(`${value}T00:00:00Z`) : new Date();
    setCursor({ ano: base.getUTCFullYear(), mes: base.getUTCMonth() });
    setAberto((a) => !a);
  }

  function mudarMes(delta) {
    setCursor((c) => {
      const d = new Date(Date.UTC(c.ano, c.mes + delta, 1));
      return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() };
    });
  }

  function escolher(chave) {
    onChange(chave);
    setAberto(false);
  }

  const celulas = gradeDoMes(cursor.ano, cursor.mes);
  const hoje = hojeLocal(fuso);

  return (
    <div className={`seletor-data ${className}`} ref={gatilho}>
      <button
        type="button"
        className="entrada mono seletor-data-gatilho"
        onClick={alternar}
      >
        {value ? dataBr(value) : "dd/mm/aaaa"}
        <Calendario width={14} height={14} />
      </button>

      {aberto && posicao
        ? createPortal(
            <div
              className="seletor-data-painel"
              ref={painel}
              style={{ top: posicao.top, left: posicao.left }}
            >
              <div className="seletor-data-cabeca">
                <span>
                  {MESES_LONGOS_CALENDARIO[cursor.mes]} de {cursor.ano}
                </span>
                <div className="seletor-data-nav">
                  <button
                    type="button"
                    onClick={() => mudarMes(-1)}
                    aria-label="Mês anterior"
                  >
                    <SetaEsquerda width={13} height={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => mudarMes(1)}
                    aria-label="Próximo mês"
                  >
                    <Seta width={13} height={13} />
                  </button>
                </div>
              </div>

              <div className="seletor-data-semana">
                {DIAS_SEMANA_LETRA.map((letra, i) => (
                  <span key={i}>{letra}</span>
                ))}
              </div>

              <div className="seletor-data-grade">
                {celulas.map((c) => (
                  <button
                    type="button"
                    key={c.chave}
                    className={[
                      "seletor-data-dia",
                      c.foraDoMes && "fora",
                      c.chave === value && "selecionado",
                      c.chave === hoje && "hoje",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => escolher(c.chave)}
                  >
                    {c.dia}
                  </button>
                ))}
              </div>

              <div className="seletor-data-rodape">
                <button type="button" onClick={() => escolher("")}>
                  Limpar
                </button>
                <button type="button" onClick={() => escolher(hoje)}>
                  Hoje
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/**
 * Um <select> com a cara da casa em vez do menu cinza do sistema —
 * mesmo mecanismo de portal fixado à janela do SeletorData, só que como
 * lista de opções em vez de calendário. `options` é [{ value, rotulo }].
 */
export function SeletorLista({
  value,
  onChange,
  options,
  placeholder = "Selecione…",
  className = "",
}) {
  const [aberto, setAberto] = useState(false);
  const [posicao, setPosicao] = useState(null);
  const gatilho = useRef(null);
  const painel = useRef(null);

  useEffect(() => {
    if (!aberto) return;
    function aoClicarFora(e) {
      if (
        gatilho.current?.contains(e.target) ||
        painel.current?.contains(e.target)
      )
        return;
      setAberto(false);
    }
    document.addEventListener("mousedown", aoClicarFora);
    return () => document.removeEventListener("mousedown", aoClicarFora);
  }, [aberto]);

  useEffect(() => {
    if (!aberto) return;
    function posicionar() {
      const r = gatilho.current?.getBoundingClientRect();
      if (!r) return;
      setPosicao({
        top: r.bottom + 6,
        left: r.left,
        minWidth: r.width,
        maxHeight: Math.max(160, window.innerHeight - r.bottom - 24),
      });
    }
    posicionar();
    window.addEventListener("resize", posicionar);
    window.addEventListener("scroll", posicionar, true);
    return () => {
      window.removeEventListener("resize", posicionar);
      window.removeEventListener("scroll", posicionar, true);
    };
  }, [aberto]);

  const selecionada = options.find((o) => o.value === value);

  function escolher(v) {
    onChange(v);
    setAberto(false);
  }

  return (
    <div className={`seletor-lista ${className}`} ref={gatilho}>
      <button
        type="button"
        className="entrada seletor-lista-gatilho"
        onClick={() => setAberto((a) => !a)}
      >
        <span>{selecionada ? selecionada.rotulo : placeholder}</span>
        <Seta width={11} height={11} className="seletor-lista-seta" />
      </button>

      {aberto && posicao
        ? createPortal(
            <div
              className="seletor-lista-painel"
              ref={painel}
              style={{
                top: posicao.top,
                left: posicao.left,
                minWidth: posicao.minWidth,
                maxHeight: posicao.maxHeight,
              }}
            >
              {options.map((o) => (
                <button
                  type="button"
                  key={o.value}
                  className={`seletor-lista-opcao ${o.value === value ? "selecionada" : ""}`}
                  onClick={() => escolher(o.value)}
                >
                  {o.rotulo}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
