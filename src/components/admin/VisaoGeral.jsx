"use client";

import { useEffect, useState } from "react";
import { api, Etiqueta, Vazio } from "./base";
import { moeda, dataBr, iniciais } from "@/lib/format";
import {
  Calendario,
  CheckCirculo,
  Dinheiro,
  Grafico,
  Sino,
} from "@/components/Icones";

const DIAS = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];
const MESES = [
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

function porExtenso(data) {
  if (!data) return "";
  const [a, m, d] = data.split("-").map(Number);
  const semana = new Date(Date.UTC(a, m - 1, d)).getUTCDay();
  const nome = DIAS[semana];
  return `${nome[0].toUpperCase()}${nome.slice(1)}, ${d} de ${MESES[m - 1]} de ${a}`;
}

export default function VisaoGeral({ tratarErro }) {
  const [resumo, setResumo] = useState(null);
  const [config, setConfig] = useState(null);
  const [senhaInicial, setSenhaInicial] = useState(false);
  const [barbeiros, setBarbeiros] = useState(null);
  const [servicos, setServicos] = useState(null);

  useEffect(() => {
    api("resumo").then(setResumo).catch(tratarErro);
    api("config")
      .then((r) => {
        setConfig(r.config);
        setSenhaInicial(!!r.senhaInicial);
      })
      .catch(() => {});
    api("barbeiros")
      .then((r) => setBarbeiros(r.itens))
      .catch(() => {});
    api("servicos")
      .then((r) => setServicos(r.itens))
      .catch(() => {});
  }, [tratarErro]);

  async function marcarExpedienteConferido() {
    try {
      await api("config", {
        method: "PUT",
        body: { config: { onboarding_expediente_ok: "1" } },
      });
      setConfig((c) => ({ ...c, onboarding_expediente_ok: "1" }));
    } catch (erro) {
      tratarErro(erro);
    }
  }

  if (!resumo) return <p>Carregando…</p>;

  const { hoje } = resumo;

  // Checklist de primeiros passos: no dia 1, nada explicava que sem
  // cadastrar serviços o site não aceita agendamento — essa informação
  // ficava só no README, que o cliente não lê. Some da tela sozinho quando
  // os cinco passos estiverem concluídos.
  const passos =
    config && barbeiros && servicos
      ? [
          {
            chave: "senha",
            rotulo: "Defina uma senha própria",
            feito: !senhaInicial,
          },
          {
            chave: "identidade",
            rotulo: "Preencha o nome e o WhatsApp da barbearia",
            feito: !!config.nome_barbearia?.trim() && !!config.whatsapp?.trim(),
          },
          {
            chave: "profissionais",
            rotulo: "Cadastre os profissionais",
            feito: barbeiros.length > 0,
          },
          {
            chave: "servicos",
            rotulo: "Cadastre os serviços e vincule quem executa cada um",
            feito:
              servicos.length > 0 &&
              servicos.every((s) => s.barbeiros.length > 0),
          },
          {
            chave: "expediente",
            rotulo: "Confira o expediente da semana",
            feito: config.onboarding_expediente_ok === "1",
          },
        ]
      : [];
  const concluidos = passos.filter((p) => p.feito).length;
  const tudoPronto = passos.length > 0 && concluidos === passos.length;

  return (
    <>
      <div className="conteudo-topo">
        <div>
          <h1>Visão geral</h1>
          <p>{porExtenso(hoje.data)}</p>
        </div>
      </div>

      {passos.length > 0 && !tudoPronto ? (
        <section className="bloco" style={{ borderColor: "var(--dourado)" }}>
          <h2>Primeiros passos</h2>
          <p
            style={{ marginTop: -6, color: "var(--tinta-suave)", fontSize: 14 }}
          >
            {concluidos} de {passos.length} concluídos — sem cadastrar serviços,
            o site não aceita agendamento.
          </p>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {passos.map((p) => (
              <li
                key={p.chave}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 0",
                  borderBottom: "1px solid rgba(217,201,173,.5)",
                }}
              >
                <CheckCirculo
                  width={17}
                  height={17}
                  aria-hidden="true"
                  style={{
                    flexShrink: 0,
                    color: p.feito ? "var(--verde-500)" : "var(--tinta-suave)",
                    opacity: p.feito ? 1 : 0.35,
                  }}
                />
                <span
                  style={{
                    flex: 1,
                    textDecoration: p.feito ? "line-through" : "none",
                    opacity: p.feito ? 0.65 : 1,
                  }}
                >
                  {p.rotulo}
                </span>
                {p.chave === "expediente" && !p.feito ? (
                  <button
                    className="btn btn-contorno btn-mini"
                    onClick={marcarExpedienteConferido}
                  >
                    Já conferi
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="cartoes">
        <div className="cartao">
          <div className="rotulo">
            Hoje{" "}
            <Calendario
              width={15}
              height={15}
              style={{ float: "right", opacity: 0.5 }}
            />
          </div>
          <div className="numero">{hoje.total}</div>
          <div className="nota">agendamentos</div>
        </div>
        <div className="cartao">
          <div className="rotulo">
            Realizado hoje{" "}
            <Grafico
              width={15}
              height={15}
              style={{ float: "right", opacity: 0.5 }}
            />
          </div>
          <div className="numero" style={{ fontSize: 30 }}>
            {moeda(hoje.realizado)}
          </div>
          <div className="nota">atendimentos concluídos</div>
        </div>
        <div className="cartao">
          <div className="rotulo">
            Previsto hoje{" "}
            <Dinheiro
              width={15}
              height={15}
              style={{ float: "right", opacity: 0.5 }}
            />
          </div>
          <div className="numero" style={{ fontSize: 30 }}>
            {moeda(hoje.previsto)}
          </div>
          <div className="nota">pendente + confirmado</div>
        </div>
        <div className="cartao">
          <div className="rotulo">
            Confirmados{" "}
            <CheckCirculo
              width={15}
              height={15}
              style={{ float: "right", opacity: 0.5 }}
            />
          </div>
          <div className="numero">{hoje.confirmados}</div>
          <div className="nota">para hoje</div>
        </div>
        <div className="cartao">
          <div className="rotulo">
            Pendentes{" "}
            <Sino
              width={15}
              height={15}
              style={{ float: "right", opacity: 0.5 }}
            />
          </div>
          <div className="numero">{hoje.pendentes}</div>
          <div className="nota">aguardando você</div>
        </div>
      </div>

      <section className="bloco">
        <h2>Quem trabalha hoje</h2>
        {hoje.agenda.length === 0 ? (
          <Vazio titulo="Nenhum profissional ativo">
            Cadastre a equipe em Profissionais para começar a receber
            agendamentos.
          </Vazio>
        ) : (
          <div>
            {hoje.agenda.map((b) => (
              <div
                key={b.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "12px 0",
                  borderBottom: "1px solid rgba(217,201,173,.5)",
                }}
              >
                {b.foto ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    className="avatar-mini"
                    src={b.foto}
                    alt=""
                    width={42}
                    height={42}
                    loading="lazy"
                  />
                ) : (
                  <span className="avatar-mini">{iniciais(b.nome)}</span>
                )}
                <div style={{ flex: 1 }}>
                  <strong>{b.nome}</strong>
                  <div style={{ fontSize: 13.5, color: "var(--tinta-suave)" }}>
                    {b.atendimentos > 0
                      ? `${b.atendimentos} atendimento(s)`
                      : "Sem agendamentos hoje"}
                  </div>
                </div>
                {b.atendimentos > 0 ? (
                  <span
                    className="mono"
                    style={{ fontSize: 13, color: "var(--tinta-suave)" }}
                  >
                    {b.primeiro} – {b.ultimo}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="bloco">
        <h2>Últimos agendamentos recebidos</h2>
        {hoje.recentes.length === 0 ? (
          <Vazio titulo="Ainda não chegou nenhum agendamento">
            Assim que um cliente marcar pelo site, ele aparece aqui.
          </Vazio>
        ) : (
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Quando</th>
                  <th>Profissional</th>
                  <th>Serviço</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {hoje.recentes.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <strong>{a.cliente_nome}</strong>
                    </td>
                    <td className="mono" style={{ fontSize: 13 }}>
                      {dataBr(a.data)} {a.inicio}
                    </td>
                    <td>{a.barbeiro_nome}</td>
                    <td>{a.servico_nome}</td>
                    <td>
                      <Etiqueta status={a.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
