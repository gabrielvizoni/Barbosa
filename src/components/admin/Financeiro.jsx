"use client";

import { useCallback, useEffect, useState } from "react";
import { api, Vazio } from "./base";
import { moeda } from "@/lib/format";
import { mesAtualLocal } from "@/lib/datas-cliente";
import { usePainelConfig } from "./ConfigContext";

const MESES = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

const CORES = [
  "var(--dourado)",
  "var(--verde-700)",
  "var(--marrom-500)",
  "var(--verde-300)",
  "var(--marrom-300)",
  "var(--dourado-escuro)",
  "var(--verde-500)",
  "var(--marrom-700)",
];

function mesAnterior(mes) {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function rotuloMes(mes) {
  const [a, m] = mes.split("-").map(Number);
  return `${MESES[m - 1]}/${String(a).slice(2)}`;
}

/** Variação percentual entre dois números, tolerando divisão por zero. */
function variacao(atual, anterior) {
  if (!anterior) return atual ? { texto: "novo", sinal: 1 } : null;
  const pct = Math.round(((atual - anterior) / anterior) * 100);
  return { texto: `${pct > 0 ? "+" : ""}${pct}%`, sinal: Math.sign(pct) };
}

function Variacao({ atual, anterior, formatar }) {
  const v = variacao(atual, anterior);
  const cor = !v
    ? "var(--tinta-suave)"
    : v.sinal >= 0
      ? "var(--verde-500)"
      : "var(--erro)";
  return (
    <div className="nota">
      <span className="mono">{formatar(anterior)}</span>{" "}
      {v ? (
        <strong className="mono" style={{ color: cor }}>
          {v.texto}
        </strong>
      ) : null}
    </div>
  );
}

/** Gráfico de linha dos 12 meses, desenhado à mão em SVG. Mostra uma segunda
 * linha, mais clara e tracejada, com o mesmo período um ano antes — se ela
 * for passada. */
function GraficoLinha({ serie, serieAnoAnterior }) {
  const largura = 620;
  const altura = 140;
  const margem = { topo: 12, base: 22, esquerda: 54, direita: 10 };
  const maximo = Math.max(
    1,
    ...serie.map((p) => p.total),
    ...(serieAnoAnterior ? serieAnoAnterior.map((p) => p.total) : []),
  );

  const x = (i) =>
    margem.esquerda +
    (i * (largura - margem.esquerda - margem.direita)) /
      Math.max(1, serie.length - 1);
  const y = (v) =>
    altura - margem.base - (v / maximo) * (altura - margem.topo - margem.base);

  const caminho = (pontos) =>
    pontos
      .map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.total)}`)
      .join(" ");

  const linha = caminho(serie);
  const area = `${linha} L ${x(serie.length - 1)} ${altura - margem.base} L ${x(0)} ${
    altura - margem.base
  } Z`;
  const linhaAnterior = serieAnoAnterior ? caminho(serieAnoAnterior) : null;

  return (
    <svg
      className="grafico"
      viewBox={`0 0 ${largura} ${altura}`}
      role="img"
      aria-label="Faturamento por mês"
    >
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line
            x1={margem.esquerda}
            x2={largura - margem.direita}
            y1={y(maximo * f)}
            y2={y(maximo * f)}
            stroke="var(--linha)"
            strokeDasharray="3 4"
          />
          <text
            x={margem.esquerda - 8}
            y={y(maximo * f) + 4}
            textAnchor="end"
            fontSize="10"
            fontFamily="var(--fonte-mono)"
            fill="var(--tinta-suave)"
          >
            {moeda(maximo * f).replace(",00", "")}
          </text>
        </g>
      ))}

      <path d={area} fill="var(--dourado)" opacity="0.14" />
      {linhaAnterior ? (
        <path
          d={linhaAnterior}
          fill="none"
          stroke="var(--tinta-suave)"
          strokeWidth="1.75"
          strokeDasharray="4 4"
          strokeLinejoin="round"
        />
      ) : null}
      <path
        d={linha}
        fill="none"
        stroke="var(--dourado)"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />

      {serie.map((p, i) => (
        <text
          key={p.mes}
          x={x(i)}
          y={altura - 6}
          textAnchor="middle"
          fontSize="10"
          fontFamily="var(--fonte-mono)"
          fill="var(--tinta-suave)"
        >
          {MESES[Number(p.mes.split("-")[1]) - 1]}
        </text>
      ))}
    </svg>
  );
}

/** Barras horizontais — mais legíveis que pizza quando os nomes importam. */
function GraficoBarras({ dados, formatar }) {
  const maximo = Math.max(1, ...dados.map((d) => d.total));
  return (
    <ul className="legenda">
      {dados.map((d, i) => (
        <li key={d.nome} style={{ display: "block", padding: "10px 0" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 6,
            }}
          >
            <span
              className="bolinha"
              style={{ background: CORES[i % CORES.length] }}
            />
            <span style={{ flex: 1 }}>{d.nome}</span>
            <span
              className="mono"
              style={{ fontSize: 13, color: "var(--tinta-suave)" }}
            >
              {d.quantidade}× · {formatar(d.total)}
            </span>
          </div>
          <div
            style={{
              height: 7,
              background: "var(--creme-baixo)",
              borderRadius: 4,
            }}
          >
            <div
              style={{
                width: `${(d.total / maximo) * 100}%`,
                height: "100%",
                borderRadius: 4,
                background: CORES[i % CORES.length],
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function Financeiro({ tratarErro }) {
  const { fuso } = usePainelConfig();
  const [mes, setMes] = useState(() => mesAtualLocal(fuso));
  const [comparar, setComparar] = useState(() =>
    mesAnterior(mesAtualLocal(fuso)),
  );
  const [dados, setDados] = useState(null);
  const [compararAno, setCompararAno] = useState(false);

  const carregar = useCallback(() => {
    api(`resumo?mes=${mes}&comparar=${comparar}`)
      .then((r) => setDados(r.financeiro))
      .catch(tratarErro);
  }, [mes, comparar, tratarErro]);

  useEffect(carregar, [carregar]);

  if (!dados) return <p>Carregando…</p>;

  const {
    principal,
    comparacao,
    serie,
    serieAnoAnterior,
    porServico,
    porBarbeiro,
    geral,
  } = dados;
  const semMovimento =
    principal.realizado.atendimentos === 0 &&
    principal.previsto.atendimentos === 0 &&
    geral.realizado.atendimentos === 0 &&
    geral.previsto.atendimentos === 0;

  return (
    <>
      <div className="conteudo-topo">
        <div>
          <h1>Financeiro</h1>
          <p>
            Veja o que a barbearia já recebeu neste mês e o que ainda vai
            receber dos agendamentos confirmados. Agendamentos cancelados não
            entram na conta.
          </p>
        </div>
      </div>

      {semMovimento ? (
        <Vazio titulo="Ainda não há movimento para somar">
          Assim que os primeiros atendimentos entrarem, o faturamento aparece
          aqui, mês a mês.
        </Vazio>
      ) : (
        <>
          <section className="bloco">
            <div className="agenda-filtros" style={{ marginBottom: 20 }}>
              <label className="campo" style={{ margin: 0 }}>
                <span>Mês</span>
                <input
                  type="month"
                  className="entrada mono"
                  value={mes}
                  onChange={(e) => setMes(e.target.value)}
                />
              </label>
              <label className="campo" style={{ margin: 0 }}>
                <span>Comparar com</span>
                <input
                  type="month"
                  className="entrada mono"
                  value={comparar}
                  onChange={(e) => setComparar(e.target.value)}
                />
              </label>
            </div>

            <span className="sobrenome">
              Já recebido — atendimentos que já aconteceram
            </span>
            <div className="cartoes" style={{ marginBottom: 20 }}>
              <div className="cartao">
                <div className="rotulo">Total recebido</div>
                <div className="numero" style={{ fontSize: 30 }}>
                  {moeda(principal.realizado.faturamento)}
                </div>
                <Variacao
                  atual={principal.realizado.faturamento}
                  anterior={comparacao.realizado.faturamento}
                  formatar={moeda}
                />
              </div>
              <div className="cartao">
                <div className="rotulo">Atendimentos feitos</div>
                <div className="numero">{principal.realizado.atendimentos}</div>
                <Variacao
                  atual={principal.realizado.atendimentos}
                  anterior={comparacao.realizado.atendimentos}
                  formatar={(v) => String(v)}
                />
              </div>
              <div className="cartao">
                <div className="rotulo">Valor médio por atendimento</div>
                <div className="numero" style={{ fontSize: 30 }}>
                  {moeda(principal.realizado.ticket)}
                </div>
                <Variacao
                  atual={principal.realizado.ticket}
                  anterior={comparacao.realizado.ticket}
                  formatar={moeda}
                />
              </div>
            </div>

            <span className="sobrenome">
              A receber — agendamentos que ainda vão acontecer
            </span>
            <div className="cartoes" style={{ marginBottom: 0 }}>
              <div className="cartao">
                <div className="rotulo">Total a receber</div>
                <div className="numero" style={{ fontSize: 30 }}>
                  {moeda(principal.previsto.faturamento)}
                </div>
                <Variacao
                  atual={principal.previsto.faturamento}
                  anterior={comparacao.previsto.faturamento}
                  formatar={moeda}
                />
              </div>
              <div className="cartao">
                <div className="rotulo">Atendimentos agendados</div>
                <div className="numero">{principal.previsto.atendimentos}</div>
                <Variacao
                  atual={principal.previsto.atendimentos}
                  anterior={comparacao.previsto.atendimentos}
                  formatar={(v) => String(v)}
                />
              </div>
              <div className="cartao">
                <div className="rotulo">Cancelados nesse mês</div>
                <div className="numero">{principal.cancelados}</div>
              </div>
            </div>
          </section>

          <section className="bloco">
            <div className="bloco-titulo" style={{ marginBottom: 4 }}>
              <div>
                <h2 style={{ marginBottom: 2 }}>
                  Movimento dos últimos 12 meses
                </h2>
                <p
                  style={{
                    margin: 0,
                    fontSize: 13.5,
                    color: "var(--tinta-suave)",
                  }}
                >
                  Recebido + a receber somados por mês (mesma definição dos
                  cartões acima, só que combinados aqui num único valor).
                </p>
              </div>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 13.5,
                  color: "var(--tinta-suave)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={compararAno}
                  onChange={(e) => setCompararAno(e.target.checked)}
                />
                Comparar com o ano anterior
              </label>
            </div>
            {compararAno ? (
              <div
                style={{
                  display: "flex",
                  gap: 16,
                  marginBottom: 12,
                  fontSize: 12.5,
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span
                    style={{
                      width: 14,
                      height: 2,
                      background: "var(--dourado)",
                      display: "inline-block",
                    }}
                  />
                  Últimos 12 meses
                </span>
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    color: "var(--tinta-suave)",
                  }}
                >
                  <span
                    style={{
                      width: 14,
                      height: 0,
                      borderTop: "2px dashed var(--tinta-suave)",
                      display: "inline-block",
                    }}
                  />
                  Mesmo período, ano anterior
                </span>
              </div>
            ) : null}
            <GraficoLinha
              serie={serie}
              serieAnoAnterior={compararAno ? serieAnoAnterior : null}
            />
          </section>

          <div className="duas-colunas">
            <section className="bloco">
              <h2>Serviços mais feitos em {rotuloMes(mes)}</h2>
              {porServico.length === 0 ? (
                <Vazio titulo="Nenhum atendimento nesse mês">
                  Escolha outro mês no filtro acima.
                </Vazio>
              ) : (
                <GraficoBarras dados={porServico} formatar={moeda} />
              )}
            </section>

            <section className="bloco">
              <h2>Por profissional em {rotuloMes(mes)}</h2>
              {porBarbeiro.length === 0 ? (
                <Vazio titulo="Nenhum atendimento nesse mês">
                  Escolha outro mês no filtro acima.
                </Vazio>
              ) : (
                <GraficoBarras dados={porBarbeiro} formatar={moeda} />
              )}
            </section>
          </div>

          <section className="bloco">
            <h2 style={{ marginBottom: 2 }}>Total desde a abertura</h2>
            <p
              style={{
                marginTop: 0,
                marginBottom: 18,
                fontSize: 13.5,
                color: "var(--tinta-suave)",
              }}
            >
              A soma de tudo, desde o primeiro agendamento — sem filtro de mês.
            </p>
            <div className="resumo-total">
              <div className="resumo-total-item">
                <span className="resumo-total-rotulo">Total recebido</span>
                <span className="resumo-total-valor">
                  {moeda(geral.realizado.faturamento)}
                </span>
              </div>
              <div className="resumo-total-item">
                <span className="resumo-total-rotulo">Atendimentos feitos</span>
                <span className="resumo-total-valor">
                  {geral.realizado.atendimentos}
                </span>
              </div>
              <div className="resumo-total-item">
                <span className="resumo-total-rotulo">
                  Valor médio por atendimento
                </span>
                <span className="resumo-total-valor">
                  {moeda(geral.realizado.ticket)}
                </span>
              </div>
              <div className="resumo-total-item">
                <span className="resumo-total-rotulo">Total a receber</span>
                <span className="resumo-total-valor">
                  {moeda(geral.previsto.faturamento)}
                </span>
              </div>
              <div className="resumo-total-item">
                <span className="resumo-total-rotulo">
                  Atendimentos agendados
                </span>
                <span className="resumo-total-valor">
                  {geral.previsto.atendimentos}
                </span>
              </div>
            </div>
          </section>
        </>
      )}
    </>
  );
}
