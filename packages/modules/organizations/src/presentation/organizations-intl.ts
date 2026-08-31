/**
 * Ce que la présentation du module a besoin de savoir de la langue.
 *
 * Une seule fonction : traduire une clé **qualifiée**. Elle vient du même appel
 * côté application (`apps/web/lib/i18n.ts`) que celui des autres écrans, et sa
 * forme ne change pas quand le module `i18n` est coupé.
 *
 * Le module ne connaît donc ni `next-intl`, ni le cookie de langue, ni le
 * préfixe de locale — ce qui rend sa présentation rendable dans un test sans
 * démarrer quoi que ce soit.
 */
export interface OrganizationsIntl {
  /**
   * Traduit une clé qualifiée. Lève si elle manque — jamais de repli (s09).
   *
   * `values` interpole les clés à paramètre (s16) : « Retirer {email} ». Le
   * paramètre est ce qui donne un nom accessible **distinct** à chaque bouton de
   * ligne — quatre boutons « Retirer » sont indiscernables au clavier comme pour
   * une aide technique. Composer la phrase dans le `.tsx` produirait au
   * contraire un fragment concaténé, invisible aux catalogues.
   */
  readonly t: (key: string, values?: Readonly<Record<string, string>>) => string
}
