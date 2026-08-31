import { assertStartupEnv } from '@repo/config'
import { loadRootEnv } from '@repo/config/server'
import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

import { resolveAuthConfig } from './lib/auth-config'
import { resolveMailerConfig } from './lib/mailer-config'

// Next ne lit les fichiers `.env` que dans le dossier de l'application. Le dépôt
// n'en a qu'un, à la racine — celui que `.env.example` demande de copier. Sans
// ce chargement explicite, `pnpm dev` démarre sans `DATABASE_URL` et
// `/api/health` répond 503 pour toujours.
loadRootEnv()

const nextConfig: NextConfig = {
  // Les packages du monorepo sont livrés en TypeScript source, sans étape de build.
  transpilePackages: [
    '@repo/config',
    '@repo/core',
    '@repo/db',
    '@repo/module-auth',
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
 * C'est le seul point traversé par `next dev` comme par `next start` avant que
 * le serveur n'accepte une requête : y valider l'environnement fait échouer le
 * démarrage sur une variable absente ou malformée, en la nommant, au lieu de
 * servir une application qui a l'air de marcher jusqu'au premier appel de la
 * sonde. Next abandonne le démarrage quand le chargement de ce fichier lève.
 *
 * La phase arrive en argument : pendant `next build`, la validation est sautée,
 * les variables d'exécution pouvant manquer. `NEXT_PHASE` n'est posée dans
 * l'environnement que plus tard dans le build, jamais à la lecture d'ici.
 *
 * Le **choix du mailer** est vérifié ici aussi, et seulement ici : cette
 * application est ce qui monte un mailer. Le schéma d'environnement ne l'exige
 * de personne — un conteneur de migration muni du seul `DATABASE_URL` doit
 * s'exécuter (revue de s06, G3) — mais l'application, elle, refuse de démarrer
 * sans avoir dit ce qu'elle fait de ses emails. `assertStartupEnv` ne rend
 * l'environnement que lorsqu'il a été validé : les échappatoires du build sont
 * héritées, jamais redéclarées.
 */
export default function config(phase: string): NextConfig {
  const env = assertStartupEnv({ phase })

  if (env !== undefined) {
    resolveMailerConfig(env)
    // Même règle pour l'authentification : cette application refuse de démarrer
    // sans secret de session ni URL publique, plutôt que de servir des liens de
    // vérification qui ne mènent nulle part.
    resolveAuthConfig(env)
  }

  return withNextIntl(nextConfig)
}
