'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { animate, utils } from 'animejs';
import {
  moeda,
  dataBr,
  iniciais,
  mascararTelefone,
  telefoneValido,
  linkWhatsapp,
} from '@/lib/format';
import { hojeLocal } from '@/lib/datas-cliente';
import { CheckCirculo, SetaEsquerda, WhatsApp } from '@/components/Icones';

const PASSOS = ['Serviço', 'Profissional', 'Data', 'Horário', 'Seus dados'];

/* --- Formatação de datas no navegador (sem depender do fuso do servidor) --- */
/* Cabeçalho do calendário: sempre seg. a dom., nessa ordem — mesmo que
 * domingo não tenha expediente, a coluna continua existindo. */
const DIAS_SEMANA_CABECALHO = ['seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.', 'dom.'];
const DIAS_LONGOS = [
  'domingo', 'segunda-feira', 'terça-feira', 'quarta-feira',
  'quinta-feira', 'sexta-feira', 'sábado',
];
const MESES_LONGOS = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

function partes(data) {
  const [a, m, d] = data.split('-').map(Number);
  const semana = new Date(Date.UTC(a, m - 1, d)).getUTCDay();
  return { ano: a, mes: m, dia: d, semana };
}

/**
 * As semanas (seg. a dom.) de um mês, sempre com as 7 colunas — inclusive
 * domingo, mesmo quando a barbearia não abre nesse dia. Cada célula sabe se
 * está entre hoje (no fuso da barbearia) e o fim da janela de agendamento
 * (`ultimaData`) e se tem horário disponível.
 */
function gradeCalendarioMes(ano, mesIndice, ultimaData, disponiveis, hoje) {
  const primeiroDoMes = new Date(Date.UTC(ano, mesIndice, 1));
  const deslocamento = (primeiroDoMes.getUTCDay() + 6) % 7; // segunda-feira = primeira coluna
  const inicioGrade = new Date(primeiroDoMes);
  inicioGrade.setUTCDate(inicioGrade.getUTCDate() - deslocamento);

  const diasNoMes = new Date(Date.UTC(ano, mesIndice + 1, 0)).getUTCDate();
  const totalCelulas = Math.ceil((deslocamento + diasNoMes) / 7) * 7;

  return Array.from({ length: totalCelulas }, (_, i) => {
    const d = new Date(inicioGrade);
    d.setUTCDate(inicioGrade.getUTCDate() + i);
    const chave = d.toISOString().slice(0, 10);
    const noMes = d.getUTCMonth() === mesIndice;
    const noIntervalo = noMes && chave >= hoje && chave <= ultimaData;
    return {
      chave,
      dia: d.getUTCDate(),
      visivel: noIntervalo,
      disponivel: noIntervalo && disponiveis.has(chave),
    };
  });
}

function dataLonga(data) {
  const p = partes(data);
  return `${DIAS_LONGOS[p.semana]}, ${p.dia} de ${MESES_LONGOS[p.mes - 1]} de ${p.ano}`;
}

/** Resumo persistente do que já foi escolhido — some ao lado do painel no
 * desktop e vira uma faixa fixa no rodapé da tela no mobile (ver globals.css). */
function ComandaLateral({ servico, barbeiro, data, hora }) {
  if (!servico) {
    return (
      <div className="comanda-lateral-vazia">
        Escolha um serviço para começar a montar seu horário.
      </div>
    );
  }
  return (
    <div className="comanda">
      <h3>Sua escolha até agora</h3>
      <dl>
        <div className="comanda-linha">
          <dt>Serviço</dt>
          <dd>{servico.nome}</dd>
        </div>
        {barbeiro ? (
          <div className="comanda-linha">
            <dt>Profissional</dt>
            <dd>{barbeiro.nome}</dd>
          </div>
        ) : null}
        {data ? (
          <div className="comanda-linha">
            <dt>Data</dt>
            <dd>{dataBr(data)}</dd>
          </div>
        ) : null}
        {hora ? (
          <div className="comanda-linha">
            <dt>Horário</dt>
            <dd className="mono">{hora}</dd>
          </div>
        ) : null}
      </dl>
      <div className="comanda-total">
        <span>Total · {servico.duracao_min} min</span>
        <strong>{moeda(servico.preco_centavos)}</strong>
      </div>
    </div>
  );
}

