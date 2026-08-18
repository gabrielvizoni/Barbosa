'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, Modal, Vazio } from './base';
import { moeda, paraCentavos, paraReais } from '@/lib/format';
import { Lapis, Lixeira, Mais } from '@/components/Icones';

const VAZIO = { nome: '', marca: '', preco: '', estoque: 0, ativo: 1 };

export default function Produtos({ avisar, tratarErro }) {
  const [itens, setItens] = useState([]);
  const [editando, setEditando] = useState(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(() => {
    api('produtos').then((r) => setItens(r.itens)).catch(tratarErro);
  }, [tratarErro]);

  useEffect(carregar, [carregar]);

  async function salvar() {
    if (!editando.nome.trim()) return avisar('Dê um nome ao produto.', 'erro');

    const corpo = {
      nome: editando.nome,
      marca: editando.marca,
      preco_centavos: paraCentavos(editando.preco),
      estoque: Number(editando.estoque) || 0,
      ativo: editando.ativo ? 1 : 0,
    };

    setSalvando(true);
    try {
      if (editando.id) {
        await api(`produtos/${editando.id}`, { method: 'PATCH', body: corpo });
      } else {
        await api('produtos', { method: 'POST', body: corpo });
      }
      setEditando(null);
      carregar();
      avisar('Produto salvo.');
    } catch (erro) {
      tratarErro(erro);
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(p) {
    if (!confirm(`Excluir ${p.nome}?`)) return;
    try {
      await api(`produtos/${p.id}`, { method: 'DELETE' });
      carregar();
      avisar('Produto excluído.');
    } catch (erro) {
      tratarErro(erro);
    }
  }

  return (
    <>
      <div className="conteudo-topo">
        <div>
          <h1>Produtos</h1>
          <p>Controle do que é vendido no balcão: preço e quanto ainda tem.</p>
        </div>
        <button
          className="btn btn-ouro"
          onClick={() => setEditando({ ...VAZIO })}
        >
          <Mais /> Novo produto
        </button>
      </div>

      {itens.length === 0 ? (
        <Vazio titulo="Nenhum produto cadastrado">
          Pomada, óleo, shampoo — cadastre o que você vende para acompanhar o estoque por aqui.
        </Vazio>
      ) : (
        <div className="cartoes" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px,1fr))' }}>
          {itens.map((p) => (
            <article className="cartao" key={p.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <strong style={{ fontSize: 17 }}>{p.nome}</strong>
                  <div style={{ fontSize: 13, color: 'var(--tinta-suave)' }}>{p.marca}</div>
                </div>
                <span className={`etiqueta ${p.ativo ? 'etiqueta-confirmado' : 'etiqueta-neutra'}`}>
                  {p.ativo ? 'À venda' : 'Fora'}
                </span>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  margin: '14px 0',
                }}
              >
                <span
                  className="mono"
                  style={{ fontSize: 20, color: 'var(--dourado-escuro)', fontWeight: 500 }}
                >
                  {moeda(p.preco_centavos)}
                </span>
                <span
                  className="mono"
                  style={{
                    fontSize: 12.5,
                    color: p.estoque <= 3 ? 'var(--erro)' : 'var(--tinta-suave)',
                  }}
                >
                  {p.estoque} em estoque
                </span>
              </div>

              <div className="acoes-linha">
                <button
                  className="btn btn-contorno btn-mini"
                  onClick={() => setEditando({ ...p, preco: paraReais(p.preco_centavos) })}
                >
                  <Lapis width={14} height={14} /> Editar
                </button>
                <button className="icone-btn perigo" onClick={() => excluir(p)} title="Excluir">
                  <Lixeira width={15} height={15} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {editando ? (
        <Modal
          titulo={editando.id ? 'Editar produto' : 'Novo produto'}
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
          <div className="linha-campos">
            <label className="campo">
              <span>Nome</span>
              <input
                className="entrada"
                value={editando.nome}
                onChange={(e) => setEditando({ ...editando, nome: e.target.value })}
                autoFocus
              />
            </label>
            <label className="campo">
              <span>Marca</span>
              <input
                className="entrada"
                value={editando.marca}
                onChange={(e) => setEditando({ ...editando, marca: e.target.value })}
              />
            </label>
          </div>

          <div className="linha-campos">
            <label className="campo">
              <span>Preço (R$)</span>
              <input
                className="entrada mono"
                type="number"
                step="0.01"
                min="0"
                value={editando.preco}
                onChange={(e) => setEditando({ ...editando, preco: e.target.value })}
              />
            </label>
            <label className="campo">
              <span>Estoque</span>
              <input
                className="entrada mono"
                type="number"
                min="0"
                value={editando.estoque}
                onChange={(e) => setEditando({ ...editando, estoque: e.target.value })}
              />
            </label>
          </div>

          <label className="caixa">
            <input
              type="checkbox"
              checked={!!editando.ativo}
              onChange={(e) => setEditando({ ...editando, ativo: e.target.checked ? 1 : 0 })}
            />
            À venda
          </label>
        </Modal>
      ) : null}
    </>
  );
}
