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

export function Pagination({
  page,
  pageCount,
  hrefFor,
  label,
  previousLabel,
  nextLabel,
  pageLabel,
}: PaginationProps) {
  const pages = Array.from({ length: pageCount }, (_unused, index) => index + 1)

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
