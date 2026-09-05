import { ChevronRightIcon } from 'lucide-react'
import type { ComponentProps } from 'react'

import { cn } from '../lib/cn'

/**
 * Le fil d'Ariane — « du back-office et de la documentation », dit
 * `docs/design-system.md`.
 *
 * **Copié depuis shadcn/ui**, comme s29 l'a fait pour `Pagination` : il était
 * déclaré par le document et absent de ce baril. Copier n'est pas inventer.
 *
 * Trois écarts avec la copie amont, et chacun a sa raison :
 *
 * 1. **`label` est obligatoire.** La version amont écrit
 *    `aria-label="breadcrumb"` en dur ; ce package ne connaît ni catalogue ni
 *    locale, et son `AGENTS.md` en fait une règle exécutable — `tests/i18n.test.ts`
 *    balaie ses `.tsx`, et **un mot suffit**.
 * 2. **`BreadcrumbEllipsis` n'est pas copié.** Il porte un « More » en dur et
 *    aucun écran ne le replie : `packages/ui/AGENTS.md` refuse de livrer du code
 *    que personne n'exerce.
 * 3. **Le séparateur est un `<li aria-hidden>`**, pas un nœud de texte : il ne
 *    doit pas être lu entre deux entrées.
 *
 * La page courante est un `<span aria-current="page">` et **pas un lien** : un
 * lien vers la page qu'on lit déjà est une promesse vide, et `aria-current`
 * porte la distinction pour une aide technique — la couleur seule ne dit rien.
 */
export function Breadcrumb({
  label,
  className,
  ...props
}: ComponentProps<'nav'> & {
  /** Le nom accessible du fil d'Ariane, **traduit par l'appelant**. */
  readonly label: string
}) {
  return (
    <nav
      data-slot="breadcrumb"
      aria-label={label}
      className={cn('min-w-0', className)}
      {...props}
    />
  )
}

export function BreadcrumbList({ className, ...props }: ComponentProps<'ol'>) {
  return (
    <ol
      data-slot="breadcrumb-list"
      className={cn(
        'flex flex-wrap items-center gap-1.5 text-sm break-words text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

export function BreadcrumbItem({ className, ...props }: ComponentProps<'li'>) {
  return (
    <li
      data-slot="breadcrumb-item"
      className={cn('inline-flex items-center gap-1.5', className)}
      {...props}
    />
  )
}

export function BreadcrumbLink({ className, ...props }: ComponentProps<'a'>) {
  return (
    <a
      data-slot="breadcrumb-link"
      className={cn(
        'rounded-sm underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      {...props}
    />
  )
}

export function BreadcrumbPage({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="breadcrumb-page"
      aria-current="page"
      className={cn('font-medium text-foreground', className)}
      {...props}
    />
  )
}

export function BreadcrumbSeparator({ children, className, ...props }: ComponentProps<'li'>) {
  return (
    <li
      data-slot="breadcrumb-separator"
      role="presentation"
      aria-hidden
      className={cn('[&>svg]:size-3.5', className)}
      {...props}
    >
      {children ?? <ChevronRightIcon />}
    </li>
  )
}
