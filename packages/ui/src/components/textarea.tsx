import type { ComponentProps } from 'react'

import { cn } from '../lib/cn'

/**
 * Un champ de saisie multiligne — le message du formulaire de contact (s11).
 *
 * Il est à l'inventaire de `docs/design-system.md` (« `Input`, `Textarea`,
 * `Select`… — Champs de saisie ») ; il n'était simplement pas encore copié,
 * comme `Accordion` avant s10. Rien n'est inventé ici.
 *
 * Les classes sont **celles d'`Input`**, à la hauteur près : `min-h-24` au lieu
 * de `h-10`, parce qu'un champ multiligne n'a pas de hauteur de ligne unique.
 * `resize-y` seulement — un redimensionnement horizontal déborde la carte qui
 * le contient sous 400 px, et le débordement horizontal est un critère de s08.
 */
export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex min-h-24 w-full min-w-0 resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition-colors',
        'placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/40',
        className,
      )}
      {...props}
    />
  )
}
