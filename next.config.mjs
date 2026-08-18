/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // better-sqlite3 é um módulo nativo: não deve ser empacotado pelo bundler.
  webpack: (config) => {
    config.externals = [...(config.externals || []), 'better-sqlite3'];
    return config;
  },
};

export default nextConfig;
