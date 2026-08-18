'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  moeda,
  dataBr,
  iniciais,
  mascararTelefone,
  telefoneValido,
  linkWhatsapp,
} from '@/lib/format';
import { CheckCirculo, SetaEsquerda, Zap } from '@/components/Icones';

const PASSOS = ['Serviço', 'Profissional', 'Data', 'Horário', 'Seus dados'];

/* --- Formatação de datas no navegador (sem depender do fuso do servidor) --- */
const DIAS_CURTOS = ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.'];
const MESES_CURTOS = [
  'jan.', 'fev.', 'mar.', 'abr.', 'mai.', 'jun.',
  'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.',
];
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

function dataLonga(data) {
  const p = partes(data);
  return `${DIAS_LONGOS[p.semana]}, ${p.dia} de ${MESES_LONGOS[p.mes - 1]} de ${p.ano}`;
}

export default function FluxoAgendamento() {
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
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

  useEffect(() => {
    fetch('/api/public')
      .then((r) => r.json())
      .then(setDados)
      .catch(() => setErro('Não consegui carregar os serviços. Atualize a página.'))
      .finally(() => setCarregando(false));
  }, []);

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
    } else {
      setPasso(1);
    }
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

  if (confirmado) {
    const link = linkWhatsapp(dados?.barbearia?.whatsapp, confirmado);
    return (
      <div className="painel">
        <div className="sucesso-topo">
          <div className="selo">
            <CheckCirculo width={32} height={32} />
          </div>
          <h2>Horário reservado</h2>
          <p>
            Até logo, <strong>{confirmado.cliente.split(' ')[0]}</strong>.
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
                <Zap /> Enviar confirmação no WhatsApp
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
    <>
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

      <div className="painel">
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
              <p className="painel-ajuda">Escolha o dia. Só aparecem dias em que abrimos.</p>
              <div className="grade-datas">
                {dados.dias.map((d, indice) => {
                  const p = partes(d);
                  return (
                    <button
                      key={d}
                      className={`data-btn ${indice === 0 ? 'hoje' : ''}`}
                      onClick={() => escolherData(d)}
                    >
                      <span className="dia-semana">{DIAS_CURTOS[p.semana]}</span>
                      <span className="numero">{p.dia}</span>
                      <span className="mes">{MESES_CURTOS[p.mes - 1]}</span>
                    </button>
                  );
                })}
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
    </>
  );
}
