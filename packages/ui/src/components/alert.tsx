import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'

import { cn } from '../lib/cn'

/**
 * Message contextuel persistant, **porté par une sémantique**.
 *
 * Les quatre sémantiques du design system, et rien d'autre : elles portent un
 * sens métier (succès, avertissement, danger, information), jamais un usage
 * décoratif. Le feedback asynchrone passe par un `Toaster`, pas par ceci.
 */
const alertVariants = cva('rounded-lg border px-4 py-3 text-sm', {
  variants: {
    variant: {
      default: 'border-border bg-card text-card-foreground',
      destructive: 'border-destructive/50 bg-destructive/10 text-destructive',
      success: 'border-success/50 bg-success/10 text-success',
      warning: 'border-warning/50 bg-warning/10 text-warning',
      info: 'border-info/50 bg-info/10 text-info',
    },
  },
  defaultVariants: { variant: 'default' },
})

export type AlertProps = ComponentProps<'div'> & VariantProps<typeof alertVariants>

export function Alert({ className, variant, ...props }: AlertProps) {
  return (
    // **Aucun rôle par défaut, et c'est délibéré.** `role="alert"` est une
    // région vivante : un lecteur d'écran interrompt sa lecture pour
    // l'annoncer. Sur un message contextuel **persistant** — le cas le plus
    // fréquent de ce composant — c'est une interruption pour rien, et sur un
    // écran qui en porte deux, chaque texte statique devient une alerte.
    // L'appelant dit ce qu'il annonce : `role="alert"` pour un refus,
    // `role="status"` pour une confirmation, rien pour une note.
    <div
      data-slot="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

export function AlertTitle({ className, ...props }: ComponentProps<'p'>) {
  return <p data-slot="alert-title" className={cn('font-medium', className)} {...props} />
}

export function AlertDescription({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="alert-description" className={cn('text-sm', className)} {...props} />
}
