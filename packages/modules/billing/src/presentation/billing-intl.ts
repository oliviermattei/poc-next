/**
 * Ce que la présentation du module a besoin de savoir de la langue.
 *
 * Une seule fonction : traduire une clé **qualifiée**, avec ses paramètres. Elle
 * vient du même appel côté application (`apps/web/lib/i18n.ts`) que celui des
 * autres écrans, et sa forme ne change pas quand le module `i18n` est coupé.
 *
 * Le module ne connaît donc ni `next-intl`, ni le cookie de langue, ni le
 * préfixe de locale — ce qui rend sa présentation rendable dans un test sans
 * démarrer quoi que ce soit.
 */
export interface BillingIntl {
  /** Traduit une clé qualifiée. Lève si elle manque — jamais de repli (s09). */
  readonly t: (key: string, values?: Readonly<Record<string, string | number>>) => string
  /**
   * Formate une date, dans la langue servie.
   *
   * Injecté plutôt que fait ici : le module ne décide pas du fuseau ni du style,
   * et un `Intl.DateTimeFormat` construit dans un composant serveur retomberait
   * sur le fuseau de la machine — ce qui fait diverger le rendu serveur et
   * client, et rend un test dépendant de l'endroit où il tourne.
   */
  readonly formatDate: (date: Date) => string
}
