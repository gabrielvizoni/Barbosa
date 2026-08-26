import "./globals.css";
import { headers } from "next/headers";
import { lerConfig } from "@/lib/db";
import { NOME_PADRAO } from "@/lib/format";

export async function generateMetadata() {
  const config = lerConfig();
  const nome = config.nome_barbearia || NOME_PADRAO;
  return {
    title: `${nome} — agende seu horário`,
    description:
      config.slogan ||
      "Agende seu horário em poucos cliques, sem precisar ligar.",
  };
}

export const viewport = {
  themeColor: "#122a1f",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }) {
  // Ler o header do middleware força esta rota a renderizar dinamicamente
  // (Next não permite ler headers() numa página estática) — já era o caso
  // de toda página do site (ver "force-dynamic" em cada page.jsx), então
  // não perde otimização que já existisse de propósito.
  const nonce = headers().get("x-nonce");

  return (
    // suppressHydrationWarning: o script logo abaixo adiciona a classe
    // js-ativo ao <html> antes da hidratação (de propósito — é o que faz o
    // conteúdo nascer visível funcionar) — o HTML vindo do servidor nunca
    // tem essa classe, então sem isso o React acusaria mismatch toda vez.
    // Mesmo padrão recomendado para scripts de tema claro/escuro.
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        {/*
          Sem JavaScript (ou antes dele rodar), o conteúdo já nasce visível —
          ver globals.css: .anim-entrada/.secao-cabeca/etc. só ficam com
          opacity:0 dentro de `.js-ativo`. Este script roda antes da
          primeira pintura do <body> e é o único jeito de ligar essa classe:
          precisa do nonce da CSP (script-src usa 'strict-dynamic', sem ele
          o navegador bloqueia como qualquer outro script inline).
        */}
        <script
          nonce={nonce}
          // O navegador nunca devolve o valor real do atributo `nonce` de
          // volta (é assim de propósito, pra um script injetado depois não
          // conseguir ler o nonce de um script legítimo e se passar por
          // ele) — na hidratação o React vê "" no DOM e o valor real que
          // ele mesmo pediu para renderizar, e credita isso a um mismatch
          // servidor/cliente. É sempre falso-positivo para este atributo
          // específico; sem isso o console mostra o aviso em toda navegação.
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: 'document.documentElement.classList.add("js-ativo");',
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;0,700;0,800;1,600&family=Inter:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
