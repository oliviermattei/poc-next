import type { ComponentProps } from 'react'

import { cn } from '../lib/cn'

/**
 * Le tableau de listes — copie shadcn/ui (ADR 022), annoncée par
 * `docs/design-system.md` et absente de ce paquet jusqu'à s37b2.
 *
 * **Aucune primitive Radix ici, et ce n'est pas une entorse** : shadcn/ui ne
 * fonde pas `Table` sur Radix, qui n'en publie pas. L'élément natif porte déjà
 * la sémantique dont une aide technique a besoin — `<table>`, `<th scope>`, la
 * légende —, et la règle de ce paquet interdit de réimplémenter un comportement
 * Radix, pas d'employer la plateforme là où elle suffit (`Checkbox`, s36, est le
 * même arbitrage).
 *
 * **Le conteneur défile horizontalement**, et c'est structurel : un tableau à
 * quatre colonnes ne rentre pas sous 400 px, et `min-w-0` du shell tronque le
 * contenu au lieu de pousser la page. Sans ce défilement, la dernière colonne
 * serait inatteignable — le critère mesurable de s08.
 *
 * **Aucun texte n'est écrit ici** : la légende arrive en enfant, déjà traduite.
 */
export function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      <table
        data-slot="table"
        className={cn('w-full caption-bottom text-sm', className)}
        {...props}
      />
    </div>
  )
}

export function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return (
    <thead
      data-slot="table-header"
      className={cn('[&_tr]:border-b [&_tr]:border-border', className)}
      {...props}
    />
  )
}

export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  )
}

export function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn('border-b border-border transition-colors hover:bg-muted/50', className)}
      {...props}
    />
  )
}

/**
 * L'en-tête d'une colonne. `scope="col"` est **posé ici et pas laissé à
 * l'appelant** : c'est lui qui rattache chaque cellule à son intitulé pour un
 * lecteur d'écran, et un appelant qui l'oublie rend un tableau illisible sans
 * qu'aucune commande ne le dise.
 */
export function TableHead({ className, scope = 'col', ...props }: ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      scope={scope}
      className={cn(
        'h-10 px-3 text-left align-middle text-sm font-medium text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

/** Densité confortable : `py-3`, ce que `docs/design-system.md` fixe pour une cellule. */
export function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn('px-3 py-3 align-middle', className)}
      {...props}
    />
  )
}

/**
 * La légende du tableau, **son nom accessible**.
 *
 * `caption-bottom` la place sous le tableau, comme shadcn/ui : elle reste lue en
 * premier par une aide technique, qui suit l'ordre du document et non celui de
 * la mise en page.
 */
export function TableCaption({ className, ...props }: ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('mt-4 text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}
