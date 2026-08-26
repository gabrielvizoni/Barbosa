import { Suspense } from 'react';
import Link from 'next/link';
import Header from '@/components/Header';
import FluxoAgendamento from './FluxoAgendamento';
import Animacoes from '@/components/Animacoes';
import { lerConfig } from '@/lib/db';
import { NOME_PADRAO } from '@/lib/format';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const config = lerConfig();
  return {
    title: `Agendar horário — ${config.nome_barbearia || NOME_PADRAO}`,
  };
}

export default function PaginaAgendar() {
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
          <div className="agendar-titulo">
            <span className="sobrenome anim-entrada">Agendamento online</span>
            <h1 className="anim-entrada">Agendar horário</h1>
          </div>
          <Suspense fallback={null}>
            <FluxoAgendamento />
          </Suspense>
        </div>
      </main>

      <div className="poste" aria-hidden="true" />
      <Animacoes />
    </div>
  );
}
