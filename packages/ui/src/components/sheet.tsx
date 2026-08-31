'use client'

import * as SheetPrimitive from '@radix-ui/react-dialog'
import { XIcon } from 'lucide-react'
import type { ComponentProps } from 'react'

import { cn } from '../lib/cn'

/**
 * La surface flottante latérale — c'est ce que devient la barre latérale sous
 * `md`.
 *
 * Bâti sur le dialogue de Radix (ADR 022) : verrouillage du focus, fermeture à
 * l'échappement, `aria-modal` et restitution du focus à la fermeture viennent de
 * la primitive. C'est exactement ce qu'on écrirait mal à la main, et c'est la
 * raison pour laquelle le socle existe.
 *
 * Le contenu n'est monté **que lorsque le panneau est ouvert** : fermé, il ne
 * laisse ni lien ni titre dans l'arbre d'accessibilité — sans quoi la
 * navigation existerait en double sur un écran large.
 */
export const Sheet = SheetPrimitive.Root
export const SheetTrigger = SheetPrimitive.Trigger
export const SheetClose = SheetPrimitive.Close

export function SheetContent({
  className,
  children,
  side = 'left',
  closeLabel,
  ...props
}: ComponentProps<typeof SheetPrimitive.Content> & {
  readonly side?: 'left' | 'right'
  /**
   * Le nom accessible du bouton de fermeture, **traduit par l'appelant**.
   *
   * Obligatoire : c'est le seul texte que cette primitive affiche, et il
   * portait « Fermer » en dur jusqu'à la revue de s09. `packages/ui` ne connaît
   * ni catalogue ni locale — les libellés lui arrivent en props, comme pour
   * `SidebarNav` ou `ThemeToggle`.
   */
  readonly closeLabel: string
}) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay
        data-slot="sheet-overlay"
        className="fixed inset-0 z-50 bg-foreground/50"
      />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          'fixed inset-y-0 z-50 flex h-full w-3/4 max-w-xs flex-col gap-4 border-border bg-background p-4 shadow-lg',
          side === 'left' ? 'left-0 border-r' : 'right-0 border-l',
          className,
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close className="absolute top-4 right-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring">
          <XIcon className="size-4" aria-hidden />
          <span className="sr-only">{closeLabel}</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  )
}

export function SheetTitle({ className, ...props }: ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn('text-sm font-semibold', className)}
      {...props}
    />
  )
}

export function SheetDescription({
  className,
  ...props
}: ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}
