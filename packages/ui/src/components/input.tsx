import type { ComponentProps } from 'react'

import { cn } from '../lib/cn'

/**
 * Un champ de saisie. `h-10` : la densité confortable du design system, la même
 * que celle d'un bouton, sans quoi un champ et son bouton ne s'alignent pas.
 */
export function Input({ className, type, ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'flex h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition-colors',
        'placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/40',
        className,
      )}
      {...props}
    />
  )
}
