"use client";

import { useCallback, useEffect, useState } from "react";
import { api, Etiqueta, Modal, Vazio } from "./base";
import { dataBr, mascararTelefone, moeda } from "@/lib/format";

export default function Clientes({ tratarErro }) {
  const [itens, setItens] = useState([]);
  const [busca, setBusca] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [ficha, setFicha] = useState(null); // { cliente, agendamentos, metricas } ou null
  const [carregandoFicha, setCarregandoFicha] = useState(false);

  const carregar = useCallback(() => {
    setCarregando(true);
    api(`clientes?busca=${encodeURIComponent(busca)}`)
      .then((r) => setItens(r.itens || []))
      .catch(tratarErro)
      .finally(() => setCarregando(false));
  }, [busca, tratarErro]);

  useEffect(() => {
    const t = setTimeout(carregar, busca ? 250 : 0);
    return () => clearTimeout(t);
  }, [carregar, busca]);

  async function abrirFicha(id) {
    setCarregandoFicha(true);
    try {
      const r = await api(`clientes/${id}`);
      setFicha(r);
    } catch (erro) {
      tratarErro(erro);
    } finally {
      setCarregandoFicha(false);
    }
  }

  return (
    <>
      <div className="conteudo-topo">
        <div>
          <h1>Clientes</h1>
          <p>
            Quem tem conta no site. A ficha reúne o histórico, o quanto já
            gastou e se é cliente novo ou recorrente.
          </p>
        </div>
      </div>

      <section className="bloco">
        <label className="campo" style={{ maxWidth: 360 }}>
          <span>Buscar</span>
          <input
            className="entrada"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Nome, e-mail ou telefone"
          />
        </label>

        {carregando ? (
          <p className="painel-ajuda">Carregando…</p>
        ) : itens.length === 0 ? (
          <Vazio titulo="Nenhum cliente">
            {busca
              ? "Nenhum cliente bate com a busca."
              : "Assim que alguém criar uma conta no site, aparece aqui."}
          </Vazio>
        ) : (
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Contato</th>
                  <th>Agendamentos</th>
                  <th>Situação</th>
                  <th>Cliente desde</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => abrirFicha(c.id)}
                    style={{ cursor: "pointer" }}
                  >
                    <td>
                      <strong>{c.nome}</strong>
                    </td>
                    <td style={{ fontSize: 13 }}>
                      <div>{c.email}</div>
                      <div
                        className="mono"
                        style={{ color: "var(--tinta-suave)" }}
                      >
                        {mascararTelefone(c.telefone)}
                      </div>
                    </td>
                    <td className="mono">
                      {c.total_agendamentos}
                      {c.concluidos ? (
                        <span
                          style={{
                            color: "var(--tinta-suave)",
                            fontSize: 12.5,
                          }}
                        >
                          {" "}
                          ({c.concluidos} concl.)
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <span
                        className={`etiqueta ${
                          c.recorrente
                            ? "etiqueta-confirmado"
                            : "etiqueta-neutra"
                        }`}
                      >
                        {c.recorrente ? "Recorrente" : "Novo"}
                      </span>
                    </td>
                    <td className="mono" style={{ fontSize: 13 }}>
                      {dataBr((c.criado_em || "").slice(0, 10))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {carregandoFicha ? (
        <Modal titulo="Carregando…" aoFechar={() => setCarregandoFicha(false)}>
          <p className="painel-ajuda">Buscando a ficha do cliente…</p>
        </Modal>
      ) : null}

      {ficha ? (
        <Modal
          titulo={ficha.cliente.nome}
          aoFechar={() => setFicha(null)}
          rodape={
            <button className="btn btn-ouro" onClick={() => setFicha(null)}>
              Fechar
            </button>
          }
        >
          <div style={{ fontSize: 13.5, marginBottom: 14 }}>
            <div>{ficha.cliente.email}</div>
            <div className="mono" style={{ color: "var(--tinta-suave)" }}>
              {mascararTelefone(ficha.cliente.telefone)}
            </div>
          </div>

          <div className="cartoes" style={{ marginBottom: 16 }}>
            <div className="cartao">
              <div className="rotulo">Total gasto</div>
              <div className="numero" style={{ fontSize: 26 }}>
                {moeda(ficha.metricas.totalGastoCentavos)}
              </div>
              <div className="nota">{ficha.metricas.concluidos} concluídos</div>
            </div>
            <div className="cartao">
              <div className="rotulo">Situação</div>
              <div className="numero" style={{ fontSize: 22 }}>
                {ficha.metricas.recorrente ? "Recorrente" : "Novo"}
              </div>
              <div className="nota">2+ concluídos = recorrente</div>
            </div>
            <div className="cartao">
              <div className="rotulo">Cancelados</div>
              <div className="numero">{ficha.metricas.cancelados}</div>
              <div className="nota">de {ficha.metricas.totalAgendamentos}</div>
            </div>
          </div>

          <p style={{ fontSize: 13.5, color: "var(--tinta-suave)" }}>
            {ficha.metricas.servicoMaisFrequente
              ? `Serviço mais frequente: ${ficha.metricas.servicoMaisFrequente}. `
              : ""}
            {ficha.metricas.primeiraVisita
              ? `Primeira visita em ${dataBr(ficha.metricas.primeiraVisita)}, última em ${dataBr(ficha.metricas.ultimaVisita)}.`
              : "Ainda sem atendimentos."}
          </p>

          <h3 style={{ margin: "18px 0 8px", fontSize: 15 }}>Histórico</h3>
          {ficha.agendamentos.length === 0 ? (
            <Vazio titulo="Sem agendamentos">
              Este cliente ainda não marcou nenhum horário.
            </Vazio>
          ) : (
            <div className="tabela-rolagem">
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Quando</th>
                    <th>Serviço</th>
                    <th>Profissional</th>
                    <th>Valor</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {ficha.agendamentos.map((a) => (
                    <tr key={a.id}>
                      <td className="mono" style={{ fontSize: 13 }}>
                        {dataBr(a.data)} {a.inicio}
                      </td>
                      <td>{a.servico_nome}</td>
                      <td>{a.barbeiro_nome}</td>
                      <td className="mono">{moeda(a.preco_centavos)}</td>
                      <td>
                        <Etiqueta status={a.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      ) : null}
    </>
  );
}
