'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, Vazio } from './base';
import { moeda } from '@/lib/format';

const MESES = [
  'jan', 'fev', 'mar', 'abr', 'mai', 'jun',
  'jul', 'ago', 'set', 'out', 'nov', 'dez',
];

const CORES = [
  'var(--dourado)',
  'var(--verde-700)',
  'var(--marrom-500)',
  'var(--verde-300)',
  'var(--marrom-300)',
  'var(--dourado-escuro)',
  'var(--verde-500)',
  'var(--marrom-700)',
];

function mesAtual() {
  return new Date().toISOString().slice(0, 7);
}

function mesAnterior(mes) {
  const [a, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function rotuloMes(mes) {
  const [a, m] = mes.split('-').map(Number);
  return `${MESES[m - 1]}/${String(a).slice(2)}`;
}

/** Variação percentual entre dois números, tolerando divisão por zero. */
function variacao(atual, anterior) {
  if (!anterior) return atual ? { texto: 'novo', sinal: 1 } : null;
  const pct = Math.round(((atual - anterior) / anterior) * 100);
  return { texto: `${pct > 0 ? '+' : ''}${pct}%`, sinal: Math.sign(pct) };
}

function Variacao({ atual, anterior, formatar }) {
  const v = variacao(atual, anterior);
  const cor = !v ? 'var(--tinta-suave)' : v.sinal >= 0 ? 'var(--verde-500)' : 'var(--erro)';
  return (
    <div className="nota">
      <span className="mono">{formatar(anterior)}</span>{' '}
      {v ? (
        <strong className="mono" style={{ color: cor }}>
          {v.texto}
        </strong>
      ) : null}
    </div>
  );
}

/** Gráfico de linha dos 12 meses, desenhado à mão em SVG. */
function GraficoLinha({ serie }) {
  const largura = 620;
  const altura = 200;
  const margem = { topo: 14, base: 26, esquerda: 54, direita: 10 };
  const maximo = Math.max(1, ...serie.map((p) => p.total));

  const x = (i) =>
    margem.esquerda +
    (i * (largura - margem.esquerda - margem.direita)) / Math.max(1, serie.length - 1);
  const y = (v) =>
    altura - margem.base - (v / maximo) * (altura - margem.topo - margem.base);

  const linha = serie.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.total)}`).join(' ');
  const area = `${linha} L ${x(serie.length - 1)} ${altura - margem.base} L ${x(0)} ${
    altura - margem.base
  } Z`;

  return (
    <svg className="grafico" viewBox={`0 0 ${largura} ${altura}`} role="img" aria-label="Faturamento por mês">
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
            {moeda(maximo * f).replace(',00', '')}
          </text>
        </g>
      ))}

      <path d={area} fill="var(--dourado)" opacity="0.14" />
      <path d={linha} fill="none" stroke="var(--dourado)" strokeWidth="2.5" strokeLinejoin="round" />

      {serie.map((p, i) => (
        <text
          key={p.mes}
          x={x(i)}
          y={altura - 8}
          textAnchor="middle"
          fontSize="10"
          fontFamily="var(--fonte-mono)"
          fill="var(--tinta-suave)"
        >
          {MESES[Number(p.mes.split('-')[1]) - 1]}
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
        <li key={d.nome} style={{ display: 'block', padding: '10px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span className="bolinha" style={{ background: CORES[i % CORES.length] }} />
            <span style={{ flex: 1 }}>{d.nome}</span>
            <span className="mono" style={{ fontSize: 13, color: 'var(--tinta-suave)' }}>
              {d.quantidade}× · {formatar(d.total)}
            </span>
          </div>
          <div style={{ height: 7, background: 'var(--creme-baixo)', borderRadius: 4 }}>
            <div
              style={{
                width: `${(d.total / maximo) * 100}%`,
                height: '100%',
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
  const [mes, setMes] = useState(mesAtual);
  const [comparar, setComparar] = useState(() => mesAnterior(mesAtual()));
  const [dados, setDados] = useState(null);

  const carregar = useCallback(() => {
    api(`resumo?mes=${mes}&comparar=${comparar}`)
      .then((r) => setDados(r.financeiro))
      .catch(tratarErro);
  }, [mes, comparar, tratarErro]);

  useEffect(carregar, [carregar]);

  if (!dados) return <p>Carregando…</p>;

  const { principal, comparacao, serie, porServico, porBarbeiro, geral } = dados;
  const semMovimento = principal.atendimentos === 0 && geral.atendimentos === 0;

  return (
    <>
      <div className="conteudo-topo">
        <div>
          <h1>Financeiro</h1>
          <p>Só entram atendimentos não cancelados, pelo preço do serviço na hora da marcação.</p>
        </div>
      </div>

      {semMovimento ? (
        <Vazio titulo="Ainda não há movimento para somar">
          Assim que os primeiros atendimentos entrarem, o faturamento aparece aqui, mês a mês.
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

            <div className="cartoes" style={{ marginBottom: 0 }}>
              <div className="cartao">
                <div className="rotulo">Faturamento</div>
                <div className="numero" style={{ fontSize: 30 }}>
                  {moeda(principal.faturamento)}
                </div>
                <Variacao
                  atual={principal.faturamento}
                  anterior={comparacao.faturamento}
                  formatar={moeda}
                />
              </div>
              <div className="cartao">
                <div className="rotulo">Atendimentos</div>
                <div className="numero">{principal.atendimentos}</div>
                <Variacao
                  atual={principal.atendimentos}
                  anterior={comparacao.atendimentos}
                  formatar={(v) => String(v)}
                />
              </div>
              <div className="cartao">
                <div className="rotulo">Ticket médio</div>
                <div className="numero" style={{ fontSize: 30 }}>
                  {moeda(principal.ticket)}
                </div>
                <Variacao atual={principal.ticket} anterior={comparacao.ticket} formatar={moeda} />
              </div>
              <div className="cartao">
                <div className="rotulo">Cancelamentos</div>
                <div className="numero">{principal.cancelados}</div>
                <div className="nota">no mês escolhido</div>
              </div>
            </div>
          </section>

          <section className="bloco">
            <h2>Faturamento dos últimos 12 meses</h2>
            <GraficoLinha serie={serie} />
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
            <h2>Desde o começo</h2>
            <div className="cartoes" style={{ marginBottom: 0 }}>
              <div className="cartao">
                <div className="rotulo">Faturamento total</div>
                <div className="numero" style={{ fontSize: 30 }}>
                  {moeda(geral.faturamento)}
                </div>
              </div>
              <div className="cartao">
                <div className="rotulo">Atendimentos</div>
                <div className="numero">{geral.atendimentos}</div>
              </div>
              <div className="cartao">
                <div className="rotulo">Ticket médio</div>
                <div className="numero" style={{ fontSize: 30 }}>
                  {moeda(geral.ticket)}
                </div>
              </div>
            </div>
          </section>
        </>
      )}
    </>
  );
}
