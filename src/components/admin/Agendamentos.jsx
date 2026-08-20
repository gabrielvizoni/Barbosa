'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, Etiqueta, Modal, Vazio } from './base';
import { dataBr, mascararTelefone, moeda } from '@/lib/format';
import { Check, Lixeira, Mais, Xis, Zap } from '@/components/Icones';

const STATUS = [
  { id: '', rotulo: 'Todos os status' },
  { id: 'pendente', rotulo: 'Pendentes' },
  { id: 'confirmado', rotulo: 'Confirmados' },
  { id: 'concluido', rotulo: 'Concluídos' },
  { id: 'cancelado', rotulo: 'Cancelados' },
];

const VAZIO = {
  cliente_nome: '',
  cliente_telefone: '',
  barbeiro_id: '',
  servico_id: '',
  data: '',
  inicio: '',
  observacoes: '',
};

export default function Agendamentos({ avisar, tratarErro, aoMudar }) {
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
  const [salvando, setSalvando] = useState(false);
  const [processando, setProcessando] = useState(null); // id do agendamento em ação (status/exclusão)

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

  function linkZap(a) {
    const numero = a.cliente_telefone.replace(/\D/g, '');
    if (!numero) return null;
    const texto = `Olá, ${a.cliente_nome.split(' ')[0]}! Confirmando seu horário na The Barbosa: ${a.servico_nome} com ${a.barbeiro_nome}, dia ${dataBr(a.data)} às ${a.inicio}. Até lá!`;
    return `https://wa.me/55${numero}?text=${encodeURIComponent(texto)}`;
  }

  return (
    <>
      <div className="conteudo-topo">
        <div>
          <h1>Agendamentos</h1>
          <p>Confirme, conclua ou cancele. Também dá para registrar quem chegou sem marcar.</p>
        </div>
        <button className="btn btn-ouro" onClick={abrirEncaixe}>
          <Mais /> Encaixar cliente
        </button>
      </div>

      <section className="bloco">
        <div className="agenda-filtros">
          <input
            className="entrada"
            style={{ maxWidth: 280 }}
            placeholder="Buscar por nome ou telefone"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          <select className="entrada" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.rotulo}
              </option>
            ))}
          </select>
          <select
            className="entrada"
            style={{ width: 'auto' }}
            value={barbeiro}
            onChange={(e) => setBarbeiro(e.target.value)}
          >
            <option value="">Todos os profissionais</option>
            {barbeiros.map((b) => (
              <option key={b.id} value={b.id}>
                {b.nome}
              </option>
            ))}
          </select>
          <input
            type="date"
            className="entrada mono"
            style={{ width: 'auto' }}
            value={data}
            onChange={(e) => setData(e.target.value)}
          />
          {data ? (
            <button className="btn btn-contorno btn-mini" onClick={() => setData('')}>
              Limpar data
            </button>
          ) : null}
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
                        {linkZap(a) ? (
                          <a
                            className="icone-btn positivo"
                            href={linkZap(a)}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Falar no WhatsApp"
                          >
                            <Zap width={15} height={15} />
                          </a>
                        ) : null}
                        {a.status !== 'confirmado' && a.status !== 'concluido' ? (
                          <button
                            className="icone-btn positivo"
                            onClick={() => mudarStatus(a.id, 'confirmado')}
                            title="Confirmar"
                            disabled={processando === a.id}
                          >
                            <Check width={15} height={15} />
                          </button>
                        ) : null}
                        {a.status === 'confirmado' ? (
                          <button
                            className="icone-btn positivo"
                            onClick={() => mudarStatus(a.id, 'concluido')}
                            title="Marcar como concluído"
                            disabled={processando === a.id}
                          >
                            <Check width={15} height={15} />
                          </button>
                        ) : null}
                        {a.status !== 'cancelado' ? (
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

          <div className="linha-campos">
            <label className="campo">
              <span>Data</span>
              <input
                type="date"
                className="entrada mono"
                value={novo.data}
                onChange={(e) => setNovo({ ...novo, data: e.target.value, inicio: '' })}
              />
            </label>
            <label className="campo">
              <span>Horário</span>
              <input
                type="time"
                className="entrada mono"
                value={novo.inicio}
                onChange={(e) => setNovo({ ...novo, inicio: e.target.value })}
              />
            </label>
          </div>

          {horarios.length > 0 ? (
            <div style={{ marginBottom: 16 }}>
              <span
                className="mono"
                style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--tinta-suave)' }}
              >
                Livres nesse dia
              </span>
              <div className="caixas" style={{ marginTop: 8 }}>
                {horarios.map((h) => (
                  <button
                    key={h}
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
            </div>
          ) : null}

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
    </>
  );
}
