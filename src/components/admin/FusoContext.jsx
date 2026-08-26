'use client';

import { createContext, useContext } from 'react';

// Fuso da barbearia (env TZ do servidor, vindo de GET /api/admin/config),
// disponível para qualquer tela do painel sem precisar repassar como prop
// por vários níveis de componente. PainelAdmin.jsx é quem provê o valor
// real; o default aqui só cobre o instante antes da primeira resposta da API.
const FusoContext = createContext('America/Sao_Paulo');

export function FusoProvider({ fuso, children }) {
  return <FusoContext.Provider value={fuso || 'America/Sao_Paulo'}>{children}</FusoContext.Provider>;
}

export function useFuso() {
  return useContext(FusoContext);
}
