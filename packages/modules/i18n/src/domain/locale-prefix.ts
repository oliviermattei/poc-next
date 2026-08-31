/**
 * Le préfixe de locale dans un chemin, et rien d'autre.
 *
 * Couche `domain` : aucune connaissance de Next, de la requête ou du cookie.
 * Ce sont des fonctions de chaîne, éprouvables sans rien démarrer — et c'est
 * exactement ce qui manquait pour décider de la forme des URL avant d'écrire
 * (le piège central de la story).
 */

export interface SplitPath {
  /** La locale lue dans le premier segment, ou `null` s'il n'en porte pas. */
  readonly locale: string | null
  /** Le chemin **interne**, préfixe retiré. Toujours commençant par `/`. */
  readonly pathname: string
}

/** Normalise un chemin : une barre de tête, aucune barre finale sauf la racine. */
const normalize = (pathname: string): string => {
  const withLeading = pathname.startsWith('/') ? pathname : `/${pathname}`
  const withoutTrailing = withLeading.replace(/\/+$/, '')

  return withoutTrailing === '' ? '/' : withoutTrailing
}

/**
 * Sépare le préfixe de locale du reste du chemin.
 *
 * Le premier segment n'est une locale que s'il est **livré** : sans cette
 * condition, `/account` ferait de « account » une locale, et le segment
 * jouerait le rôle d'attrape-tout que la documentation de `next-intl` décrit
 * comme le piège du segment `[locale]`.
 */
export function splitLocalePrefix(pathname: string, locales: readonly string[]): SplitPath {
  const normalized = normalize(pathname)
  const [, first = '', ...rest] = normalized.split('/')

  if (!locales.includes(first)) {
    return { locale: null, pathname: normalized }
  }

  return { locale: first, pathname: normalize(`/${rest.join('/')}`) }
}

/** Le chemin public d'un chemin interne, dans une locale. */
export function withLocalePrefix(pathname: string, locale: string): string {
  const normalized = normalize(pathname)

  return normalized === '/' ? `/${locale}` : `/${locale}${normalized}`
}

/**
 * La meilleure locale livrée d'un en-tête `Accept-Language`, ou `null`.
 *
 * Volontairement grossier : seule la **langue** est comparée (`fr-CA` compte
 * pour `fr`), et les qualités sont respectées. Une bibliothèque de négociation
 * complète serait une dépendance de plus pour un choix que le cookie remplace
 * dès la première visite.
 */
export function preferredLocale(
  acceptLanguage: string | null,
  locales: readonly string[],
): string | null {
  if (acceptLanguage === null) {
    return null
  }

  const ranked = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag = '', ...parameters] = part.trim().split(';')
      const quality = parameters
        .map((parameter) => /^\s*q=([0-9.]+)\s*$/.exec(parameter)?.[1])
        .find((value) => value !== undefined)

      return { tag: tag.trim().toLowerCase(), quality: Number(quality ?? '1') }
    })
    .filter((entry) => entry.tag !== '' && Number.isFinite(entry.quality))
    .sort((left, right) => right.quality - left.quality)

  for (const { tag } of ranked) {
    const language = tag.split('-')[0] ?? ''
    const match = locales.find((locale) => locale === tag || locale === language)

    if (match !== undefined) {
      return match
    }
  }

  return null
}
