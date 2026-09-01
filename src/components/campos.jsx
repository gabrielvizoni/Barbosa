"use client";

import { useState } from "react";
import { Cadeado, Email, Olho, OlhoFechado } from "@/components/Icones";

// Campos de e-mail e senha compartilhados pelas telas de acesso do painel
// (PainelAdmin) e da conta do cliente (AreaCliente). Ficam num arquivo
// próprio para não duplicar a alternância de mostrar/ocultar senha e o
// mesmo visual em dois lugares.

/** Campo de senha com ícone de cadeado e alternância de mostrar/ocultar. */
export function CampoSenha({ label, valor, aoMudar, autoComplete, autoFocus }) {
  const [mostrar, setMostrar] = useState(false);
  return (
    <label className="campo">
      <span>{label}</span>
      <div className="campo-com-icone tem-icone-direita">
        <span className="icone-esquerda">
          <Cadeado width={16} height={16} />
        </span>
        <input
          className="entrada"
          type={mostrar ? "text" : "password"}
          value={valor}
          onChange={(e) => aoMudar(e.target.value)}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
        />
        <button
          type="button"
          className="icone-direita"
          onClick={() => setMostrar((m) => !m)}
          aria-label={mostrar ? "Ocultar senha" : "Mostrar senha"}
        >
          {mostrar ? (
            <OlhoFechado width={16} height={16} />
          ) : (
            <Olho width={16} height={16} />
          )}
        </button>
      </div>
    </label>
  );
}

/** Campo de e-mail com ícone de envelope — mesmo padrão visual do campo de senha. */
export function CampoEmail({ label, valor, aoMudar, autoComplete, autoFocus }) {
  return (
    <label className="campo">
      <span>{label}</span>
      <div className="campo-com-icone">
        <span className="icone-esquerda">
          <Email width={16} height={16} />
        </span>
        <input
          className="entrada"
          type="email"
          value={valor}
          onChange={(e) => aoMudar(e.target.value)}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
        />
      </div>
    </label>
  );
}
