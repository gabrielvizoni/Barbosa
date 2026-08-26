import "./globals.css";
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
  return (
    <html lang="pt-BR">
      <head>
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
