/**
 * Ce que la présentation du back-office a besoin de savoir de la langue.
 *
 * Une seule fonction, comme dans `organizations` : traduire une clé
 * **qualifiée**. Elle vient du même appel côté application
 * (`apps/web/lib/i18n.ts`) que celui des autres écrans, et sa forme ne change
 * pas quand le module `i18n` est coupé.
 *
 * Le module ne connaît donc ni `next-intl`, ni le cookie de langue, ni le
 * préfixe de locale — ce qui rend ses écrans rendables dans un test sans
 * démarrer quoi que ce soit.
 */
export interface AdminIntl {
  /**
   * Traduit une clé qualifiée. Lève si elle manque — jamais de repli (s09).
   *
   * `values` interpole les clés à paramètre : « Révoquer la session de {device} ».
   * Le paramètre est ce qui donne un nom accessible **distinct** à chaque bouton
   * de ligne — quatre boutons « Révoquer » sont indiscernables au clavier comme
   * pour une aide technique.
   */
  readonly t: (key: string, values?: Readonly<Record<string, string>>) => string
  /**
   * Met un chemin **interne** dans sa forme publique.
   *
   * Le back-office construit des liens (`/admin/users/<id>`, une page de
   * pagination) : sans cette fonction, ils perdraient le préfixe de langue et
   * chaque clic sortirait de la locale servie. Module `i18n` coupé, c'est
   * l'identité — et cet écran ne le sait pas.
   */
  readonly path: (pathname: string) => string
  /**
   * Formate une date dans la langue servie.
   *
   * Fournie par l'application plutôt que calculée ici : le module ne connaît pas
   * la locale, et `toLocaleDateString()` sans locale explicite rend une valeur
   * qui dépend du fuseau du **serveur** — donc un rendu différent entre deux
   * instances.
   */
  readonly date: (value: Date) => string
}
