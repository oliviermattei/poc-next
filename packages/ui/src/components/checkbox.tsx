import type { ComponentProps } from 'react'

import { cn } from '../lib/cn'

/**
 * Une case à cocher — **l'élément natif**, et c'est une décision.
 *
 * `@radix-ui/react-checkbox` rend un `<button>` doublé d'un `<input>` masqué :
 * la case ne se coche **pas** tant que JavaScript n'a pas pris la main, et sa
 * valeur ne part pas dans une soumission native. Le premier formulaire du dépôt
 * qui l'emploie est celui du consentement aux cookies (s36), dont toute la
 * propriété est de fonctionner sans script : une case portée par Radix y
 * détruirait la seule chose qui compte.
 *
 * Rien n'est réimplémenté au passage — c'est bien ce que `packages/AGENTS.md`
 * interdit. Le focus, la barre d'espace, l'état indéterminé, l'association à
 * l'étiquette et l'envoi du champ sont ceux de la plateforme ; `accent-color`
 * teinte la case avec le token du produit sans redessiner un contrôle.
 *
 * `peer` est posé ici : c'est ce que `Label` attend pour griser son texte quand
 * la case est désactivée.
 */
export function Checkbox({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  return (
    <input
      type="checkbox"
      data-slot="checkbox"
      className={cn(
        'peer size-4 shrink-0 rounded-sm border border-input accent-primary outline-none',
        'focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
