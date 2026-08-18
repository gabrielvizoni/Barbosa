'use client';

import { Xis } from '@/components/Icones';

/** Chama a API do painel e transforma erro de resposta em exceção com mensagem legível. */
export async function api(caminho, opcoes = {}) {
  const resposta = await fetch(`/api/admin/${caminho}`, {
    headers: opcoes.body ? { 'Content-Type': 'application/json' } : undefined,
    ...opcoes,
    body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
  });

  const corpo = await resposta.json().catch(() => ({}));

  if (!resposta.ok) {
    const erro = new Error(corpo.erro || 'Não consegui completar a ação.');
    erro.status = resposta.status;
    throw erro;
  }
  return corpo;
}

export function Modal({ titulo, children, aoFechar, rodape }) {
  return (
    <div
      className="fundo-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) aoFechar();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="modal-topo">
          <h2>{titulo}</h2>
          <button className="fechar" onClick={aoFechar} aria-label="Fechar">
            <Xis width={20} height={20} />
          </button>
        </div>
        <div className="modal-corpo">{children}</div>
        {rodape ? <div className="modal-base">{rodape}</div> : null}
      </div>
    </div>
  );
}

export function Etiqueta({ status }) {
  const rotulos = {
    pendente: 'Pendente',
    confirmado: 'Confirmado',
    concluido: 'Concluído',
    cancelado: 'Cancelado',
  };
  return <span className={`etiqueta etiqueta-${status}`}>{rotulos[status] || status}</span>;
}

export function Vazio({ titulo, children }) {
  return (
    <div className="vazio">
      <strong>{titulo}</strong>
      {children}
    </div>
  );
}
