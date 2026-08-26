"use client";

import { useCallback, useEffect, useState } from "react";
import { api, SeletorData, Vazio } from "./base";
import { iniciais, mascararTelefone, moeda } from "@/lib/format";
import { hojeLocal } from "@/lib/datas-cliente";
import { usePainelConfig } from "./ConfigContext";

function paraMinutos(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Gera a régua de meia em meia hora que cobre o dia de trabalho mostrado,
 * pra um agendamento de 9h30 não parecer ocupar a hora inteira das 9h. */
function faixaDeMeiaHora(agendamentos) {
  let inicio = 8 * 60;
  let fim = 20 * 60;
  for (const a of agendamentos) {
    inicio = Math.min(inicio, paraMinutos(a.inicio));
    fim = Math.max(fim, paraMinutos(a.fim));
  }
  inicio = Math.floor(inicio / 30) * 30;
  fim = Math.ceil(fim / 30) * 30;
  const slots = [];
  for (let m = inicio; m < fim; m += 30) slots.push(m);
  return slots;
}

/** O dia visto por profissional, hora a hora — um jeito rápido de ver como
 * a agenda está montada, sem precisar ler a lista inteira. Usado dentro da
 * tela de Agendamentos, ao lado da visão em lista. */
export default function AgendaVisual({ barbeiros, tratarErro }) {
  const { fuso } = usePainelConfig();
  const [barbeiroId, setBarbeiroId] = useState(null);
  const [data, setData] = useState(() => hojeLocal(fuso));
  const [agendamentos, setAgendamentos] = useState([]);

  useEffect(() => {
    if (barbeiroId || barbeiros.length === 0) return;
    setBarbeiroId(barbeiros[0].id);
  }, [barbeiros, barbeiroId]);

  const carregar = useCallback(() => {
    if (!barbeiroId) return;
    api(`agendamentos?barbeiro=${barbeiroId}&data=${data}`)
      .then((r) =>
        setAgendamentos(r.itens.filter((a) => a.status !== "cancelado")),
      )
      .catch(tratarErro);
  }, [barbeiroId, data, tratarErro]);

  useEffect(carregar, [carregar]);

  const barbeiro = barbeiros.find((b) => b.id === barbeiroId);
  const slots = faixaDeMeiaHora(agendamentos);

  return (
    <>
      <div className="agenda-filtros">
        {barbeiros.map((b) => (
          <button
            key={b.id}
            className={`pilula ${b.id === barbeiroId ? "ativa" : ""}`}
            onClick={() => setBarbeiroId(b.id)}
          >
            {b.foto ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                className="avatar-mini"
                src={b.foto}
                alt=""
                style={{ width: 24, height: 24 }}
              />
            ) : (
              <span
                className="avatar-mini"
                style={{ width: 24, height: 24, fontSize: 11 }}
              >
                {iniciais(b.nome)}
              </span>
            )}
            {b.nome.split(" ")[0]}
          </button>
        ))}
        <SeletorData
          value={data}
          onChange={(v) => setData(v || hojeLocal(fuso))}
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
                <p
                  style={{
                    margin: 0,
                    color: "var(--tinta-suave)",
                    fontSize: 14,
                  }}
                >
                  {agendamentos.length} atendimento(s) no dia
                </p>
              </div>
            </div>

            <div className="faixa-horaria">
              {slots.map((min) => {
                const cheia = min % 60 === 0;
                const daSlot = agendamentos.filter(
                  (a) => Math.floor(paraMinutos(a.inicio) / 30) * 30 === min,
                );
                return (
                  <div key={min} style={{ display: "contents" }}>
                    <div
                      className={`faixa-hora ${cheia ? "" : "faixa-hora-meia"}`}
                    >
                      {cheia
                        ? `${String(Math.floor(min / 60)).padStart(2, "0")}:00`
                        : ""}
                    </div>
                    <div
                      className={`faixa-conteudo ${cheia ? "" : "faixa-conteudo-meia"}`}
                    >
                      {daSlot.map((a) => (
                        <div
                          key={a.id}
                          className={`cartao-agenda ${a.status === "pendente" ? "pendente" : ""}`}
                        >
                          <strong>{a.cliente_nome}</strong>
                          <span className="detalhe">
                            {a.inicio}–{a.fim} · {a.servico_nome} ·{" "}
                            {moeda(a.preco_centavos)}
                          </span>
                          <span className="detalhe">
                            {mascararTelefone(a.cliente_telefone)}
                          </span>
                          {a.observacoes ? (
                            <span className="detalhe">
                              Obs: {a.observacoes}
                            </span>
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
                  textAlign: "center",
                  color: "var(--tinta-suave)",
                  fontSize: 14.5,
                }}
              >
                Dia livre para {barbeiro.nome.split(" ")[0]}.
              </p>
            ) : null}
          </>
        )}
      </section>
    </>
  );
}
