import type { ReactNode } from 'react'

import { cn } from '../lib/cn'

/**
 * L'enveloppe des sections pilotées par `config/marketing.ts` — le composé que
 * `docs/design-system.md` annonce pour s10.
 *
 * Elle ne connaît **aucune nature de section** : elle porte le rythme vertical
 * du document (`py-16` en mobile, `py-24` au-delà), la séparation entre deux
 * sections, le titre et la description. Ce qu'il y a dedans est l'affaire de
 * l'appelant — sans quoi ajouter une nature de section demanderait de rouvrir
 * le design system.
 *
 * `headingLevel` existe pour une raison d'accessibilité et non de style : la
 * première section d'une page marketing porte le `h1` du document, les
 * suivantes des `h2`. Un enchaînement de `h1` prive un lecteur d'écran de la
 * structure de la page, et rien dans ce dépôt ne le vérifie automatiquement.
 *
 * **Aucun texte ici** : titre et description arrivent en propriétés, déjà
 * traduits (`packages/ui/AGENTS.md`).
 */
export interface MarketingSectionProps {
  readonly title: string
  readonly description: string
  readonly headingLevel: 1 | 2
  /** Réserve la typographie `display` (3rem / 600) au héros, comme le veut le document. */
  readonly display?: boolean
  readonly children?: ReactNode
}

export function MarketingSection({
  title,
  description,
  headingLevel,
  display = false,
  children,
}: MarketingSectionProps) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2'

  return (
    <section
      data-slot="marketing-section"
      // Le trait est **au-dessus**, et absent sur la première : posé en bas, la
      // dernière section doublait le séparateur du pied de page, qui suit
      // immédiatement — `last:` ne la voit pas, elle n'est pas le dernier
      // enfant. Constaté à l'œil en s10.
      className="border-t border-border py-16 first:border-t-0 md:py-24"
    >
      <div className="min-w-0 space-y-3">
        <Heading
          className={cn(
            display
              ? 'text-5xl leading-[1.05] font-semibold tracking-tight'
              : 'text-2xl font-semibold tracking-tight',
          )}
        >
          {title}
        </Heading>
        <p className="max-w-2xl text-base text-muted-foreground">{description}</p>
      </div>
      {children === undefined ? null : <div className="mt-8 min-w-0">{children}</div>}
    </section>
  )
}
