import { getEnv, type Env } from '@repo/config'

/**
 * L'URL publique du site, pour ce qui a besoin d'une adresse **absolue**.
 *
 * Le plan de site et le `robots.txt` en sont les seuls consommateurs
 * aujourd'hui : un `sitemap.xml` est une liste d'URL absolues, un chemin
 * relatif n'y veut rien dire.
 *
 * Même forme que `lib/auth-config.ts` et `lib/mailer-config.ts`, et pour la même
 * raison : la **règle** — cette variable est exigée par qui en a besoin —
 * est séparée de ce qui la consomme. `APP_URL` reste optionnelle au schéma
 * d'environnement, parce que `pnpm db:migrate` n'a aucune URL publique à
 * connaître (revue de s06, G3).
 *
 * Elle n'est pas déduite de l'en-tête `Host` : un attaquant le contrôle, et un
 * plan de site qui pointerait vers son domaine ferait indexer ses pages sous
 * notre nom. C'est la même règle que pour les liens envoyés par email.
 */
export function resolveSiteUrl(env: Env = getEnv()): string {
  const declared = env.APP_URL?.trim()

  if (declared === undefined || declared === '') {
    throw new Error(
      'APP_URL n’est pas renseignée : impossible de construire le plan de site ni le ' +
        'robots.txt, qui exigent des URL absolues. Renseignez l’URL publique de ' +
        'l’application (« https://app.example.com »).',
    )
  }

  // Sans normalisation, une valeur terminée par « / » produit « https://site//legal/… ».
  return declared.replace(/\/+$/, '')
}

/**
 * L'URL absolue d'un chemin déjà mis dans sa forme publique.
 *
 * La racine ne devient pas « https://site/ » mais « https://site » : deux
 * écritures de la même page dans un plan de site sont deux URL pour un moteur.
 */
export const absoluteUrl = (pathname: string, siteUrl: string): string =>
  `${siteUrl}${pathname === '/' ? '' : pathname}`

/**
 * L'origine contre laquelle Next rend les URL de métadonnées absolues.
 *
 * **Elle ne lève jamais**, et c'est toute la différence avec `resolveSiteUrl` :
 * elle est lue par `app/layout.tsx`, donc sur **chaque** écran et pendant
 * `next build`, où `getEnv()` ne valide rien et où l'intégration continue ne
 * pose aucune `APP_URL`. Un plan de site sans URL absolue est une erreur qu'il
 * faut crier ; une page qui refuserait de se rendre faute d'`APP_URL` serait
 * une panne totale pour une balise de partage.
 *
 * `null` rend la main à Next, qui retombe alors sur son origine de
 * développement en le journalisant. En production, `APP_URL` est exigée au
 * démarrage (`lib/startup.ts`) : le cas ne s'y présente pas.
 *
 * Ce qu'elle rend possible : écrire `/og-default.png` ou `/fr/blog/x` dans les
 * métadonnées et laisser Next les rendre absolues, plutôt que de lire
 * l'environnement au milieu d'un rendu.
 */
export function metadataBaseUrl(env: Env = getEnv()): URL | null {
  const declared = env.APP_URL?.trim()

  if (declared === undefined || declared === '') {
    return null
  }

  try {
    return new URL(declared)
  } catch {
    // Une valeur malformée est refusée au démarrage, en la nommant : ici, elle
    // ne doit pas faire tomber le rendu de chaque écran.
    return null
  }
}
