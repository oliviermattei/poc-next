'use client'

import { Button, Sheet, SheetContent, SheetTitle, SheetTrigger } from '@repo/ui'
import { PanelLeftIcon } from 'lucide-react'
import { useState } from 'react'

import type { DocsNavigationSection } from '../application/docs-catalog'
import { DocsSidebar } from './docs-sidebar'

/**
 * La navigation latérale sous `lg` : un `Sheet`.
 *
 * C'est le composant que le design system désigne pour une surface flottante
 * latérale ; `Sidebar` est réservée à la navigation principale du tableau de
 * bord, et l'employer ici mettrait deux navigations principales à l'écran.
 *
 * **Aucun traducteur ne traverse la frontière** : une fonction ne peut pas être
 * passée à un composant client, et c'est un HTTP 500 mesuré au navigateur sur la
 * première version de cet écran. Les libellés arrivent déjà traduits.
 *
 * Le contenu d'un `Sheet` fermé n'est **pas monté** : sur écran large, où le
 * déclencheur est en `display: none`, il n'y a qu'une seule navigation de
 * documentation dans l'arbre d'accessibilité. C'est la condition pour que le nom
 * accessible reste unique — sans elle, `getByRole('navigation', { name })`
 * trouverait deux nœuds, à l'écran comme dans un parcours.
 */
export interface DocsMobileSidebarProps {
  /** L'arbre, **avec ses `href` déjà mis en forme** par l'appelant. */
  readonly sections: readonly DocsNavigationSection[]
  readonly currentHref: string | null
  /** Les trois libellés, **déjà traduits** : nom de la navigation, ouverture, fermeture. */
  readonly label: string
  readonly openLabel: string
  readonly closeLabel: string
}

export function DocsMobileSidebar({
  sections,
  currentHref,
  label,
  openLabel,
  closeLabel,
}: DocsMobileSidebarProps) {
  const [open, setOpen] = useState(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" className="lg:hidden">
          <PanelLeftIcon aria-hidden />
          {openLabel}
        </Button>
      </SheetTrigger>
      {/* `aria-describedby={undefined}` : ce panneau n'a pas de description, et
          Radix avertit en console tant qu'on ne le dit pas explicitement. */}
      <SheetContent
        side="left"
        aria-describedby={undefined}
        closeLabel={closeLabel}
        className="overflow-y-auto"
      >
        <SheetTitle>{label}</SheetTitle>
        <DocsSidebar
          sections={sections}
          currentHref={currentHref}
          label={label}
          // Suivre un lien ferme le panneau : sans cela, il reste ouvert
          // par-dessus la page qu'on vient d'ouvrir.
          onNavigate={() => setOpen(false)}
        />
      </SheetContent>
    </Sheet>
  )
}
