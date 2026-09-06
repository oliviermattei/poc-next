import {
  changelogReleases,
  type ChangelogEntry,
  type ChangelogRelease,
} from '../domain/changelog-entry'

/** Le chemin interne de la page. Écrit une fois, lu par l'écran et par le pied de page. */
export const CHANGELOG_PATH = '/changelog'

/**
 * Ce que le changelog est quand il est monté : un chemin, et rien de plus.
 *
 * `null` sur le catalogue est ce qui remplace une condition « si le module est
 * activé » : la page lit cette donnée, et répond 404 quand elle manque. C'est le
 * motif `EMPTY_MARKETING_SITE` de s10 et `EMPTY_BLOG_CATALOG` de s29, à
 * l'identique.
 */
export interface ChangelogIndex {
  readonly path: string
}

/** Le changelog, tel que l'application le lit — **de forme identique dans les deux états**. */
export interface ChangelogCatalog {
  readonly entries: readonly ChangelogEntry[]
  readonly index: ChangelogIndex | null
}

/** L'état « aucun changelog » : celui du module coupé, écrit une fois. */
export const EMPTY_CHANGELOG_CATALOG: ChangelogCatalog = { entries: [], index: null }

export function resolveChangelogCatalog(input: {
  readonly entries: readonly ChangelogEntry[]
}): ChangelogCatalog {
  return { entries: input.entries, index: { path: CHANGELOG_PATH } }
}

/** Ce qu'un écran affiche, une fois la locale appliquée. */
export interface ChangelogListView {
  readonly releases: readonly ChangelogRelease[]
  /** Le nombre d'entrées retenues, toutes versions confondues. */
  readonly total: number
}

/**
 * La page, filtrée par langue puis groupée par version.
 *
 * Le filtre de locale vient **avant** le regroupement, et c'est le critère
 * i18n : une entrée non traduite n'apparaît pas dans cette langue, et une
 * version qui n'existe que dans l'autre langue n'y produit pas un groupe vide.
 *
 * Aucune pagination : un changelog se lit d'un bout à l'autre, et le découper
 * mettrait les anciennes versions derrière un clic que personne ne fait. C'est
 * aussi ce qui rend le plan de site honnête — **une** URL, celle de la page.
 */
export function changelogListView(
  catalog: ChangelogCatalog,
  query: { readonly locale: string },
): ChangelogListView {
  const local = catalog.entries.filter((entry) => entry.locale === query.locale)

  return { releases: changelogReleases(local), total: local.length }
}
