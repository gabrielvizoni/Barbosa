'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, Vazio } from './base';
import { iniciais, mascararTelefone, moeda } from '@/lib/format';

/** Gera a régua de horas que cobre o dia de trabalho mostrado. */
function faixaDeHoras(agendamentos) {
  let inicio = 8;
  let fim = 20;
  for (const a of agendamentos) {
    inicio = Math.min(inicio, Number(a.inicio.slice(0, 2)));
    fim = Math.max(fim, Math.ceil(Number(a.fim.slice(0, 2)) + (a.fim.slice(3) === '00' ? 0 : 1)));
  }
  return Array.from({ length: Math.max(1, fim - inicio) }, (_, i) => inicio + i);
}

export default function AgendaVisual({ tratarErro }) {
  const [barbeiros, setBarbeiros] = useState([]);
  const [barbeiroId, setBarbeiroId] = useState(null);
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10));
  const [agendamentos, setAgendamentos] = useState([]);

  useEffect(() => {
    api('barbeiros')
      .then((r) => {
        const ativos = r.itens.filter((b) => b.ativo);
        setBarbeiros(ativos);
        if (ativos.length) setBarbeiroId(ativos[0].id);
      })
      .catch(tratarErro);
  }, [tratarErro]);

  const carregar = useCallback(() => {
    if (!barbeiroId) return;
    api(`agendamentos?barbeiro=${barbeiroId}&data=${data}`)
      .then((r) => setAgendamentos(r.itens.filter((a) => a.status !== 'cancelado')))
      .catch(tratarErro);
  }, [barbeiroId, data, tratarErro]);

  useEffect(carregar, [carregar]);

  const barbeiro = barbeiros.find((b) => b.id === barbeiroId);
  const horas = faixaDeHoras(agendamentos);

  return (
    <>
      <div className="conteudo-topo">
        <div>
          <h1>Agenda do dia</h1>
          <p>Como o dia está montado, hora a hora.</p>
        </div>
      </div>

      <div className="agenda-filtros">
        {barbeiros.map((b) => (
          <button
            key={b.id}
            className={`pilula ${b.id === barbeiroId ? 'ativa' : ''}`}
            onClick={() => setBarbeiroId(b.id)}
          >
            {b.foto ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img className="avatar-mini" src={b.foto} alt="" style={{ width: 24, height: 24 }} />
            ) : (
              <span className="avatar-mini" style={{ width: 24, height: 24, fontSize: 11 }}>
                {iniciais(b.nome)}
              </span>
            )}
            {b.nome.split(' ')[0]}
          </button>
        ))}
        <input
          type="date"
          className="entrada mono"
          style={{ width: 'auto' }}
          value={data}
          onChange={(e) => setData(e.target.value)}
        />
      </div>

      <section className="bloco">
        {!barbeiro ? (
          <Vazio titulo="Nenhum profissional ativo">
            Cadastre a equipe em Profissionais para ver a agenda.
          </Vazio>
        ) : (
          <>
            <div className="bloco-titulo">
              <div>
                <h2 style={{ marginBottom: 2 }}>{barbeiro.nome}</h2>
                <p style={{ margin: 0, color: 'var(--tinta-suave)', fontSize: 14 }}>
                  {agendamentos.length} atendimento(s) no dia
                </p>
              </div>
            </div>

            <div className="faixa-horaria">
              {horas.map((hora) => {
                const daHora = agendamentos.filter(
                  (a) => Number(a.inicio.slice(0, 2)) === hora
                );
                return (
                  <div key={hora} style={{ display: 'contents' }}>
                    <div className="faixa-hora">{String(hora).padStart(2, '0')}:00</div>
                    <div className="faixa-conteudo">
                      {daHora.map((a) => (
                        <div
                          key={a.id}
                          className={`cartao-agenda ${a.status === 'pendente' ? 'pendente' : ''}`}
                        >
                          <strong>{a.cliente_nome}</strong>
                          <span className="detalhe">
                            {a.inicio}–{a.fim} · {a.servico_nome} · {moeda(a.preco_centavos)}
                          </span>
                          <span className="detalhe">
                            {mascararTelefone(a.cliente_telefone)}
                          </span>
                          {a.observacoes ? (
                            <span className="detalhe">Obs: {a.observacoes}</span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {agendamentos.length === 0 ? (
              <p
                style={{
                  marginTop: 18,
                  textAlign: 'center',
                  color: 'var(--tinta-suave)',
                  fontSize: 14.5,
                }}
              >
                Dia livre para {barbeiro.nome.split(' ')[0]}.
              </p>
            ) : null}
          </>
        )}
      </section>
    </>
  );
}
