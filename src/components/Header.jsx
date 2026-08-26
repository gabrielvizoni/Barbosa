"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, Xis } from "@/components/Icones";

/**
 * Cabeçalho compartilhado entre o site público e o fluxo de agendamento.
 * Em telas estreitas os links viram um menu de gaveta — no site público,
 * abaixo de 860px o `.menu-links` desaparece via CSS e sobra só o botão
 * de alternar (ver globals.css), que abre esta gaveta.
 */
export default function Header({ nome, logoUrl, links = [], cta, extra }) {
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    if (!aberto) return undefined;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [aberto]);

  return (
    <header className="cabecalho">
      <div className="container cabecalho-interno">
        <Link href="/" className="marca">
          {logoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            // Sem loading="lazy" de propósito: aparece no topo de toda
            // página, no primeiro trecho visível — atrasar o carregamento
            // dela seria o oposto do ganho de performance que a Etapa 9 pede.
            <img
              className="marca-logo"
              src={logoUrl}
              alt={nome}
              width={160}
              height={40}
            />
          ) : (
            <span className="marca-poste" aria-hidden="true" />
          )}
          <span className="marca-nome">{nome}</span>
        </Link>

        {links.length > 0 ? (
          <nav className="menu-links">
            {links.map((link) => (
              <a key={link.href} href={link.href}>
                {link.label}
              </a>
            ))}
            {cta}
          </nav>
        ) : (
          extra
        )}

        {links.length > 0 ? (
          <button
            type="button"
            className="menu-alternar"
            onClick={() => setAberto(true)}
            aria-label="Abrir menu"
            aria-expanded={aberto}
          >
            <Menu width={20} height={20} />
          </button>
        ) : null}
      </div>

      {aberto ? (
        <>
          <div className="menu-movel-fundo" onClick={() => setAberto(false)} />
          <nav className="menu-movel" aria-label="Menu">
            <div className="menu-movel-topo">
              <span className="marca-nome" style={{ fontSize: 16 }}>
                {nome}
              </span>
              <button
                type="button"
                className="menu-movel-fechar"
                onClick={() => setAberto(false)}
                aria-label="Fechar menu"
              >
                <Xis width={17} height={17} />
              </button>
            </div>
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setAberto(false)}
              >
                {link.label}
              </a>
            ))}
            {cta}
          </nav>
        </>
      ) : null}
    </header>
  );
}
