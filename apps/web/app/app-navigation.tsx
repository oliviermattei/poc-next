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
 * **Aucune condition sur un module ici, et plus aucun texte** : ce composant
 * reçoit des entrées et des libellés déjà traduits, et les affiche. Il ne sait
 * ni ce qu'est un module, ni dans quelle langue il rend.
 */
export interface NavigationProps {
  readonly items: readonly SidebarItem[]
  /** Nom accessible de la navigation, traduit par le shell. */
  readonly label: string
}

/**
 * **Les entrées du site, dans son en-tête** (s61), à partir de `md`.
 *
 * Des `Button` plutôt que la liste de la barre latérale : l'en-tête est une
 * rangée, et la règle visuelle est celle de la console — l'entrée courante en
 * `secondary`, les autres en `ghost`. `aria-current` porte la distinction pour
 * un lecteur d'écran : la couleur seule ne dit rien. Sous `md`, les mêmes
 * entrées passent dans `MobileNavigation`, et celle-ci est masquée : jamais
 * deux navigations du même nom en même temps.
 */
export function SiteNavigation({ items, label }: NavigationProps) {
  const pathname = usePathname()

  return (
    <nav aria-label={label} className="hidden min-w-0 md:block">
      <ul className="flex items-center gap-1">
        {items.map((item) => {
          const current = item.href === pathname

          return (
            <li key={item.id}>
              <Button asChild variant={current ? 'secondary' : 'ghost'}>
                <a href={item.href} aria-current={current ? 'page' : undefined}>
                  {item.label}
                </a>
              </Button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export function DesktopNavigation({ items, label }: NavigationProps) {
  return <SidebarNav items={items} label={label} currentPath={usePathname()} />
}

export interface MobileNavigationProps extends NavigationProps {
  readonly openLabel: string
  readonly closeLabel: string
  readonly title: string
}

export function MobileNavigation({
  items,
  label,
  openLabel,
  closeLabel,
  title,
}: MobileNavigationProps) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden" aria-label={openLabel}>
          <MenuIcon aria-hidden />
        </Button>
      </SheetTrigger>
      {/* `aria-describedby={undefined}` : ce panneau n'a pas de description, et
          Radix avertit en console tant qu'on ne le dit pas explicitement. */}
      <SheetContent side="left" aria-describedby={undefined} closeLabel={closeLabel}>
        <SheetTitle>{title}</SheetTitle>
        <SidebarNav
          items={items}
          label={label}
          currentPath={pathname}
          // Suivre un lien ferme le panneau : sans cela, il reste ouvert
          // par-dessus la page qu'on vient d'ouvrir.
          onNavigate={() => setOpen(false)}
        />
      </SheetContent>
    </Sheet>
  )
}
