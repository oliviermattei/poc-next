/**
 * Ce que la présentation du module a besoin de savoir de la langue.
 *
 * Deux fonctions, et rien d'autre : traduire une clé **qualifiée**, et mettre un
 * chemin interne dans sa forme publique. Elles viennent du même appel côté
 * application (`apps/web/lib/i18n.ts`), et leur forme ne change pas quand le
 * module `i18n` est coupé — `path` est alors l'identité.
 *
 * Le module ne connaît donc ni `next-intl`, ni le cookie de langue, ni le
 * préfixe de locale : c'est ce qui lui évite de porter une branche
 * « si l'i18n existe », et ce qui rend sa présentation rendable dans un test
 * sans démarrer quoi que ce soit.
 */
export interface MarketingIntl {
  /** Traduit une clé qualifiée. Lève si elle manque — jamais de repli (s09). */
  readonly t: (key: string) => string
  /** L'URL publique d'un chemin interne, dans la langue servie. */
  readonly path: (pathname: string) => string
}
