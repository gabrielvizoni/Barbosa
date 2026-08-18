'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, Modal, Vazio } from './base';
import { moeda, paraCentavos, paraReais } from '@/lib/format';
import { Lapis, Lixeira, Mais } from '@/components/Icones';

const VAZIO = {
  nome: '',
  descricao: '',
  categoria: 'Corte',
  preco: '',
  duracao_min: 30,
  ativo: 1,
  barbeiros: [],
};

export default function Servicos({ avisar, tratarErro }) {
  const [itens, setItens] = useState([]);
  const [barbeiros, setBarbeiros] = useState([]);
  const [editando, setEditando] = useState(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(() => {
    api('servicos').then((r) => setItens(r.itens)).catch(tratarErro);
    api('barbeiros').then((r) => setBarbeiros(r.itens.filter((b) => b.ativo))).catch(() => {});
  }, [tratarErro]);

  useEffect(carregar, [carregar]);

  function abrirNovo() {
    // Por padrão, todo mundo atende o serviço novo — é o caso mais comum.
    setEditando({ ...VAZIO, barbeiros: barbeiros.map((b) => b.id) });
  }

  function abrirEdicao(s) {
    setEditando({ ...s, preco: paraReais(s.preco_centavos) });
  }

  async function salvar() {
    if (!editando.nome.trim()) return avisar('Dê um nome ao serviço.', 'erro');
    if (editando.barbeiros.length === 0) {
      return avisar('Escolha ao menos um profissional para executar o serviço.', 'erro');
    }

    const corpo = {
      nome: editando.nome,
      descricao: editando.descricao,
      categoria: editando.categoria,
      preco_centavos: paraCentavos(editando.preco),
      duracao_min: Number(editando.duracao_min) || 30,
      ativo: editando.ativo ? 1 : 0,
      barbeiros: editando.barbeiros,
    };

    setSalvando(true);
    try {
      if (editando.id) {
        await api(`servicos/${editando.id}`, { method: 'PATCH', body: corpo });
      } else {
        await api('servicos', { method: 'POST', body: { ...corpo, ordem: itens.length + 1 } });
      }
      setEditando(null);
      carregar();
      avisar('Serviço salvo.');
    } catch (erro) {
      tratarErro(erro);
    } finally {
      setSalvando(false);
    }
  }

  async function alternarAtivo(s) {
    try {
      await api(`servicos/${s.id}`, { method: 'PATCH', body: { ativo: s.ativo ? 0 : 1 } });
      carregar();
    } catch (erro) {
      tratarErro(erro);
    }
  }

  async function excluir(s) {
    if (!confirm(`Excluir o serviço ${s.nome}?`)) return;
    try {
      const r = await api(`servicos/${s.id}`, { method: 'DELETE' });
      carregar();
      avisar(r.mensagem || 'Serviço excluído.');
    } catch (erro) {
      tratarErro(erro);
    }
  }

  function alternarBarbeiro(id) {
    const lista = editando.barbeiros.includes(id)
      ? editando.barbeiros.filter((b) => b !== id)
      : [...editando.barbeiros, id];
    setEditando({ ...editando, barbeiros: lista });
  }

  return (
    <>
      <div className="conteudo-topo">
        <div>
          <h1>Serviços</h1>
          <p>O que o cliente vê na primeira tela do agendamento. O preço e a duração vêm daqui.</p>
        </div>
        <button className="btn btn-ouro" onClick={abrirNovo}>
          <Mais /> Novo serviço
        </button>
      </div>

      <section className="bloco">
        {itens.length === 0 ? (
          <Vazio titulo="Nenhum serviço cadastrado">
            Enquanto não houver serviço, o agendamento fica fechado. Cadastre o primeiro — corte,
            barba, o que a casa faz.
          </Vazio>
        ) : (
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Serviço</th>
                  <th>Categoria</th>
                  <th>Quem faz</th>
                  <th>Duração</th>
                  <th>Preço</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.nome}</strong>
                      {s.descricao ? (
                        <div style={{ fontSize: 12.5, color: 'var(--tinta-suave)' }}>
                          {s.descricao}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <span className="etiqueta etiqueta-neutra">{s.categoria}</span>
                    </td>
                    <td style={{ fontSize: 13.5 }}>
                      {s.barbeiros.length === 0
                        ? '— ninguém'
                        : barbeiros
                            .filter((b) => s.barbeiros.includes(b.id))
                            .map((b) => b.nome.split(' ')[0])
                            .join(', ')}
                    </td>
                    <td className="mono">{s.duracao_min} min</td>
                    <td className="mono">{moeda(s.preco_centavos)}</td>
                    <td>
                      <span
                        className={`etiqueta ${s.ativo ? 'etiqueta-confirmado' : 'etiqueta-neutra'}`}
                      >
                        {s.ativo ? 'No ar' : 'Fora'}
                      </span>
                    </td>
                    <td>
                      <div className="acoes-linha">
                        <button className="icone-btn" onClick={() => abrirEdicao(s)} title="Editar">
                          <Lapis width={15} height={15} />
                        </button>
                        <button
                          className="btn btn-contorno btn-mini"
                          onClick={() => alternarAtivo(s)}
                        >
                          {s.ativo ? 'Tirar' : 'Voltar'}
                        </button>
                        <button
                          className="icone-btn perigo"
                          onClick={() => excluir(s)}
                          title="Excluir"
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

      {editando ? (
        <Modal
          titulo={editando.id ? 'Editar serviço' : 'Novo serviço'}
          aoFechar={() => setEditando(null)}
          rodape={
            <>
              <button className="btn btn-contorno" onClick={() => setEditando(null)}>
                Cancelar
              </button>
              <button className="btn btn-ouro" onClick={salvar} disabled={salvando}>
                {salvando ? 'Salvando…' : 'Salvar'}
              </button>
            </>
          }
        >
          <label className="campo">
            <span>Nome do serviço</span>
            <input
              className="entrada"
              value={editando.nome}
              onChange={(e) => setEditando({ ...editando, nome: e.target.value })}
              placeholder="Ex: Corte clássico"
              autoFocus
            />
          </label>

          <label className="campo">
            <span>Descrição</span>
            <input
              className="entrada"
              value={editando.descricao}
              onChange={(e) => setEditando({ ...editando, descricao: e.target.value })}
              placeholder="Uma linha que aparece embaixo do nome."
            />
          </label>

          <div className="linha-campos">
            <label className="campo">
              <span>Categoria</span>
              <input
                className="entrada"
                value={editando.categoria}
                onChange={(e) => setEditando({ ...editando, categoria: e.target.value })}
                placeholder="Corte, Barba, Tratamento…"
              />
            </label>
            <label className="campo">
              <span>Preço (R$)</span>
              <input
                className="entrada mono"
                type="number"
                step="0.01"
                min="0"
                value={editando.preco}
                onChange={(e) => setEditando({ ...editando, preco: e.target.value })}
                placeholder="45,00"
              />
            </label>
            <label className="campo">
              <span>Duração (min)</span>
              <input
                className="entrada mono"
                type="number"
                step="5"
                min="5"
                value={editando.duracao_min}
                onChange={(e) => setEditando({ ...editando, duracao_min: e.target.value })}
              />
            </label>
          </div>

          <div className="campo">
            <span>Quem executa</span>
            <div className="caixas">
              {barbeiros.length === 0 ? (
                <p style={{ margin: 0, fontSize: 14, color: 'var(--tinta-suave)' }}>
                  Cadastre um profissional antes.
                </p>
              ) : (
                barbeiros.map((b) => (
                  <label className="caixa" key={b.id}>
                    <input
                      type="checkbox"
                      checked={editando.barbeiros.includes(b.id)}
                      onChange={() => alternarBarbeiro(b.id)}
                    />
                    {b.nome}
                  </label>
                ))
              )}
            </div>
          </div>

          <label className="caixa" style={{ marginTop: 8 }}>
            <input
              type="checkbox"
              checked={!!editando.ativo}
              onChange={(e) => setEditando({ ...editando, ativo: e.target.checked ? 1 : 0 })}
            />
            Disponível para agendamento
          </label>
        </Modal>
      ) : null}
    </>
  );
}
