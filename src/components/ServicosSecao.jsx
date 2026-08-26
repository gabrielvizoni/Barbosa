"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { animate } from "animejs";
import { moeda } from "@/lib/format";

/** Agrupa serviços por categoria e permite filtrar por elas. */
export default function ServicosSecao({ servicos, barbeiros }) {
  const categorias = useMemo(() => {
    const vistas = [];
    for (const s of servicos) {
      if (s.categoria && !vistas.includes(s.categoria))
        vistas.push(s.categoria);
    }
    return vistas;
  }, [servicos]);

  const [filtro, setFiltro] = useState("Todos");
  const gradeRef = useRef(null);
  const primeiraRenderizacao = useRef(true);
  const alturaAntes = useRef(null);

  /* Guarda a altura da grade ANTES de trocar de categoria — depois que o
   * React já escondeu/mostrou os cartões, não tem mais como saber de onde
   * ela veio. */
  function trocarFiltro(nova) {
    const grade = gradeRef.current;
    if (grade) alturaAntes.current = grade.getBoundingClientRect().height;
    setFiltro(nova);
  }

  /* Um leve deslize na grade inteira a cada troca de categoria — simples e sem
   * estado por cartão, então não tem como "travar" mesmo clicando rápido:
   * cada troca só reinicia essa mesma animação no mesmo elemento. Anima
   * também a altura (de quanto era pra quanto passou a ser), pra tudo que
   * vem depois na página — a seção da equipe, por exemplo — deslizar junto
   * em vez de simplesmente pular pro lugar novo. */
  useEffect(() => {
    if (primeiraRenderizacao.current) {
      primeiraRenderizacao.current = false;
      return;
    }
    const grade = gradeRef.current;
    if (!grade) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const antiga = alturaAntes.current;
    // Limpa antes de medir: uma transição anterior interrompida pode ter
    // deixado a altura presa num valor no meio do caminho.
    grade.style.height = "";
    const nova = grade.getBoundingClientRect().height;

    const parametros = {
      opacity: [0.35, 1],
      translateY: [10, 0],
      duration: 400,
      ease: "outQuad",
    };

    if (antiga != null && Math.abs(antiga - nova) > 1) {
      grade.style.overflow = "hidden";
      parametros.height = [antiga, nova];
      parametros.onComplete = () => {
        grade.style.height = "";
        grade.style.overflow = "";
      };
    } else {
      grade.style.overflow = "";
    }

    animate(grade, parametros);
  }, [filtro]);

  function nomesProfissionais(idsBarbeiros) {
    return idsBarbeiros
      .map((id) => barbeiros.find((b) => b.id === id)?.nome)
      .filter(Boolean)
      .map((nome) => nome.split(" ")[0]);
  }

  return (
    <>
      {categorias.length > 1 ? (
        <div
          className="filtro-categorias"
          role="tablist"
          aria-label="Filtrar serviços por categoria"
        >
          <button
            type="button"
            className={`filtro-chip ${filtro === "Todos" ? "ativo" : ""}`}
            onClick={() => trocarFiltro("Todos")}
            aria-pressed={filtro === "Todos"}
          >
            Todos
          </button>
          {categorias.map((categoria) => (
            <button
              key={categoria}
              type="button"
              className={`filtro-chip ${filtro === categoria ? "ativo" : ""}`}
              onClick={() => trocarFiltro(categoria)}
              aria-pressed={filtro === categoria}
            >
              {categoria}
            </button>
          ))}
        </div>
      ) : null}

      <div className="grade" ref={gradeRef}>
        {/* Sempre renderiza todos os cartões e só esconde via CSS — removê-los do
            DOM ao trocar de categoria criaria nós novos, que nunca passam pela
            animação de entrada (ela roda uma vez só, ver Animacoes.jsx) e
            ficariam presos no opacity:0 inicial. */}
        {servicos.map((servico) => {
          const nomes = nomesProfissionais(servico.barbeiros);
          const visivel = filtro === "Todos" || servico.categoria === filtro;
          return (
            <article
              className={`cartao-servico ${visivel ? "" : "cartao-servico-oculto"}`}
              key={servico.id}
            >
              {servico.imagem ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  className="cartao-servico-imagem"
                  src={servico.imagem}
                  alt=""
                />
              ) : null}
              <span className="sobrenome" style={{ marginBottom: 0 }}>
                {servico.categoria}
              </span>
              <h3>{servico.nome}</h3>
              {servico.descricao ? <p>{servico.descricao}</p> : null}
              {nomes.length > 0 ? (
                <p className="cartao-servico-profissionais">
                  Com <strong>{nomes.join(" ou ")}</strong>
                </p>
              ) : null}
              <div className="cartao-rodape">
                <span className="preco">{moeda(servico.preco_centavos)}</span>
                <span className="duracao">{servico.duracao_min} min</span>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
