import Link from 'next/link';
import FluxoAgendamento from './FluxoAgendamento';

export const metadata = {
  title: 'Agendar horário — The Barbosa Barbearia',
};

export default function PaginaAgendar() {
  return (
    <div className="pagina-agendar">
      <header className="cabecalho">
        <div className="container cabecalho-interno">
          <Link href="/" className="marca">
            <span className="marca-poste" aria-hidden="true" />
            <span className="marca-nome">The Barbosa</span>
          </Link>
          <nav className="menu">
            <Link href="/">Voltar ao site</Link>
          </nav>
        </div>
      </header>

      <main className="agendar-corpo">
        <div className="container">
          <div className="agendar-titulo">
            <span className="sobrenome">Agendamento online</span>
            <h1>Agendar horário</h1>
          </div>
          <FluxoAgendamento />
        </div>
      </main>

      <div className="poste" aria-hidden="true" />
    </div>
  );
}
