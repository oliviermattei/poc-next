'use client'

import {
  Button,
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
  SidebarNav,
  type SidebarItem,
} from '@repo/ui'
import { MenuIcon } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

/**
 * La navigation, rendue deux fois pour deux tailles d'écran — **jamais deux
 * fois en même temps**.
 *
 * Sur écran large, la colonne latérale est affichée et le panneau est fermé :
 * le contenu d'un `Sheet` fermé n'est pas monté, donc il n'y a qu'une seule
 * navigation dans l'arbre d'accessibilité. Sous `md`, la colonne est en
 * `display: none` — elle n'y est pas non plus. Deux navigations portant le même
 * nom accessible seraient indistinguables pour un lecteur d'écran comme pour un
 * parcours de test.
 *
 * **Aucune condition sur un module ici** : ce composant reçoit des entrées et
 * les affiche. Il ne sait pas ce qu'est un module.
 */
export const NAVIGATION_LABEL = 'Modules'

export function DesktopNavigation({ items }: { readonly items: readonly SidebarItem[] }) {
  return <SidebarNav items={items} label={NAVIGATION_LABEL} currentPath={usePathname()} />
}

export function MobileNavigation({ items }: { readonly items: readonly SidebarItem[] }) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden" aria-label="Ouvrir la navigation">
          <MenuIcon aria-hidden />
        </Button>
      </SheetTrigger>
      {/* `aria-describedby={undefined}` : ce panneau n'a pas de description, et
          Radix avertit en console tant qu'on ne le dit pas explicitement. */}
      <SheetContent side="left" aria-describedby={undefined}>
        <SheetTitle>Application</SheetTitle>
        <SidebarNav
          items={items}
          label={NAVIGATION_LABEL}
          currentPath={pathname}
          // Suivre un lien ferme le panneau : sans cela, il reste ouvert
          // par-dessus la page qu'on vient d'ouvrir.
          onNavigate={() => setOpen(false)}
        />
      </SheetContent>
    </Sheet>
  )
}
