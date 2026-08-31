'use client'

import * as AccordionPrimitive from '@radix-ui/react-accordion'
import { ChevronDownIcon } from 'lucide-react'
import type { ComponentProps, CSSProperties } from 'react'

import { cn } from '../lib/cn'

/**
 * L'accordéon du design system — « Navigation secondaire, FAQ marketing ».
 *
 * Sur la primitive Radix, et pas sur un `<details>` maison : c'est elle qui
 * porte la navigation au clavier, l'association `aria-controls` /
 * `aria-expanded` et l'état ouvert/fermé annoncé aux lecteurs d'écran. Le dépôt
 * n'a plus de règle de lint d'accessibilité (`packages/ui/AGENTS.md`) : ce que
 * les primitives ne font pas, personne ne le vérifie.
 *
 * **Aucun texte ici** : question et réponse arrivent en enfants, déjà traduits.
 */
export function Accordion({
  className,
  ...props
}: ComponentProps<typeof AccordionPrimitive.Root>) {
  return (
    <AccordionPrimitive.Root
      data-slot="accordion"
      className={cn('w-full', className)}
      {...props}
    />
  )
}

export function AccordionItem({
  className,
  ...props
}: ComponentProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn('border-b border-border last:border-b-0', className)}
      {...props}
    />
  )
}

export function AccordionTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          'flex flex-1 items-start justify-between gap-4 py-4 text-left text-base font-medium',
          'rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
          '[&[data-state=open]>svg]:rotate-180',
          className,
        )}
        {...props}
      >
        {children}
        <ChevronDownIcon
          aria-hidden
          className="size-5 shrink-0 translate-y-0.5 text-muted-foreground transition-transform duration-200"
        />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  )
}

/**
 * Les deux variables que Radix écrit **toujours** sur le contenu, neutralisées.
 *
 * `AccordionPrimitive.Content` compose son style ainsi :
 * `{ '--radix-accordion-content-height': …, '--radix-accordion-content-width': …, ...props.style }`
 * (vérifié dans le paquet installé, `@radix-ui/react-accordion` 1.2.20). Les
 * repasser à `undefined` depuis `props.style` les efface, et React n'émet alors
 * plus d'attribut `style` du tout.
 *
 * Pourquoi s'en soucier : un attribut `style` rendu par le serveur est gouverné
 * par `style-src-attr`, la seule directive CSP qui **ne connaît pas les
 * nonces** ; sous la politique de s45 il est refusé, et chaque visite de
 * l'accueil public inscrivait une violation dans la console. Ces deux variables
 * n'apparaissent dans aucune règle de `src/styles.css` : aucune animation, aucun
 * calcul de hauteur n'en dépend ici. Le jour où une story en aura besoin, elle
 * les déclarera dans la feuille de style — pas en ligne.
 */
const RADIX_CONTENT_VARIABLES = {
  '--radix-accordion-content-height': undefined,
  '--radix-accordion-content-width': undefined,
} as CSSProperties

export function AccordionContent({
  className,
  children,
  style,
  ...props
}: ComponentProps<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content
      data-slot="accordion-content"
      className="overflow-hidden text-base"
      {...props}
      // Après `props`, jamais avant : un appelant qui pose un style le garde,
      // et c'est alors sa story qui en répond devant la politique.
      style={{ ...RADIX_CONTENT_VARIABLES, ...style }}
    >
      <div className={cn('pb-4 text-muted-foreground', className)}>{children}</div>
    </AccordionPrimitive.Content>
  )
}
