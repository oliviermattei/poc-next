import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Les packages du monorepo sont livrés en TypeScript source, sans étape de build.
  transpilePackages: ['@repo/config', '@repo/db'],
  // Le pilote PostgreSQL reste externe au bundle serveur.
  serverExternalPackages: ['pg'],
}

export default nextConfig