export default function FluxoAgendamento() {
  const searchParams = useSearchParams();
  const barbeiroPreferidoId = useMemo(() => {
    const v = searchParams.get('barbeiro');
    return v ? Number(v) : null;
  }, [searchParams]);

  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [falhaCarregamento, setFalhaCarregamento] = useState(false);
  const [passo, setPasso] = useState(0);

  const [servico, setServico] = useState(null);
  const [barbeiro, setBarbeiro] = useState(null);
  const [data, setData] = useState(null);
  const [hora, setHora] = useState(null);

  const [horarios, setHorarios] = useState([]);
  const [buscandoHorarios, setBuscandoHorarios] = useState(false);

  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [observacoes, setObservacoes] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const [confirmado, setConfirmado] = useState(null);

  const painelRef = useRef(null);

  // Uma leve entrada a cada passo do agendamento, pra marcar a troca de tela.
  useEffect(() => {
    if (!painelRef.current) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    animate(painelRef.current, {
      opacity: [0, 1],
      translateY: [10, 0],
      duration: 380,
      ease: 'outQuart',
      onComplete: (self) => utils.cleanInlineStyles(self),
    });
  }, [passo]);

  function carregarDados() {
    setCarregando(true);
    setFalhaCarregamento(false);
    fetch('/api/public')
      .then((r) => {
        if (!r.ok) throw new Error('resposta não ok');
        return r.json();
      })
      .then(setDados)
      .catch(() => setFalhaCarregamento(true))
      .finally(() => setCarregando(false));
  }

  useEffect(carregarDados, []);

  // Ao entrar no passo de horário, busca o que está livre.
  useEffect(() => {
    if (passo !== 3 || !servico || !barbeiro || !data) return;
    setBuscandoHorarios(true);
    setHorarios([]);
    fetch(`/api/horarios?barbeiro=${barbeiro.id}&servico=${servico.id}&data=${data}`)
      .then((r) => r.json())
      .then((r) => setHorarios(r.horarios || []))
      .catch(() => setErro('Não consegui buscar os horários. Tente de novo.'))
      .finally(() => setBuscandoHorarios(false));
  }, [passo, servico, barbeiro, data]);

  const barbeirosDoServico = useMemo(() => {
    if (!dados || !servico) return [];
    return dados.barbeiros.filter((b) => servico.barbeiros.includes(b.id));
  }, [dados, servico]);

  /* Um calendário de verdade por mês — seg. a dom., domingo incluso mesmo
   * fechado — em vez de só empilhar os dias que têm horário livre. */
  const hojeChave = hojeLocal(dados?.fuso || 'America/Sao_Paulo');

  const gruposData = useMemo(() => {
    if (!dados?.dias?.length) return [];
    const disponiveis = new Set(dados.dias);
    const ultimaData = dados.dias[dados.dias.length - 1];
    const [anoIni, mesIni] = hojeChave.split('-').map(Number);
    const [anoFim, mesFim] = ultimaData.split('-').map(Number);
    const indiceFinal = anoFim * 12 + (mesFim - 1);

    const grupos = [];
    let ano = anoIni;
    let mesIndice = mesIni - 1;
    while (ano * 12 + mesIndice <= indiceFinal) {
      grupos.push({
        chave: `${ano}-${mesIndice}`,
        ano,
        mesIndice,
        celulas: gradeCalendarioMes(ano, mesIndice, ultimaData, disponiveis, hojeChave),
      });
      mesIndice += 1;
      if (mesIndice > 11) {
        mesIndice = 0;
        ano += 1;
      }
    }
    return grupos;
  }, [dados, hojeChave]);

  function voltar() {
    setErro('');
    setPasso((p) => Math.max(0, p - 1));
  }

  /* Um clique escolhe e já avança — é isso que mantém o fluxo curto. */
  function escolherServico(s) {
    setServico(s);
    setBarbeiro(null);
    setData(null);
    setHora(null);
    const disponiveis = dados.barbeiros.filter((b) => s.barbeiros.includes(b.id));

    // Com um único profissional, não faz sentido pedir uma escolha: pula o passo.
    if (disponiveis.length === 1) {
      setBarbeiro(disponiveis[0]);
      setPasso(2);
      return;
    }
    // Veio de "Agendar com [nome]" na equipe: se esse profissional atende
    // esse serviço, já pula a escolha também.
    const preferido = disponiveis.find((b) => b.id === barbeiroPreferidoId);
    if (preferido) {
      setBarbeiro(preferido);
      setPasso(2);
      return;
    }
    setPasso(1);
  }

  function escolherBarbeiro(b) {
    setBarbeiro(b);
    setData(null);
    setHora(null);
    setPasso(2);
  }

  function escolherData(d) {
    setData(d);
    setHora(null);
    setPasso(3);
  }

  function escolherHora(h) {
    setHora(h);
    setPasso(4);
  }

  async function confirmar() {
    setErro('');
    if (nome.trim().length < 2) return setErro('Escreva seu nome completo.');
    if (!telefoneValido(telefone)) return setErro('Informe um WhatsApp com DDD.');

    setEnviando(true);
    try {
      const resposta = await fetch('/api/agendamentos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cliente_nome: nome,
          cliente_telefone: telefone,
          barbeiro_id: barbeiro.id,
          servico_id: servico.id,
          data,
          inicio: hora,
          observacoes,
        }),
      });
      const corpo = await resposta.json();

      if (!resposta.ok) {
        setErro(corpo.erro || 'Não consegui concluir o agendamento.');
        if (resposta.status === 409) setPasso(3); // horário tomado: volta para escolher outro
        return;
      }
      setConfirmado(corpo.agendamento);
    } catch {
      setErro('Falha de conexão. Confira sua internet e tente novamente.');
    } finally {
      setEnviando(false);
    }
  }

  /* ------------------------------ Telas ------------------------------ */

  if (carregando) {
    return (
      <div className="painel">
        <div className="painel-corpo">
          <p className="painel-ajuda">Carregando os serviços…</p>
        </div>
      </div>
    );
  }

  if (falhaCarregamento) {
    return (
      <div className="painel">
        <div className="painel-corpo">
          <div className="aviso aviso-erro" style={{ marginBottom: 16 }}>
            Não consegui carregar os dados agora. Confira sua internet e tente de novo.
          </div>
          <button className="btn btn-ouro" onClick={carregarDados}>
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  if (confirmado) {
    const link = linkWhatsapp(dados?.barbearia?.whatsapp, confirmado);
    return (
      <div className="painel" style={{ maxWidth: 640, margin: '0 auto' }}>
        <div className="sucesso-topo">
          <div className="selo">
            <CheckCirculo width={32} height={32} />
          </div>
          <h2>Horário reservado</h2>
          <p>
            Até logo, <strong>{confirmado.cliente.split(' ')[0]}</strong>.
          </p>
          <p className="painel-ajuda" style={{ marginTop: 4 }}>
            {confirmado.status === 'confirmado'
              ? 'Seu horário já está confirmado pela barbearia.'
              : 'Seu horário está guardado — a barbearia ainda vai confirmar.'}
          </p>
        </div>
        <div className="painel-corpo">
          <div className="comanda">
            <h3>Sua comanda</h3>
            <dl>
              <div className="comanda-linha">
                <dt>Serviço</dt>
                <dd>{confirmado.servico}</dd>
              </div>
              <div className="comanda-linha">
                <dt>Profissional</dt>
                <dd>{confirmado.barbeiro}</dd>
              </div>
              <div className="comanda-linha">
                <dt>Data</dt>
                <dd>{dataLonga(confirmado.data)}</dd>
              </div>
              <div className="comanda-linha">
                <dt>Horário</dt>
                <dd className="mono">
                  {confirmado.inicio} – {confirmado.fim}
                </dd>
              </div>
            </dl>
            <div className="comanda-total">
              <span>Total</span>
              <strong>{moeda(confirmado.preco_centavos)}</strong>
            </div>
          </div>

          {link ? (
            <>
              <a href={link} target="_blank" rel="noopener noreferrer" className="btn btn-zap btn-bloco">
                <WhatsApp width={16} height={16} /> Enviar confirmação no WhatsApp
              </a>
              <p
                className="painel-ajuda"
                style={{ textAlign: 'center', margin: '12px 0 0', fontSize: 13.5 }}
              >
                A mensagem já vai escrita — é só apertar enviar.
              </p>
            </>
          ) : (
            <div className="aviso">
              Seu horário está guardado. Chegue com cinco minutos de antecedência.
            </div>
          )}

          <Link href="/" className="voltar" style={{ textAlign: 'center' }}>
            Voltar ao site
          </Link>
        </div>
      </div>
    );
  }

  if (!dados || dados.servicos.length === 0) {
    return (
      <div className="painel">
        <div className="painel-corpo">
          <div className="vazio">
            <strong>Agenda ainda não está aberta</strong>
            Os serviços estão sendo cadastrados. Se quiser marcar agora, fale com a barbearia
            direto pelo WhatsApp.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="agendar-layout">
      <div className="agendar-principal">
        <ol className="trilha">
          {PASSOS.map((rotulo, indice) => (
            <li
              key={rotulo}
              className={`trilha-passo ${
                indice === passo ? 'ativo' : indice < passo ? 'feito' : ''
              }`}
            >
              <span>{rotulo}</span>
            </li>
          ))}
        </ol>

        <div className="painel" ref={painelRef}>
          <div className="painel-topo">
            <span className="sobrenome">Passo {passo + 1} de 5</span>
            <h2>{PASSOS[passo]}</h2>
          </div>

          <div className="painel-corpo">
            {erro ? <div className="aviso aviso-erro">{erro}</div> : null}

            {/* 1. Serviço */}
            {passo === 0 && (
              <>
                <p className="painel-ajuda">O que você quer fazer hoje?</p>
                <div className="opcoes">
                  {dados.servicos.map((s) => (
                    <button key={s.id} className="opcao" onClick={() => escolherServico(s)}>
                      <div className="opcao-texto">
                        <div className="opcao-nome">{s.nome}</div>
                        {s.descricao ? <div className="opcao-sub">{s.descricao}</div> : null}
                      </div>
                      <div className="opcao-valor">
                        <div className="opcao-preco">{moeda(s.preco_centavos)}</div>
                        <div className="opcao-duracao">{s.duracao_min} min</div>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* 2. Profissional */}
            {passo === 1 && (
              <>
                <p className="painel-ajuda">
                  Quem você prefere para <strong>{servico.nome}</strong>?
                </p>
                <div className="opcoes">
                  {barbeirosDoServico.map((b) => (
                    <button key={b.id} className="opcao" onClick={() => escolherBarbeiro(b)}>
                      {b.foto ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img className="avatar-mini" src={b.foto} alt="" />
                      ) : (
                        <span className="avatar-mini" aria-hidden="true">
                          {iniciais(b.nome)}
                        </span>
                      )}
                      <div className="opcao-texto">
                        <div className="opcao-nome">{b.nome}</div>
                        <div className="opcao-sub">{b.funcao || b.bio}</div>
                      </div>
                    </button>
                  ))}
                </div>
                <button className="voltar" onClick={voltar}>
                  <SetaEsquerda width={14} height={14} /> Trocar de serviço
                </button>
              </>
            )}

            {/* 3. Data */}
            {passo === 2 && (
              <>
                <p className="painel-ajuda">
                  Escolha o dia. Os dias sem expediente aparecem apagados.
                </p>
                <div className="meses-datas">
                  <div className="semana-cabecalho">
                    {DIAS_SEMANA_CABECALHO.map((letra) => (
                      <span key={letra}>{letra}</span>
                    ))}
                  </div>
                  {gruposData.map((grupo) => (
                    <div className="mes-grupo" key={grupo.chave}>
                      <span className="mes-rotulo">
                        {MESES_LONGOS[grupo.mesIndice]} de {grupo.ano}
                      </span>
                      <div className="grade-datas">
                        {grupo.celulas.map((c) =>
                          !c.visivel ? (
                            <div key={c.chave} className="data-vazia" aria-hidden="true" />
                          ) : c.disponivel ? (
                            <button
                              key={c.chave}
                              className={`data-btn ${c.chave === hojeChave ? 'hoje' : ''}`}
                              onClick={() => escolherData(c.chave)}
                            >
                              <span className="numero">{c.dia}</span>
                            </button>
                          ) : (
                            <div
                              key={c.chave}
                              className={`data-btn fechado ${c.chave === hojeChave ? 'hoje' : ''}`}
                              aria-disabled="true"
                            >
                              <span className="numero">{c.dia}</span>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <button className="voltar" onClick={voltar}>
                  <SetaEsquerda width={14} height={14} /> Voltar
                </button>
              </>
            )}

            {/* 4. Horário */}
            {passo === 3 && (
              <>
                <p className="painel-ajuda">
                  {dataLonga(data)} · {servico.nome} ({servico.duracao_min} min) com {barbeiro.nome}
                </p>

                {buscandoHorarios ? (
                  <p className="painel-ajuda">Buscando horários livres…</p>
                ) : horarios.length === 0 ? (
                  <div className="vazio">
                    <strong>Nenhum horário livre nesse dia</strong>
                    A agenda de {barbeiro.nome} está cheia. Volte e escolha outro dia.
                  </div>
                ) : (
                  <div className="grade-horarios">
                    {horarios.map((h) => (
                      <button key={h} className="hora-btn" onClick={() => escolherHora(h)}>
                        {h}
                      </button>
                    ))}
                  </div>
                )}

                <button className="voltar" onClick={voltar}>
                  <SetaEsquerda width={14} height={14} /> Escolher outro dia
                </button>
              </>
            )}

            {/* 5. Dados */}
            {passo === 4 && (
              <>
                <div className="comanda">
                  <h3>Confira antes de fechar</h3>
                  <dl>
                    <div className="comanda-linha">
                      <dt>Serviço</dt>
                      <dd>{servico.nome}</dd>
                    </div>
                    <div className="comanda-linha">
                      <dt>Profissional</dt>
                      <dd>{barbeiro.nome}</dd>
                    </div>
                    <div className="comanda-linha">
                      <dt>Data</dt>
                      <dd>{dataBr(data)}</dd>
                    </div>
                    <div className="comanda-linha">
                      <dt>Horário</dt>
                      <dd className="mono">
                        {hora} ({servico.duracao_min} min)
                      </dd>
                    </div>
                  </dl>
                  <div className="comanda-total">
                    <span>Total</span>
                    <strong>{moeda(servico.preco_centavos)}</strong>
                  </div>
                </div>

                <label className="campo">
                  <span>Seu nome</span>
                  <input
                    className="entrada"
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    placeholder="Ex: João da Silva"
                    autoComplete="name"
                    autoFocus
                  />
                </label>

                <label className="campo">
                  <span>WhatsApp com DDD</span>
                  <input
                    className="entrada mono"
                    value={telefone}
                    onChange={(e) => setTelefone(mascararTelefone(e.target.value))}
                    placeholder="(44) 99999-0000"
                    inputMode="numeric"
                    autoComplete="tel"
                  />
                </label>

                <label className="campo">
                  <span>Observação (opcional)</span>
                  <input
                    className="entrada"
                    value={observacoes}
                    onChange={(e) => setObservacoes(e.target.value)}
                    placeholder="Ex: prefiro tesoura"
                  />
                </label>

                <button className="btn btn-ouro btn-bloco" onClick={confirmar} disabled={enviando}>
                  {enviando ? 'Reservando…' : 'Confirmar agendamento'}
                </button>

                <button className="voltar" onClick={voltar}>
                  <SetaEsquerda width={14} height={14} /> Trocar o horário
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <aside className="comanda-lateral" aria-label="Resumo do agendamento">
        <ComandaLateral servico={servico} barbeiro={barbeiro} data={data} hora={hora} />
      </aside>
    </div>
  );
}
