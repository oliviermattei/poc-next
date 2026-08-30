import { assertStartupEnv } from '@repo/config'
import { loadRootEnv } from '@repo/config/server'
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

/**
 * Configuration exportée en fonction, et non en objet, pour recevoir la phase.
 *
 * C'est le seul point traversé par `next dev` comme par `next start` avant que
 * le serveur n'accepte une requête : y valider l'environnement fait échouer le
 * démarrage sur une variable absente ou malformée, en la nommant, au lieu de
 * servir une application qui a l'air de marcher jusqu'au premier appel de la
 * sonde. Next abandonne le démarrage quand le chargement de ce fichier lève.
 *
 * La phase arrive en argument : pendant `next build`, la validation est sautée,
 * les variables d'exécution pouvant manquer. `NEXT_PHASE` n'est posée dans
 * l'environnement que plus tard dans le build, jamais à la lecture d'ici.
 */
export default function config(phase: string): NextConfig {
  assertStartupEnv({ phase })

  return nextConfig
}
