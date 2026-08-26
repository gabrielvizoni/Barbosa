'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, Etiqueta, Modal, SeletorData, SeletorLista, Vazio } from './base';
import { dataBr, linkConfirmacaoCliente, mascararTelefone, moeda } from '@/lib/format';
import { usePainelConfig } from './ConfigContext';
import { Check, Lapis, Lixeira, Mais, Relogio, Xis, Zap } from '@/components/Icones';
import AgendaPorProfissional from './AgendaVisual';

const STATUS = [
  { id: '', rotulo: 'Todos os status' },
  { id: 'pendente', rotulo: 'Pendentes' },
  { id: 'confirmado', rotulo: 'Confirmados' },
  { id: 'concluido', rotulo: 'Concluídos' },
  { id: 'cancelado', rotulo: 'Cancelados' },
];

// Espelha src/lib/agendamentos.js — só para decidir quais botões mostrar.
// Quem garante a regra de verdade é o backend; a UI aqui é só conveniência.
const TRANSICOES_LEGAIS = {
  pendente: ['confirmado', 'cancelado'],
  confirmado: ['concluido', 'cancelado'],
  concluido: [],
  cancelado: ['pendente', 'confirmado'],
};

const VAZIO = {
  cliente_nome: '',
  cliente_telefone: '',
  barbeiro_id: '',
  servico_id: '',
  data: '',
  inicio: '',
  observacoes: '',
};

const VAZIO_REMARCAR = { barbeiro_id: '', servico_id: '', data: '', inicio: '' };

