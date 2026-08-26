"use client";

import { createContext, useContext } from "react";

// Nome e fuso da barbearia, disponíveis para qualquer tela do painel sem
// precisar repassar como prop por vários níveis de componente.
// PainelAdmin.jsx busca os dois uma vez (nome via /api/public, que não
// exige sessão — precisa aparecer até na tela de login; fuso via GET
// /api/admin/config) e provê aqui. O default só cobre o instante antes da
// primeira resposta da API.
const PADRAO = { nome: "", fuso: "America/Sao_Paulo" };

const ConfigContext = createContext(PADRAO);

export function ConfigProvider({ nome, fuso, children }) {
  return (
    <ConfigContext.Provider
      value={{ nome: nome || "", fuso: fuso || PADRAO.fuso }}
    >
      {children}
    </ConfigContext.Provider>
  );
}

export function usePainelConfig() {
  return useContext(ConfigContext);
}
