/**
 * Plan de site et politique des robots — deux fonctions pures.
 *
 * Elles vivent dans le `domain` parce qu'elles ne dépendent de rien : elles
 * reçoivent les chemins publics, les langues servies et **une façon de
 * construire une URL absolue**. Elles ne connaissent ni Next, ni le module
 * `i18n`, ni `APP_URL` — c'est le point de composition qui les fournit, et
 * c'est ce qui les rend éprouvables sans démarrer quoi que ce soit.
 *
 * Le critère qu'elles portent : « module non activé, `sitemap.xml` ne référence
 * rien ». Ce n'est pas une branche à écrire, c'est la conséquence d'une liste
 * de chemins vide.
 */

export interface SitemapEntry {
  /** L'URL canonique, dans la langue par défaut du site. */
  readonly url: string
  /** La même page dans chaque langue servie, indexée par code de langue. */
  readonly alternates: Readonly<Record<string, string>>
}

export interface SitemapInput {
  readonly paths: readonly string[]
  readonly locales: readonly string[]
  readonly defaultLocale: string
  /** L'URL absolue d'un chemin interne dans une langue. */
  readonly url: (pathname: string, locale: string) => string
}

export function marketingSitemapEntries(input: SitemapInput): readonly SitemapEntry[] {
  return input.paths.map((pathname) => ({
    url: input.url(pathname, input.defaultLocale),
    alternates: Object.fromEntries(
      input.locales.map((locale) => [locale, input.url(pathname, locale)]),
    ),
  }))
}

export interface RobotsPolicy {
  readonly rules: {
    readonly userAgent: string
    readonly allow?: readonly string[]
    readonly disallow: readonly string[]
  }
  readonly sitemap?: string
}

export interface RobotsInput {
  /** Les URL publiques, telles qu'un robot les verrait. */
  readonly allowed: readonly string[]
  readonly sitemapUrl: string
}

/**
 * Le motif qui n'autorise **que** ce chemin, et rien de ce qui s'ouvre en
 * dessous.
 *
 * Un `robots.txt` se lit **par préfixe** (RFC 9309 §2.2.2) : `Allow: /fr`
 * autorise `/fr/account`, `/fr/sign-in` et `/fr/reset-password?token=…`, et il
 * l'emporte sur `Disallow: /` parce qu'il est plus long. Autrement dit, écrire
 * le chemin public tel quel ouvre toute l'application sous son préfixe —
 * l'inverse exact de ce que cette politique annonce, et un jeton de
 * réinitialisation dans un index public est une fuite.
 *
 * Le `$` est l'ancre de fin de motif, l'un des deux caractères spéciaux que
 * RFC 9309 §2.2.3 impose aux robots de comprendre. Le prix assumé : `/fr/` et
 * `/fr?utm_source=…` ne sont pas autorisés non plus. Ce sont des variantes de
 * la page canonique, que le plan de site n'annonce pas.
 */
const exactly = (pathname: string): string => `${pathname}$`

/**
 * Ce qu'un robot a le droit d'explorer.
 *
 * **Interdire d'abord, autoriser ensuite ce qui est public** : l'inverse —
 * `Allow: /` avec quelques exclusions — laisserait indexer chaque écran ajouté
 * par une story suivante sans que personne ne le décide. Les écrans applicatifs
 * refusent déjà l'accès côté serveur ; les faire figurer dans un index public
 * n'en reste pas moins une divulgation gratuite de la surface de
 * l'application (`docs/security.md` §7).
 *
 * Aucun chemin public — module coupé : tout est interdit, et **aucun plan de
 * site n'est annoncé**. Annoncer un `sitemap.xml` vide reviendrait à publier
 * une adresse qui ne référence rien.
 */
export function marketingRobotsPolicy(input: RobotsInput): RobotsPolicy {
  if (input.allowed.length === 0) {
    return { rules: { userAgent: '*', disallow: ['/'] } }
  }

  return {
    rules: { userAgent: '*', allow: input.allowed.map(exactly), disallow: ['/'] },
    sitemap: input.sitemapUrl,
  }
}

/** Un motif de `robots.txt`, tel que RFC 9309 §2.2.3 le définit : `*` et `$`. */
const patternMatcher = (pattern: string): RegExp => {
  const anchored = pattern.endsWith('$')
  const body = anchored ? pattern.slice(0, -1) : pattern
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')

  return new RegExp(`^${escaped}${anchored ? '$' : ''}`)
}

/** La longueur du motif le plus long qui corresponde, ou `-1` si aucun ne correspond. */
const longestMatch = (patterns: readonly string[], pathname: string): number =>
  patterns
    .filter((pattern) => patternMatcher(pattern).test(pathname))
    .reduce((longest, pattern) => Math.max(longest, pattern.length), -1)

/**
 * Ce qu'une politique **veut dire**, lue comme un robot la lit.
 *
 * Sans cette lecture, la politique ne peut être éprouvée que sur sa forme —
 * « la liste `allow` contient ce que j'y ai mis » —, et c'est exactement ce qui
 * a laissé passer un `Allow: /fr` ouvrant toute l'application : le test
 * affirmait le défaut. La règle de RFC 9309 §2.2.2 est ici : le motif le plus
 * long l'emporte, l'autorisation gagne à égalité, et ce qu'aucune règle ne
 * couvre est autorisé par défaut.
 *
 * C'est `tests/marketing.test.ts` qui la confronte aux écrans réels de
 * l'application, et `e2e/marketing.spec.ts` au fichier réellement servi.
 */
export function robotsAllows(policy: RobotsPolicy, pathname: string): boolean {
  return (
    longestMatch(policy.rules.allow ?? [], pathname) >=
    longestMatch(policy.rules.disallow, pathname)
  )
}