export default function Agendamentos({ avisar, tratarErro, aoMudar }) {
  const { nome } = usePainelConfig();
  const [visao, setVisao] = useState('dia');
  const [itens, setItens] = useState([]);
  const [barbeiros, setBarbeiros] = useState([]);
  const [servicos, setServicos] = useState([]);
  const [busca, setBusca] = useState('');
  const [status, setStatus] = useState('');
  const [barbeiro, setBarbeiro] = useState('');
  const [data, setData] = useState('');

  const [aberto, setAberto] = useState(false);
  const [novo, setNovo] = useState(VAZIO);
  const [erroEncaixe, setErroEncaixe] = useState('');
  const [horarios, setHorarios] = useState([]);
  const [horarioManual, setHorarioManual] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [processando, setProcessando] = useState(null); // id do agendamento em ação (status/exclusão)

  const [remarcando, setRemarcando] = useState(null); // agendamento em remarcação, ou null
  const [formRemarcar, setFormRemarcar] = useState(VAZIO_REMARCAR);
  const [erroRemarcar, setErroRemarcar] = useState('');
  const [horariosRemarcar, setHorariosRemarcar] = useState([]);
  const [horarioManualRemarcar, setHorarioManualRemarcar] = useState(false);
  const [salvandoRemarcar, setSalvandoRemarcar] = useState(false);

  const carregar = useCallback(() => {
    const query = new URLSearchParams({ busca, status, barbeiro, data }).toString();
    api(`agendamentos?${query}`)
      .then((r) => setItens(r.itens))
      .catch(tratarErro);
  }, [busca, status, barbeiro, data, tratarErro]);

  useEffect(() => {
    const t = setTimeout(carregar, 250);
    return () => clearTimeout(t);
  }, [carregar]);

  useEffect(() => {
    api('barbeiros').then((r) => setBarbeiros(r.itens.filter((b) => b.ativo))).catch(() => {});
    api('servicos').then((r) => setServicos(r.itens.filter((s) => s.ativo))).catch(() => {});
  }, []);

  // Ao ter serviço, profissional e data escolhidos, mostra o que está livre.
  useEffect(() => {
    if (!novo.barbeiro_id || !novo.servico_id || !novo.data) return setHorarios([]);
    api('agendamentos', {
      method: 'PUT',
      body: {
        barbeiro_id: novo.barbeiro_id,
        servico_id: novo.servico_id,
        data: novo.data,
      },
    })
      .then((r) => setHorarios(r.horarios))
      .catch(() => setHorarios([]));
  }, [novo.barbeiro_id, novo.servico_id, novo.data]);

  // Mesma ideia, para o modal de remarcação.
  useEffect(() => {
    if (!formRemarcar.barbeiro_id || !formRemarcar.servico_id || !formRemarcar.data) {
      return setHorariosRemarcar([]);
    }
    api('agendamentos', {
      method: 'PUT',
      body: {
        barbeiro_id: formRemarcar.barbeiro_id,
        servico_id: formRemarcar.servico_id,
        data: formRemarcar.data,
      },
    })
      .then((r) => setHorariosRemarcar(r.horarios))
      .catch(() => setHorariosRemarcar([]));
  }, [formRemarcar.barbeiro_id, formRemarcar.servico_id, formRemarcar.data]);

  async function mudarStatus(id, novoStatus) {
    if (processando) return;
    setProcessando(id);
    try {
      await api(`agendamentos/${id}`, { method: 'PATCH', body: { status: novoStatus } });
      carregar();
      aoMudar?.();
      avisar('Status atualizado.');
    } catch (erro) {
      tratarErro(erro);
    } finally {
      setProcessando(null);
    }
  }

  async function excluir(id, nome) {
    if (!confirm(`Excluir o agendamento de ${nome}? Não dá para desfazer.`)) return;
    if (processando) return;
    setProcessando(id);
    try {
      await api(`agendamentos/${id}`, { method: 'DELETE' });
      carregar();
      aoMudar?.();
      avisar('Agendamento excluído.');
    } catch (erro) {
      tratarErro(erro);
    } finally {
      setProcessando(null);
    }
  }

  function abrirEncaixe() {
    setNovo(VAZIO);
    setErroEncaixe('');
    setHorarioManual(false);
    setAberto(true);
  }

  async function salvarEncaixe() {
    setErroEncaixe('');
    if (novo.cliente_nome.trim().length < 2) {
      return setErroEncaixe('Escreva o nome do cliente.');
    }
    if (!novo.servico_id) {
      return setErroEncaixe('Escolha o serviço.');
    }
    if (!novo.barbeiro_id) {
      return setErroEncaixe('Escolha o profissional.');
    }
    if (!novo.data) {
      return setErroEncaixe('Escolha a data.');
    }
    if (!novo.inicio) {
      return setErroEncaixe('Escolha o horário.');
    }

    setSalvando(true);
    try {
      await api('agendamentos', { method: 'POST', body: novo });
      setAberto(false);
      setNovo(VAZIO);
      carregar();
      aoMudar?.();
      avisar('Encaixe registrado.');
    } catch (erro) {
      if (erro.status === 401) return tratarErro(erro);
      setErroEncaixe(erro.message);
    } finally {
      setSalvando(false);
    }
  }

  function abrirRemarcar(a) {
    setFormRemarcar({
      barbeiro_id: String(a.barbeiro_id ?? ''),
      servico_id: String(a.servico_id ?? ''),
      data: a.data,
      inicio: a.inicio,
    });
    setErroRemarcar('');
    // Começa no campo manual, já preenchido com o horário atual: a lista de
    // sugestões (mesma regra do site) não inclui o horário que o próprio
    // agendamento já ocupa, então digitar de novo seria só atrito à toa.
    setHorarioManualRemarcar(true);
    setRemarcando(a);
  }

  async function salvarRemarcar() {
    setErroRemarcar('');
    if (!formRemarcar.servico_id) return setErroRemarcar('Escolha o serviço.');
    if (!formRemarcar.barbeiro_id) return setErroRemarcar('Escolha o profissional.');
    if (!formRemarcar.data) return setErroRemarcar('Escolha a data.');
    if (!formRemarcar.inicio) return setErroRemarcar('Escolha o horário.');

    setSalvandoRemarcar(true);
    try {
      await api(`agendamentos/${remarcando.id}`, {
        method: 'PATCH',
        body: {
          data: formRemarcar.data,
          inicio: formRemarcar.inicio,
          barbeiro_id: formRemarcar.barbeiro_id,
          servico_id: formRemarcar.servico_id,
        },
      });
      setRemarcando(null);
      carregar();
      aoMudar?.();
      avisar('Agendamento remarcado.');
    } catch (erro) {
      if (erro.status === 401) return tratarErro(erro);
      setErroRemarcar(erro.message);
    } finally {
      setSalvandoRemarcar(false);
    }
  }

  return (
    <>
      <div className="conteudo-topo">
        <div>
          <h1>Agenda</h1>
          <p>
            Veja o dia por profissional ou a lista completa. Confirme, conclua ou cancele —
            e registre quem chegou sem marcar.
          </p>
        </div>
        <button className="btn btn-ouro" onClick={abrirEncaixe}>
          <Mais /> Encaixar cliente
        </button>
      </div>

      <div className="agenda-filtros" style={{ marginBottom: 20 }}>
        <button className={`pilula ${visao === 'dia' ? 'ativa' : ''}`} onClick={() => setVisao('dia')}>
          Agenda do dia
        </button>
        <button
          className={`pilula ${visao === 'lista' ? 'ativa' : ''}`}
          onClick={() => setVisao('lista')}
        >
          Lista completa
        </button>
      </div>

      {visao === 'dia' ? (
        <AgendaPorProfissional barbeiros={barbeiros} tratarErro={tratarErro} />
      ) : (
        <section className="bloco">
          <div className="agenda-filtros">
            <input
              className="entrada"
              style={{ maxWidth: 280 }}
              placeholder="Buscar por nome ou telefone"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
            <SeletorLista
              value={status}
              onChange={setStatus}
              options={STATUS.map((s) => ({ value: s.id, rotulo: s.rotulo }))}
            />
            <SeletorLista
              value={barbeiro}
              onChange={setBarbeiro}
              options={[
                { value: '', rotulo: 'Todos os profissionais' },
                ...barbeiros.map((b) => ({ value: String(b.id), rotulo: b.nome })),
              ]}
            />
            <SeletorData value={data} onChange={setData} />
          </div>

          {itens.length === 0 ? (
            <Vazio titulo="Nenhum agendamento por aqui">
              Ajuste os filtros ou espere o primeiro cliente marcar pelo site.
            </Vazio>
          ) : (
            <div className="tabela-rolagem">
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Data / hora</th>
                    <th>Cliente</th>
                    <th>Telefone</th>
                    <th>Profissional</th>
                    <th>Serviço</th>
                    <th>Valor</th>
                    <th>Status</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {itens.map((a) => (
                    <tr key={a.id}>
                      <td className="mono" style={{ fontSize: 13 }}>
                        {dataBr(a.data)}
                        <br />
                        {a.inicio}–{a.fim}
                      </td>
                      <td>
                        <strong>{a.cliente_nome}</strong>
                        {a.observacoes ? (
                          <div style={{ fontSize: 12.5, color: 'var(--tinta-suave)' }}>
                            {a.observacoes}
                          </div>
                        ) : null}
                      </td>
                      <td className="mono" style={{ fontSize: 13 }}>
                        {mascararTelefone(a.cliente_telefone)}
                      </td>
                      <td>{a.barbeiro_nome}</td>
                      <td>{a.servico_nome}</td>
                      <td className="mono">{moeda(a.preco_centavos)}</td>
                      <td>
                        <Etiqueta status={a.status} />
                      </td>
                      <td>
                        <div className="acoes-linha">
                          {linkConfirmacaoCliente(nome, a) ? (
                            <a
                              className="icone-btn positivo"
                              href={linkConfirmacaoCliente(nome, a)}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Falar no WhatsApp"
                            >
                              <Zap width={15} height={15} />
                            </a>
                          ) : null}
                          {TRANSICOES_LEGAIS[a.status]?.includes('pendente') ? (
                            <button
                              className="icone-btn"
                              onClick={() => mudarStatus(a.id, 'pendente')}
                              title="Reabrir"
                              disabled={processando === a.id}
                            >
                              <Relogio width={15} height={15} />
                            </button>
                          ) : null}
                          {TRANSICOES_LEGAIS[a.status]?.includes('confirmado') ? (
                            <button
                              className="icone-btn positivo"
                              onClick={() => mudarStatus(a.id, 'confirmado')}
                              title="Confirmar"
                              disabled={processando === a.id}
                            >
                              <Check width={15} height={15} />
                            </button>
                          ) : null}
                          {TRANSICOES_LEGAIS[a.status]?.includes('concluido') ? (
                            <button
                              className="icone-btn positivo"
                              onClick={() => mudarStatus(a.id, 'concluido')}
                              title="Marcar como concluído"
                              disabled={processando === a.id}
                            >
                              <Check width={15} height={15} />
                            </button>
                          ) : null}
                          {a.status === 'pendente' || a.status === 'confirmado' ? (
                            <button
                              className="icone-btn"
                              onClick={() => abrirRemarcar(a)}
                              title="Remarcar"
                              disabled={processando === a.id}
                            >
                              <Lapis width={15} height={15} />
                            </button>
                          ) : null}
                          {TRANSICOES_LEGAIS[a.status]?.includes('cancelado') ? (
                            <button
                              className="icone-btn perigo"
                              onClick={() => mudarStatus(a.id, 'cancelado')}
                              title="Cancelar"
                              disabled={processando === a.id}
                            >
                              <Xis width={15} height={15} />
                            </button>
                          ) : null}
                          <button
                            className="icone-btn perigo"
                            onClick={() => excluir(a.id, a.cliente_nome)}
                            title="Excluir"
                            disabled={processando === a.id}
                          >
                            <Lixeira width={15} height={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {aberto ? (
        <Modal
          titulo="Encaixar cliente"
          aoFechar={() => setAberto(false)}
          rodape={
            <>
              <button className="btn btn-contorno" onClick={() => setAberto(false)}>
                Cancelar
              </button>
              <button className="btn btn-ouro" onClick={salvarEncaixe} disabled={salvando}>
                {salvando ? 'Salvando…' : 'Registrar'}
              </button>
            </>
          }
        >
          {erroEncaixe ? <div className="aviso aviso-erro">{erroEncaixe}</div> : null}

          <div className="linha-campos">
            <label className="campo">
              <span>Nome do cliente</span>
              <input
                className="entrada"
                value={novo.cliente_nome}
                onChange={(e) => setNovo({ ...novo, cliente_nome: e.target.value })}
              />
            </label>
            <label className="campo">
              <span>Telefone (opcional)</span>
              <input
                className="entrada mono"
                value={novo.cliente_telefone}
                onChange={(e) =>
                  setNovo({ ...novo, cliente_telefone: mascararTelefone(e.target.value) })
                }
                placeholder="(44) 99999-0000"
              />
            </label>
          </div>

          <div className="linha-campos">
            <label className="campo">
              <span>Serviço</span>
              <select
                className="entrada"
                value={novo.servico_id}
                onChange={(e) => setNovo({ ...novo, servico_id: e.target.value, inicio: '' })}
              >
                <option value="">Escolha…</option>
                {servicos.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nome} — {moeda(s.preco_centavos)}
                  </option>
                ))}
              </select>
            </label>
            <label className="campo">
              <span>Profissional</span>
              <select
                className="entrada"
                value={novo.barbeiro_id}
                onChange={(e) => setNovo({ ...novo, barbeiro_id: e.target.value, inicio: '' })}
              >
                <option value="">Escolha…</option>
                {barbeiros.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.nome}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="campo">
            <span>Data</span>
            <SeletorData
              className="seletor-data-bloco"
              value={novo.data}
              onChange={(data) => setNovo({ ...novo, data, inicio: '' })}
            />
          </label>

          <div className="campo">
            <span>Horário</span>

            {horarios.length > 0 ? (
              <div className="caixas">
                {horarios.map((h) => (
                  <button
                    key={h}
                    type="button"
                    className="caixa mono"
                    onClick={() => setNovo({ ...novo, inicio: h })}
                    style={
                      novo.inicio === h
                        ? { borderColor: 'var(--verde-500)', background: 'rgba(47,98,72,.1)' }
                        : undefined
                    }
                  >
                    {h}
                  </button>
                ))}
              </div>
            ) : (
              <p style={{ margin: '2px 0 0', fontSize: 13.5, color: 'var(--tinta-suave)' }}>
                {novo.barbeiro_id && novo.servico_id && novo.data
                  ? 'Nenhum horário livre nesse dia — escolha outro dia ou digite um horário manualmente.'
                  : 'Escolha o serviço, o profissional e a data pra ver os horários livres.'}
              </p>
            )}

            {horarioManual ? (
              <input
                type="time"
                className="entrada mono"
                style={{ marginTop: 10, maxWidth: 160 }}
                value={novo.inicio}
                onChange={(e) => setNovo({ ...novo, inicio: e.target.value })}
                autoFocus
              />
            ) : (
              <button
                type="button"
                className="link-simples"
                style={{ marginTop: 10 }}
                onClick={() => setHorarioManual(true)}
              >
                Digitar outro horário
              </button>
            )}
          </div>

          <label className="campo">
            <span>Observação</span>
            <input
              className="entrada"
              value={novo.observacoes}
              onChange={(e) => setNovo({ ...novo, observacoes: e.target.value })}
            />
          </label>

          <div className="aviso" style={{ marginBottom: 0 }}>
            O encaixe entra já confirmado e pode ficar fora do expediente — só não pode
            colidir com outro atendimento do mesmo profissional.
          </div>
        </Modal>
      ) : null}

      {remarcando ? (
        <Modal
          titulo={`Remarcar — ${remarcando.cliente_nome}`}
          aoFechar={() => setRemarcando(null)}
          rodape={
            <>
              <button className="btn btn-contorno" onClick={() => setRemarcando(null)}>
                Cancelar
              </button>
              <button className="btn btn-ouro" onClick={salvarRemarcar} disabled={salvandoRemarcar}>
                {salvandoRemarcar ? 'Salvando…' : 'Remarcar'}
              </button>
            </>
          }
        >
          {erroRemarcar ? <div className="aviso aviso-erro">{erroRemarcar}</div> : null}

          <div className="linha-campos">
            <label className="campo">
              <span>Serviço</span>
              <select
                className="entrada"
                value={formRemarcar.servico_id}
                onChange={(e) =>
                  setFormRemarcar({ ...formRemarcar, servico_id: e.target.value, inicio: '' })
                }
              >
                <option value="">Escolha…</option>
                {servicos.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nome} — {moeda(s.preco_centavos)}
                  </option>
                ))}
              </select>
            </label>
            <label className="campo">
              <span>Profissional</span>
              <select
                className="entrada"
                value={formRemarcar.barbeiro_id}
                onChange={(e) =>
                  setFormRemarcar({ ...formRemarcar, barbeiro_id: e.target.value, inicio: '' })
                }
              >
                <option value="">Escolha…</option>
                {barbeiros.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.nome}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="campo">
            <span>Data</span>
            <SeletorData
              className="seletor-data-bloco"
              value={formRemarcar.data}
              onChange={(data) => setFormRemarcar({ ...formRemarcar, data, inicio: '' })}
            />
          </label>

          <div className="campo">
            <span>Horário</span>

            {horariosRemarcar.length > 0 ? (
              <div className="caixas">
                {horariosRemarcar.map((h) => (
                  <button
                    key={h}
                    type="button"
                    className="caixa mono"
                    onClick={() => setFormRemarcar({ ...formRemarcar, inicio: h })}
                    style={
                      formRemarcar.inicio === h
                        ? { borderColor: 'var(--verde-500)', background: 'rgba(47,98,72,.1)' }
                        : undefined
                    }
                  >
                    {h}
                  </button>
                ))}
              </div>
            ) : (
              <p style={{ margin: '2px 0 0', fontSize: 13.5, color: 'var(--tinta-suave)' }}>
                Nenhuma sugestão pronta pra esse dia — o horário atual já está preenchido
                abaixo, ou digite outro.
              </p>
            )}

            {horarioManualRemarcar ? (
              <input
                type="time"
                className="entrada mono"
                style={{ marginTop: 10, maxWidth: 160 }}
                value={formRemarcar.inicio}
                onChange={(e) => setFormRemarcar({ ...formRemarcar, inicio: e.target.value })}
                autoFocus
              />
            ) : (
              <button
                type="button"
                className="link-simples"
                style={{ marginTop: 10 }}
                onClick={() => setHorarioManualRemarcar(true)}
              >
                Digitar outro horário
              </button>
            )}
          </div>

          <div className="aviso" style={{ marginBottom: 0 }}>
            A remarcação pode ficar fora do expediente — só não pode colidir com outro
            atendimento do mesmo profissional.
          </div>
        </Modal>
      ) : null}
    </>
  );
}
