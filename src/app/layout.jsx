import './globals.css';

export const metadata = {
  title: 'The Barbosa Barbearia — agende seu horário',
  description:
    'Barbearia clássica em Maringá. Escolha o serviço, o barbeiro e o horário em menos de um minuto.',
};

export const viewport = {
  themeColor: '#241610',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;0,700;1,600&family=Karla:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
