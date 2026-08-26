"use client";

import { useCallback, useEffect, useState } from "react";
import { api, Modal, ModalConfirmacao, Vazio } from "./base";
import { dataBr, linkAvisoBloqueio } from "@/lib/format";
import { hojeLocal } from "@/lib/datas-cliente";
import { usePainelConfig } from "./ConfigContext";
import { Lixeira, Mais, Pausa, Zap } from "@/components/Icones";

const NOMES = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
];

function agoraArredondado() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - (d.getMinutes() % 5));
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function somarHoras(hhmm, horas) {
  const [h, m] = hhmm.split(":").map(Number);
  const total = Math.min(23 * 60 + 59, h * 60 + m + horas * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Ponto de partida do formulário de bloqueio — precisa ser função, chamada
 * no momento de abrir o modal, e não uma constante de módulo: um painel
 * deixado aberto o dia inteiro (o normal numa barbearia) senão pré-preenche
 * o formulário com a data e a hora de quando a aba foi carregada, não de
 * agora.
 */
function bloqueioVazio(fuso) {
  const inicio = agoraArredondado();
  return {
    barbeiro_id: "",
    data: hojeLocal(fuso),
    inicio,
    fim: somarHoras(inicio, 1),
    motivo: "",
  };
}

export default function Horarios({ avisar, tratarErro, aoAlterar }) {
  const { fuso, nome } = usePainelConfig();
  const [expediente, setExpediente] = useState([]);
  const [expedienteOriginal, setExpedienteOriginal] = useState([]);
  const [bloqueios, setBloqueios] = useState([]);
  const [barbeiros, setBarbeiros] = useState([]);
  const [editando, setEditando] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [bloqueando, setBloqueando] = useState(false);
  const [aviso, setAviso] = useState(null); // clientes atropelados pelo último bloqueio, ou null
  const [confirmandoFechar, setConfirmandoFechar] = useState(false);
  const [liberando, setLiberando] = useState(null); // bloqueio em confirmação de liberação, ou null

  const carregar = useCallback(() => {
    api("config")
      .then((r) => {
        setExpediente(r.expediente);
        setExpedienteOriginal(r.expediente);
      })
      .catch(tratarErro);
    api("bloqueios")
      .then((r) => setBloqueios(r.itens))
      .catch(tratarErro);
    api("barbeiros")
      .then((r) => setBarbeiros(r.itens.filter((b) => b.ativo)))
      .catch(tratarErro);
  }, [tratarErro]);

  useEffect(carregar, [carregar]);

  // Editar o expediente e trocar de tela sem salvar descartava tudo em
  // silêncio — agora o painel avisa antes de sair (ver PainelAdmin.jsx).
  useEffect(() => {
    aoAlterar?.(JSON.stringify(expediente) !== JSON.stringify(expedienteOriginal));
  }, [expediente, expedienteOriginal, aoAlterar]);

  function mudarDia(dia, campo, valor) {
    setExpediente((atual) =>
      atual.map((d) => (d.dia === dia ? { ...d, [campo]: valor } : d)),
    );
  }

  async function salvarExpediente() {
    setSalvando(true);
    try {
      await api("config", { method: "PUT", body: { expediente } });
      setExpedienteOriginal(expediente);
      avisar("Expediente salvo.");
    } catch (erro) {
      tratarErro(erro);
    } finally {
      setSalvando(false);
    }
  }

  /**
   * Bloquear não cancela quem já tinha marcado nesse intervalo — os
   * agendamentos continuam de pé. Quando a resposta traz atropelados, mostra
   * quem avisar em vez do toast genérico (item 4 da Etapa 8 da auditoria):
   * antes disso só havia um texto estático no modal, e os atalhos "Saí por
   * 1h/2h" e "Fechar o resto do dia" não avisavam nada.
   */
  async function criarBloqueio(dados) {
    if (bloqueando) return;
    setBloqueando(true);
    try {
      const r = await api("bloqueios", {
        method: "POST",
        body: { ...dados, barbeiro_id: dados.barbeiro_id || null },
      });
      setEditando(null);
      carregar();
      if (r.atropelados?.length > 0) {
        setAviso(r.atropelados);
      } else {
        avisar("Horário bloqueado. Ele some do agendamento na hora.");
      }
    } catch (erro) {
      tratarErro(erro);
    } finally {
      setBloqueando(false);
    }
  }

  /** Atalhos para quando a saída é agora — sem preencher formulário. */
  async function sairAgora(horas) {
    const inicio = agoraArredondado();
    await criarBloqueio({
      barbeiro_id: "",
      data: hojeLocal(fuso),
      inicio,
      fim: somarHoras(inicio, horas),
      motivo: `Saída de ${horas}h`,
    });
  }

  // A ação mais destrutiva do painel — um clique fecha a agenda de toda a
  // equipe — e era a única sem nenhuma confirmação.
  async function confirmarFecharRestoDoDia() {
    setConfirmandoFechar(false);
    const inicio = agoraArredondado();
    await criarBloqueio({
      barbeiro_id: "",
      data: hojeLocal(fuso),
      inicio,
      fim: "23:59",
      motivo: "Fechado pelo resto do dia",
    });
  }

  async function confirmarLiberarBloqueio() {
    const b = liberando;
    try {
      await api(`bloqueios/${b.id}`, { method: "DELETE" });
      setLiberando(null);
      carregar();
      avisar("Horário liberado.");
    } catch (erro) {
      tratarErro(erro);
    }
  }

  return (
    <>
      <div className="conteudo-topo">
        <div>
          <h1>Horários e folgas</h1>
          <p>
            O expediente da semana e os momentos em que a agenda fica fechada.
          </p>
        </div>
        <button
          className="btn btn-ouro"
          onClick={() => setEditando(bloqueioVazio(fuso))}
        >
          <Mais /> Bloquear horário
        </button>
      </div>

      <section className="bloco">
        <div className="bloco-titulo">
          <div>
            <h2 style={{ marginBottom: 2 }}>Preciso sair agora</h2>
            <p style={{ margin: 0, color: "var(--tinta-suave)", fontSize: 14 }}>
              Um clique fecha a agenda a partir deste minuto, para toda a
              equipe.
            </p>
          </div>
        </div>
        <div className="agenda-filtros" style={{ marginBottom: 0 }}>
          <button
            className="btn btn-contorno"
            onClick={() => sairAgora(1)}
            disabled={bloqueando}
          >
            <Pausa width={16} height={16} /> Saí por 1 hora
          </button>
          <button
            className="btn btn-contorno"
            onClick={() => sairAgora(2)}
            disabled={bloqueando}
          >
            <Pausa width={16} height={16} /> Saí por 2 horas
          </button>
          <button
            className="btn btn-contorno"
            onClick={() => setConfirmandoFechar(true)}
            disabled={bloqueando}
          >
            <Pausa width={16} height={16} /> Fechar o resto do dia
          </button>
        </div>
      </section>

      <div className="duas-colunas">
        <section className="bloco">
          <h2>Expediente da semana</h2>
          {expediente.map((d) => (
            <div className="linha-dia" key={d.dia}>
              <label
                className="caixa"
                style={{
                  border: "none",
                  background: "transparent",
                  padding: 0,
                }}
              >
                <input
                  type="checkbox"
                  checked={!!d.aberto}
                  onChange={(e) =>
                    mudarDia(d.dia, "aberto", e.target.checked ? 1 : 0)
                  }
                />
                {NOMES[d.dia]}
              </label>
              {d.aberto ? (
                <div className="horas-dia">
                  <input
                    type="time"
                    className="entrada mono"
                    value={d.abre}
                    onChange={(e) => mudarDia(d.dia, "abre", e.target.value)}
                  />
                  <span>até</span>
                  <input
                    type="time"
                    className="entrada mono"
                    value={d.fecha}
                    onChange={(e) => mudarDia(d.dia, "fecha", e.target.value)}
                  />
                </div>
              ) : (
                <span style={{ color: "var(--tinta-suave)", fontSize: 14 }}>
                  Fechado
                </span>
              )}
            </div>
          ))}
          <button
            className="btn btn-verde"
            style={{ marginTop: 18 }}
            onClick={salvarExpediente}
            disabled={salvando}
          >
            {salvando ? "Salvando…" : "Salvar expediente"}
          </button>
        </section>

        <section className="bloco">
          <h2>Horários bloqueados</h2>
          {bloqueios.length === 0 ? (
            <Vazio titulo="Nada bloqueado">
              Quando você precisar sair, o bloqueio aparece aqui e o horário
              some do site.
            </Vazio>
          ) : (
            <div className="tabela-rolagem">
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Intervalo</th>
                    <th>Quem</th>
                    <th>Motivo</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {bloqueios.map((b) => (
                    <tr key={b.id}>
                      <td className="mono" style={{ fontSize: 13 }}>
                        {dataBr(b.data)}
                      </td>
                      <td className="mono" style={{ fontSize: 13 }}>
                        {b.inicio}–{b.fim}
                      </td>
                      <td>{b.barbeiro_nome || "Toda a equipe"}</td>
                      <td
                        style={{ fontSize: 13.5, color: "var(--tinta-suave)" }}
                      >
                        {b.motivo}
                      </td>
                      <td>
                        <button
                          className="icone-btn perigo"
                          onClick={() => setLiberando(b)}
                          title="Liberar"
                        >
                          <Lixeira width={15} height={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {editando ? (
        <Modal
          titulo="Bloquear horário"
          aoFechar={() => setEditando(null)}
          rodape={
            <>
              <button
                className="btn btn-contorno"
                onClick={() => setEditando(null)}
              >
                Cancelar
              </button>
              <button
                className="btn btn-ouro"
                onClick={() => criarBloqueio(editando)}
                disabled={bloqueando}
              >
                {bloqueando ? "Bloqueando…" : "Bloquear"}
              </button>
            </>
          }
        >
          <label className="campo">
            <span>Quem fica indisponível</span>
            <select
              className="entrada"
              value={editando.barbeiro_id}
              onChange={(e) =>
                setEditando({ ...editando, barbeiro_id: e.target.value })
              }
            >
              <option value="">Toda a equipe</option>
              {barbeiros.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nome}
                </option>
              ))}
            </select>
          </label>

          <div className="linha-campos">
            <label className="campo">
              <span>Data</span>
              <input
                type="date"
                className="entrada mono"
                value={editando.data}
                onChange={(e) =>
                  setEditando({ ...editando, data: e.target.value })
                }
              />
            </label>
            <label className="campo">
              <span>Das</span>
              <input
                type="time"
                className="entrada mono"
                value={editando.inicio}
                onChange={(e) =>
                  setEditando({ ...editando, inicio: e.target.value })
                }
              />
            </label>
            <label className="campo">
              <span>Até</span>
              <input
                type="time"
                className="entrada mono"
                value={editando.fim}
                onChange={(e) =>
                  setEditando({ ...editando, fim: e.target.value })
                }
              />
            </label>
          </div>

          <label className="campo">
            <span>Motivo (só você vê)</span>
            <input
              className="entrada"
              value={editando.motivo}
              onChange={(e) =>
                setEditando({ ...editando, motivo: e.target.value })
              }
              placeholder="Ex: almoço, médico, entrega"
            />
          </label>

          <div className="aviso" style={{ marginBottom: 0 }}>
            Agendamentos já marcados nesse intervalo continuam de pé —
            cancele-os na tela de Agendamentos se precisar.
          </div>
        </Modal>
      ) : null}

      {confirmandoFechar ? (
        <ModalConfirmacao
          titulo="Fechar o resto do dia"
          mensagem="Isso fecha a agenda de toda a equipe a partir de agora até o fim do dia. Continuar?"
          confirmarLabel={bloqueando ? "Fechando…" : "Fechar o resto do dia"}
          perigo
          confirmando={bloqueando}
          aoConfirmar={confirmarFecharRestoDoDia}
          aoFechar={() => setConfirmandoFechar(false)}
        />
      ) : null}

      {liberando ? (
        <ModalConfirmacao
          titulo="Liberar horário"
          mensagem="Liberar esse horário de volta para agendamento?"
          confirmarLabel="Liberar"
          aoConfirmar={confirmarLiberarBloqueio}
          aoFechar={() => setLiberando(null)}
        />
      ) : null}

      {aviso ? (
        <Modal
          titulo="Bloqueado — atenção aos clientes já marcados"
          aoFechar={() => setAviso(null)}
          rodape={
            <button className="btn btn-ouro" onClick={() => setAviso(null)}>
              Entendi
            </button>
          }
        >
          <p style={{ marginTop: 0 }}>
            {aviso.length === 1
              ? "1 cliente já estava marcado nesse intervalo."
              : `${aviso.length} clientes já estavam marcados nesse intervalo.`}{" "}
            O agendamento continua de pé — avise cada um para remarcar:
          </p>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {aviso.map((a) => (
              <li
                key={a.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "9px 0",
                  borderBottom: "1px solid var(--linha)",
                }}
              >
                <span>
                  <strong>{a.cliente_nome}</strong> — {dataBr(a.data)} às{" "}
                  {a.inicio}
                </span>
                {linkAvisoBloqueio(nome, a) ? (
                  <a
                    className="btn btn-contorno btn-mini"
                    href={linkAvisoBloqueio(nome, a)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    WhatsApp
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </Modal>
      ) : null}
    </>
  );
}
