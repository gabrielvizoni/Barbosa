import { Suspense } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import AreaCliente from "@/components/conta/AreaCliente";
import { lerConfig } from "@/lib/db";
import { NOME_PADRAO } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const config = lerConfig();
  return { title: `Minha conta — ${config.nome_barbearia || NOME_PADRAO}` };
}

export default function PaginaConta() {
  const config = lerConfig();

  return (
    <div className="pagina-agendar">
      <Header
        nome={config.nome_barbearia || NOME_PADRAO}
        logoUrl={config.logo_url}
        extra={
          <Link href="/" className="menu-desktop">
            Voltar ao site
          </Link>
        }
      />

      <main className="agendar-corpo">
        <div className="container">
          <Suspense fallback={null}>
            <AreaCliente />
          </Suspense>
        </div>
      </main>

      <div className="poste" aria-hidden="true" />
    </div>
  );
}
