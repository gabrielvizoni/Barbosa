'use client';

import { useId, useState } from 'react';
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

/** Campo de upload de imagem: mostra a prévia e envia pro servidor assim que o arquivo é escolhido. */
export function CampoImagem({ label, valor, aoMudar, pasta, avisar }) {
  const [enviando, setEnviando] = useState(false);
  const idEntrada = useId();

  async function selecionar(evento) {
    const arquivo = evento.target.files?.[0];
    evento.target.value = '';
    if (!arquivo) return;

    setEnviando(true);
    try {
      const corpo = new FormData();
      corpo.append('arquivo', arquivo);
      corpo.append('pasta', pasta);
      const resposta = await fetch('/api/admin/upload', { method: 'POST', body: corpo });
      const dados = await resposta.json().catch(() => ({}));
      if (!resposta.ok) throw new Error(dados.erro || 'Não consegui enviar a imagem.');
      aoMudar(dados.url);
    } catch (erro) {
      avisar?.(erro.message, 'erro');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="campo">
      <span>{label}</span>
      <div className="campo-imagem">
        {valor ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img className="campo-imagem-previa" src={valor} alt="" />
        ) : (
          <div className="campo-imagem-vazia">Sem imagem</div>
        )}
        <div className="campo-imagem-acoes">
          <label className="btn btn-contorno btn-mini" htmlFor={idEntrada}>
            {enviando ? 'Enviando…' : valor ? 'Trocar imagem' : 'Enviar imagem'}
          </label>
          <input
            id={idEntrada}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            style={{ display: 'none' }}
            onChange={selecionar}
            disabled={enviando}
          />
          {valor ? (
            <button
              type="button"
              className="icone-btn perigo"
              onClick={() => aoMudar('')}
              title="Remover imagem"
            >
              <Xis width={14} height={14} />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function Vazio({ titulo, children }) {
  return (
    <div className="vazio">
      <strong>{titulo}</strong>
      {children}
    </div>
  );
}
