import { loadRootEnv } from '@repo/config/server'
import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

import { assertStartupConfiguration } from './lib/startup'

// Next ne lit les fichiers `.env` que dans le dossier de l'application. Le dépôt
// n'en a qu'un, à la racine — celui que `.env.example` demande de copier. Sans
// ce chargement explicite, `pnpm dev` démarre sans `DATABASE_URL` et
// `/api/health` répond 503 pour toujours.
loadRootEnv()

const nextConfig: NextConfig = {
  // **La sortie autonome**, celle que l'image de production embarque (s27).
  //
  // Next trace les fichiers réellement atteints et les recopie dans
  // `.next/standalone`, avec un `server.js` qui n'a plus besoin ni de `next`,
  // ni de pnpm, ni du dépôt. Sans elle, une image Docker devrait embarquer tout
  // `node_modules` d'un monorepo pnpm — c'est-à-dire l'essentiel du dépôt, ses
  // outils de build et ses dépendances de développement comprises.
  //
  // Elle ne change rien à `next dev` : c'est une sortie de build.
  output: 'standalone',
  // Les packages du monorepo sont livrés en TypeScript source, sans étape de build.
  transpilePackages: [
    '@repo/config',
    '@repo/core',
    '@repo/db',
    '@repo/module-auth',
    '@repo/module-billing',
    '@repo/module-demo-disabled',
    '@repo/module-demo-enabled',
    '@repo/module-i18n',
    '@repo/module-marketing',
  ],
  // Le pilote PostgreSQL reste externe au bundle serveur.
  serverExternalPackages: ['pg'],
}

/**
 * Le greffon de `next-intl` ne fait **qu'une** chose, vérifiée dans le paquet
 * installé (4.14.1) : aliaser `next-intl/config` vers `./i18n/request.ts`. Il
 * n'impose ni segment `[locale]`, ni middleware, ni forme d'URL — sans quoi le
 * critère « module coupé, routes sans préfixe » serait inatteignable.
 */
const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

/**
 * Configuration exportée en fonction, et non en objet, pour recevoir la phase.
 *
 * C'est le point que `next dev` et `next build` traversent avant tout le reste :
 * y valider la configuration fait échouer le démarrage sur une variable absente
 * ou malformée, en la nommant, au lieu de servir une application qui a l'air de
 * marcher jusqu'au premier appel de la sonde. Next abandonne le démarrage quand
 * le chargement de ce fichier lève.
 *
 * La phase arrive en argument : pendant `next build`, la validation est sautée,
 * les variables d'exécution pouvant manquer. `NEXT_PHASE` n'est posée dans
 * l'environnement que plus tard dans le build, jamais à la lecture d'ici.
 *
 * **Ce n'est pas le seul point de démarrage, et depuis s27 ce n'est plus celui
 * qui compte en production** : `output: 'standalone'` sérialise cette
 * configuration dans `server.js`, et ce fichier n'est alors plus exécuté au
 * démarrage du serveur. `instrumentation.ts` est le point que la sortie
 * autonome atteint. Les deux appellent la même garde, `assertStartupConfiguration`.
 */
export default function config(phase: string): NextConfig {
  assertStartupConfiguration({ phase })

  return withNextIntl(nextConfig)
}
