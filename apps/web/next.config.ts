import { loadRootEnv } from '@repo/config'
import type { NextConfig } from 'next'

// Next ne lit les fichiers `.env` que dans le dossier de l'application. Le dépôt
// n'en a qu'un, à la racine — celui que `.env.example` demande de copier. Sans
// ce chargement explicite, `pnpm dev` démarre sans `DATABASE_URL` et
// `/api/health` répond 503 pour toujours.
loadRootEnv()

const nextConfig: NextConfig = {
  // Les packages du monorepo sont livrés en TypeScript source, sans étape de build.
  transpilePackages: ['@repo/config', '@repo/db'],
  // Le pilote PostgreSQL reste externe au bundle serveur.
  serverExternalPackages: ['pg'],
}

export default nextConfig
