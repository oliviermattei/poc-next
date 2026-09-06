import { cn } from '../lib/cn'

/**
 * La pagination autonome, hors tableau — l'usage que le design system lui
 * déclare, et exactement le cas d'une grille de cartes (s29).
 *
 * **Des liens, pas des boutons** : chaque page est une URL, donc elle
 * s'ouvre dans un onglet, se copie et s'indexe. Une pagination pilotée par
 * JavaScript ne fait rien de tout cela, et ne fonctionnerait pas avant
 * l'hydratation.
 *
 * La page courante se distingue par la **primaire**, jamais par une couleur
 * sémantique : `s49-contraste-des-alertes` a mesuré que les quatre variantes
 * sémantiques passent sous le seuil WCAG AA en thème clair. Elle porte aussi
 * `aria-current="page"` — la couleur seule ne dit rien à un lecteur d'écran.
 */
export interface PaginationProps {
  readonly page: number
  readonly pageCount: number
  /** L'URL d'une page. L'appelant sait seul comment ses paramètres s'écrivent. */
  readonly hrefFor: (page: number) => string
  /** Nom accessible de la navigation, traduit par l'appelant. */
  readonly label: string
  readonly previousLabel: string
  readonly nextLabel: string
  /** Nom accessible d'un numéro de page, traduit par l'appelant. */
  readonly pageLabel: (page: number) => string
}

/**
 * Le style d'un élément de pagination. Écrit une fois : deux copies
 * divergeraient. `cn(` n'est pas décoratif — c'est l'un des trois contextes où
 * `tests/i18n.test.ts` reconnaît une liste de classes plutôt qu'une phrase.
 */
const ITEM = cn(
  'inline-flex h-10 min-w-10 items-center justify-center rounded-lg border border-border px-3 text-sm',
)

/**
 * **Le nombre maximum d'ancres de page rendues** — impair, pour que la fenêtre
 * se centre.
 *
 * Sept : assez pour voir où l'on est et sauter de quelques pages, assez peu pour
 * tenir sur une ligne sous 400 px.
 */
export const PAGINATION_WINDOW = 7

/**
 * **Les pages à rendre**, bornées (revue de s37b2, constat F4).
 *
 * Ce composant a été écrit pour le blog, qui compte ses pages sur une main, et
 * il rendait **une ancre par page**. Le back-office de s37b2 pagine des listes
 * de plateforme dont le domaine autorise 10 000 pages : la même `<nav>` aurait
 * porté 10 000 ancres — plusieurs centaines de kilo-octets de HTML, un ordre de
 * tabulation impraticable, et une page d'autant plus lourde qu'elle est peu
 * utile.
 *
 * La fenêtre **glisse** plutôt que de sortir du domaine : aux extrémités elle
 * colle au bord en gardant sa taille, si bien que le nombre d'ancres ne dépend
 * pas de la page où l'on se trouve.
 *
 * **Ce qu'elle ne fait pas** : ni ellipse, ni saut à la première ou à la
 * dernière page. Le design system ne décrit aucune des deux formes, et les
 * inventer ici serait décider du design system dans un commit de
 * fonctionnalité — le manque est signalé dans
 * `docs/designs/s37b2-back-office-lecture.md`. Les listes du back-office
 * portent une recherche, qui est le vrai outil de navigation au-delà de
 * quelques pages.
 */
export function paginationWindow(
  page: number,
  pageCount: number,
  size: number = PAGINATION_WINDOW,
): readonly number[] {
  const length = Math.min(Math.max(pageCount, 0), Math.max(size, 1))

  if (length === 0) {
    return []
  }

  // La fenêtre centrée, puis ramenée dans le domaine sans changer de taille.
  const centred = page - Math.floor((length - 1) / 2)
  const first = Math.min(Math.max(centred, 1), pageCount - length + 1)

  return Array.from({ length }, (_unused, index) => first + index)
}

export function Pagination({
  page,
  pageCount,
  hrefFor,
  label,
  previousLabel,
  nextLabel,
  pageLabel,
}: PaginationProps) {
  const pages = paginationWindow(page, pageCount)

  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-center gap-1">
      {page > 1 ? (
        <a href={hrefFor(page - 1)} aria-label={previousLabel} className={ITEM}>
          <span aria-hidden>‹</span>
        </a>
      ) : null}
      {pages.map((candidate) => (
        <a
          key={candidate}
          href={hrefFor(candidate)}
          aria-label={pageLabel(candidate)}
          aria-current={candidate === page ? 'page' : undefined}
          className={cn(
            ITEM,
            candidate === page && 'border-primary bg-primary text-primary-foreground',
          )}
        >
          {candidate}
        </a>
      ))}
      {page < pageCount ? (
        <a href={hrefFor(page + 1)} aria-label={nextLabel} className={ITEM}>
          <span aria-hidden>›</span>
        </a>
      ) : null}
    </nav>
  )
}
