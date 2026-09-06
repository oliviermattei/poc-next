import createMDX from '@next/mdx'
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
  /**
   * **Les cartes source du navigateur** (s39, critère 1).
   *
   * Sans elles, une erreur client arrive minifiée chez le fournisseur : la
   * « trace lisible » que le critère demande n'existe alors nulle part. Les
   * générer ne suffit pas — il faut les **envoyer** et **ne pas les servir**,
   * et c'est `pnpm sourcemaps:release` qui fait les deux dans cet ordre.
   *
   * **Conséquence à connaître avant d'y toucher** : activées, les cartes
   * atterrissent dans `.next/static`, que le serveur sert sous `/_next/static`.
   * Un build livré sans élagage exposerait donc le code source du produit. Le
   * `Dockerfile` appelle `pnpm sourcemaps:prune` pour cette raison, et
   * `tests/analytics.test.ts` refuse un `Dockerfile` qui ne l'appellerait plus.
   */
  productionBrowserSourceMaps: true,
  // Les packages du monorepo sont livrés en TypeScript source, sans étape de build.
  transpilePackages: [
    '@repo/config',
    '@repo/core',
    '@repo/db',
    '@repo/module-auth',
    '@repo/module-billing',
    '@repo/module-blog',
    '@repo/module-demo-disabled',
    '@repo/module-demo-enabled',
    '@repo/module-i18n',
    '@repo/module-marketing',
  ],
  // Le pilote PostgreSQL reste externe au bundle serveur.
  serverExternalPackages: ['pg'],
  /**
   * Le dossier des articles, embarqué dans la sortie autonome (s29).
   *
   * Le **corps** d'un article est compilé par le bundler, donc tracé tout seul.
   * Son **en-tête**, lui, est lu par `node:fs` à l'amorçage du serveur
   * (`apps/web/lib/blog.ts`).
   *
   * **Ce qui a été mesuré, plutôt que déduit** : retirer ces deux lignes ne
   * change rien aujourd'hui. Les cinq `.mdx` sont toujours dans
   * `.next/standalone/content/blog/` après un `pnpm build` complet sans elles,
   * parce que `resolve(process.cwd(), …)` (`lib/blog.ts:48`) fait tracer **le
   * projet entier** — le build l'annonce lui-même (« Dynamic filesystem access
   * causes tracing of the whole project »). C'est donc une **assurance dont
   * l'effet est masqué**, pas une garantie observable, et **aucun test ne la
   * surveille** : aucun ne le peut tant que son retrait ne change rien. Elle
   * deviendra porteuse le jour où ce traçage large sera resserré (ADR 053,
   * « À surveiller »).
   *
   * **La documentation (s30) est déclarée aux mêmes conditions**, y compris ses
   * `section.json` — eux aussi lus par `node:fs` à l'amorçage, et eux seuls ne
   * seraient couverts par aucun motif `.mdx`. Le même avertissement de traçage
   * est émis pour `lib/docs.ts`, donc la même remarque vaut : l'effet est
   * masqué aujourd'hui, la déclaration ne l'est pas.
   *
   * **Les nouveautés (s31) sont déclarées aux mêmes conditions** : leur en-tête
   * est lu par `node:fs` à l'amorçage (`lib/changelog.ts`), leur corps est
   * compilé par le bundler. Même assurance, même effet masqué aujourd'hui.
   */
  outputFileTracingIncludes: {
    '/blog': ['../../content/blog/**/*.mdx'],
    '/blog/[slug]': ['../../content/blog/**/*.mdx'],
    '/docs': ['../../content/docs/**/*.mdx', '../../content/docs/**/section.json'],
    '/docs/[section]/[page]': [
      '../../content/docs/**/*.mdx',
      '../../content/docs/**/section.json',
    ],
    '/changelog': ['../../content/changelog/**/*.mdx'],
  },
}

/**
 * Le greffon de `next-intl` ne fait **qu'une** chose, vérifiée dans le paquet
 * installé (4.14.1) : aliaser `next-intl/config` vers `./i18n/request.ts`. Il
 * n'impose ni segment `[locale]`, ni middleware, ni forme d'URL — sans quoi le
 * critère « module coupé, routes sans préfixe » serait inatteignable.
 */
const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

/**
 * Le compilateur MDX (ADR 053) : **au build, jamais à l'exécution**.
 *
 * `remark-frontmatter` retire le bloc `---` du corps rendu. Sans lui, MDX en
 * ferait un trait horizontal suivi du YAML en texte : l'en-tête s'afficherait
 * en haut de chaque article.
 *
 * Les greffons sont nommés par **chaîne** : sous Turbopack, la configuration
 * des règles de loader est sérialisée, et une fonction importée ne s'y
 * transporte pas.
 */
const withMDX = createMDX({
  options: { remarkPlugins: [['remark-frontmatter', ['yaml']]] },
})

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

  return withMDX(withNextIntl(nextConfig))
}
