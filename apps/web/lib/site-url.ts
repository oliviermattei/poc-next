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
