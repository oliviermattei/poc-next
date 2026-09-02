import { assertStartupEnv } from '@repo/config'
import { loadRootEnv } from '@repo/config/server'
import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

import { enabledModules } from '../../config/features'
import { resolveAuthConfig } from './lib/auth-config'
import { billingCatalogue } from './lib/billing-catalogue'
import { resolveBillingConfig } from './lib/billing-config'
import { assertFeatureGates } from './lib/feature-gates'
import { resolveMailerConfig } from './lib/mailer-config'
import { resolveOAuthConfig } from './lib/oauth-config'
import { resolveStorageConfig } from './lib/storage-config'

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

/** Le module de facturation est-il activé ? La configuration décide, pas un `if` épars. */
const billingEnabled = (enabledModules as readonly string[]).includes('billing')

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

  // **Le catalogue d'offres, avant tout le reste et sans condition de phase.**
  //
  // Il ne lit **aucune** variable : c'est du code, pas de l'environnement. Les
  // deux échappatoires qui suivent — la phase de build et `SKIP_ENV_VALIDATION`
  // — existent pour des variables d'exécution absentes, et rien ne justifie
  // qu'un artefact se construise sur une configuration que le démarrage
  // refusera. Sans cet appel, une offre malformée ne se voyait qu'à la première
  // requête qui construisait le service — et cette requête pouvait être le
  // webhook public, qui répondait alors 500 (constat F2 de la revue de s19).
  //
  // Comme la garde du paiement, elle ne vaut que si le module est activé : un
  // projet qui ne vend rien n'a pas de catalogue à tenir.
  if (billingEnabled) {
    billingCatalogue()
  }

  // **Les fonctionnalités réservées aux offres payantes** (s21, ADR 043), et
  // pour la même raison, sans condition de phase : deux fichiers de
  // configuration, aucune variable d'environnement.
  //
  // Deux fautes y sont refusées, et elles ne se ressemblent pas : une
  // fonctionnalité qui nomme une offre absente du catalogue serait fermée pour
  // toujours à qui a payé ; une route qui réserve une fonctionnalité que
  // `config/gating.ts` ne déclare pas serait refusée à **tout le monde**, en
  // silence — l'inverse exact du trou de s17, où une action absente de la
  // matrice n'était refusée par personne.
  //
  // La garde vaut dans les **deux** configurations de modules : couper la
  // facturation retire seulement la confrontation au catalogue, qui n'aurait
  // alors plus de sens.
  assertFeatureGates()

  if (env !== undefined) {
    resolveMailerConfig(env)
    // Même règle pour l'authentification : cette application refuse de démarrer
    // sans secret de session ni URL publique, plutôt que de servir des liens de
    // vérification qui ne mènent nulle part.
    resolveAuthConfig(env)
    // Et pour les fournisseurs externes : **aucun** est un état valide — les
    // boutons disparaissent —, mais une paire à moitié renseignée arrête le
    // démarrage en nommant la variable absente, plutôt que d'échouer au premier
    // clic en production (`docs/security.md` §5).
    resolveOAuthConfig(env)
    // Et pour le stockage — **mais seulement si le module est activé**. C'est
    // la différence avec les trois précédents : le mailer et l'authentification
    // sont exigés de toute application qui démarre, le stockage ne l'est que
    // d'une application qui en a un. Un dépôt qui coupe le module n'a aucune
    // variable à renseigner (critère 7 de s18), et la liste est lue dans
    // `config/features.ts` plutôt que dans le registre : la question est « ce
    // module est-il activé ? », pas « le registre est-il cohérent ? », et
    // construire le registre ici chargerait chaque module pour y répondre.
    if ((enabledModules as readonly string[]).includes('storage')) {
      resolveStorageConfig(env)
    }

    // **Et pour le paiement — mais seulement si le module est activé.** Un
    // projet qui ne vend rien n'a pas à configurer un fournisseur de paiement,
    // et c'est la seule des quatre gardes qui dépende de la configuration des
    // modules. Sans clé et sans drapeau, l'application refuse de démarrer en
    // nommant les trois variables : `docs/reliability.md` §2 interdit le repli
    // silencieux, qui accorderait ici des abonnements que personne n'a payés.
    if (billingEnabled) {
      resolveBillingConfig(env)
    }
  }

  return withNextIntl(nextConfig)
}
