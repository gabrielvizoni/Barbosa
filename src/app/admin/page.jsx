import { lerConfig } from "@/lib/db";
import { NOME_PADRAO } from "@/lib/format";
import PainelAdmin from "./PainelAdmin";

// Sem isso, o Next pré-renderiza esta página como estática no build — e uma
// página estática não recebe o nonce de CSP por requisição (ver
// src/middleware.js), então os scripts inline do próprio Next ficam sem
// nonce e o painel quebra em produção sob a CSP com 'strict-dynamic'.
export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const config = lerConfig();
  return {
    title: `Painel — ${config.nome_barbearia || NOME_PADRAO}`,
    robots: { index: false, follow: false },
  };
}

export default function PaginaAdmin() {
  return <PainelAdmin />;
}
