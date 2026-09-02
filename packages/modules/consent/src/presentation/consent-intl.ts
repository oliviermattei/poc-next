/**
 * Ce que la présentation du module a besoin de savoir de la langue.
 *
 * Deux fonctions, et rien d'autre — la même forme que `MarketingIntl` : le
 * module ne connaît ni `next-intl`, ni le cookie de langue, ni le préfixe de
 * locale, et sa présentation reste rendable dans un test sans démarrer quoi que
 * ce soit.
 */
export interface ConsentIntl {
  /** Traduit une clé qualifiée. Lève si elle manque — jamais de repli (s09). */
  readonly t: (key: string) => string
  /** L'URL publique d'un chemin interne, dans la langue servie. */
  readonly path: (pathname: string) => string
}
