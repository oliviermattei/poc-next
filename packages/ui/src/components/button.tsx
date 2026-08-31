import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2Icon } from 'lucide-react'
import type { ComponentProps } from 'react'

import { cn } from '../lib/cn'

/**
 * Les cinq variantes que le design system nomme, et pas une de plus.
 *
 * Aucune couleur brute : `bg-primary`, `text-destructive-foreground`… Une
 * couleur Tailwind écrite en dur (`bg-zinc-800`) casserait le thème sombre et
 * la thématisation par projet — c'est le premier « don't » du design system.
 *
 * La hauteur est celle de la densité confortable : `h-10`, soit les 2,5rem que
 * le design system fixe pour un bouton comme pour un champ.
 */
const buttonVariants = cva(
  'inline-flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
      },
      size: {
        default: '',
        // Un bouton carré pour une icône seule. Le design system ne nomme pas
        // d'échelle de tailles : celle-ci ne change ni la hauteur, ni le rayon.
        icon: 'w-10 px-0',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  /** Rend le composant enfant plutôt qu'un `<button>` : un lien qui a l'air d'un bouton. */
  readonly asChild?: boolean
  /**
   * L'état d'envoi, porté par le bouton lui-même.
   *
   * Il **désactive** en plus d'afficher : un bouton qui tourne mais reste
   * cliquable envoie deux fois. Le design system l'exige des formulaires ; le
   * porter ici évite que chaque écran le réinvente à moitié.
   */
  readonly pending?: boolean
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  pending = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size }), className)

  /**
   * Deux rendus, et c'est ce que `Slot` impose.
   *
   * `Slot` fusionne ses propriétés dans **un enfant unique** : lui en passer
   * deux — même quand le second vaut `null` — le fait échouer à l'exécution.
   * Mesuré : l'écran entier ne s'affichait plus, et rien n'échouait à la
   * compilation. Un lien n'a de toute façon ni état d'envoi, ni attribut
   * `disabled`.
   */
  if (asChild) {
    return (
      <Slot data-slot="button" className={classes} {...props}>
        {children}
      </Slot>
    )
  }

  return (
    <button
      data-slot="button"
      className={classes}
      disabled={disabled === true || pending}
      aria-busy={pending || undefined}
      {...props}
    >
      {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
      {children}
    </button>
  )
}

export { buttonVariants }
