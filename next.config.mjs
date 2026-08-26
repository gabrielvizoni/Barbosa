/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // better-sqlite3 é um módulo nativo: não deve ser empacotado pelo bundler.
  webpack: (config) => {
    config.externals = [...(config.externals || []), 'better-sqlite3'];
    return config;
  },
  // Os headers de segurança (CSP incluída) ficam em middleware.js — a CSP
  // precisa de um nonce novo por requisição, que headers() aqui não permite.
};

export default nextConfig;
