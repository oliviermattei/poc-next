/**
 * Ce que la présentation du module a besoin de savoir de la langue.
 *
 * Deux fonctions, comme `BlogIntl` (s29) et `MarketingIntl` (s10) : le module ne
 * connaît ni `next-intl`, ni le cookie de langue, ni le préfixe de locale. Sa
 * présentation se rend donc dans un test sans démarrer quoi que ce soit, et elle
 * ne porte aucune branche « si l'i18n existe » — `path` est l'identité quand le
 * module `i18n` est coupé.
 */
export interface ChangelogIntl {
  /** Traduit une clé qualifiée. Lève si elle manque — jamais de repli (s09). */
  readonly t: (key: string, values?: Readonly<Record<string, string | number>>) => string
  /** L'URL publique d'un chemin interne, dans la langue servie. */
  readonly path: (pathname: string) => string
}
