'use client';

import { useMemo, useState } from 'react';
import { moeda } from '@/lib/format';

/** Agrupa serviços por categoria e permite filtrar por elas. */
export default function ServicosSecao({ servicos, barbeiros }) {
  const categorias = useMemo(() => {
    const vistas = [];
    for (const s of servicos) {
      if (s.categoria && !vistas.includes(s.categoria)) vistas.push(s.categoria);
    }
    return vistas;
  }, [servicos]);

  const [filtro, setFiltro] = useState('Todos');

  function nomesProfissionais(idsBarbeiros) {
    return idsBarbeiros
      .map((id) => barbeiros.find((b) => b.id === id)?.nome)
      .filter(Boolean)
      .map((nome) => nome.split(' ')[0]);
  }

  return (
    <>
      {categorias.length > 1 ? (
        <div className="filtro-categorias" role="tablist" aria-label="Filtrar serviços por categoria">
          <button
            type="button"
            className={`filtro-chip ${filtro === 'Todos' ? 'ativo' : ''}`}
            onClick={() => setFiltro('Todos')}
            aria-pressed={filtro === 'Todos'}
          >
            Todos
          </button>
          {categorias.map((categoria) => (
            <button
              key={categoria}
              type="button"
              className={`filtro-chip ${filtro === categoria ? 'ativo' : ''}`}
              onClick={() => setFiltro(categoria)}
              aria-pressed={filtro === categoria}
            >
              {categoria}
            </button>
          ))}
        </div>
      ) : null}

      <div className="grade">
        {/* Sempre renderiza todos os cartões e só esconde via CSS — removê-los do
            DOM ao trocar de categoria criaria nós novos, que nunca passam pela
            animação de entrada (ela roda uma vez só, ver Animacoes.jsx) e
            ficariam presos no opacity:0 inicial. */}
        {servicos.map((servico) => {
          const nomes = nomesProfissionais(servico.barbeiros);
          const visivel = filtro === 'Todos' || servico.categoria === filtro;
          return (
            <article
              className={`cartao-servico ${visivel ? '' : 'cartao-servico-oculto'}`}
              key={servico.id}
            >
              {servico.imagem ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img className="cartao-servico-imagem" src={servico.imagem} alt="" />
              ) : null}
              <span className="sobrenome" style={{ marginBottom: 0 }}>
                {servico.categoria}
              </span>
              <h3>{servico.nome}</h3>
              {servico.descricao ? <p>{servico.descricao}</p> : null}
              {nomes.length > 0 ? (
                <p className="cartao-servico-profissionais">
                  Com <strong>{nomes.join(' ou ')}</strong>
                </p>
              ) : null}
              <div className="cartao-rodape">
                <span className="preco">{moeda(servico.preco_centavos)}</span>
                <span className="duracao">{servico.duracao_min} min</span>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
