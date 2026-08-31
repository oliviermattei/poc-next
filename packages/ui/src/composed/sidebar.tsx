import type { ComponentProps, ReactNode } from 'react'

import { cn } from '../lib/cn'

/**
 * La navigation principale du tableau de bord.
 *
 * **Ce composant ne connaît aucun module.** Il reçoit des entrées et les
 * affiche : pas de `if (module activé)`, pas de liste écrite en dur, pas
 * d'identifiant de module cité. Désactiver un module retire son entrée sans
 * qu'une ligne d'ici ne change — c'est la démonstration, côté interface, de
 * l'angle du produit. La seule comparaison qu'il fait porte sur le chemin
 * courant, pour dire à un lecteur d'écran quelle page est ouverte.
 */
export interface SidebarItem {
  readonly id: string
  readonly href: string
  readonly label: string
}

export interface SidebarNavProps {
  readonly items: readonly SidebarItem[]
  /** Nom accessible de la navigation. Deux navigations sans nom sont indistinguables. */
  readonly label: string
  readonly currentPath?: string
  readonly onNavigate?: () => void
}

export function SidebarNav({ items, label, currentPath, onNavigate }: SidebarNavProps) {
  return (
    <nav aria-label={label} className="min-w-0">
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const current = item.href === currentPath

          return (
            <li key={item.id}>
              <a
                href={item.href}
                onClick={onNavigate}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'flex h-10 items-center gap-2 truncate rounded-md px-3 text-sm transition-colors',
                  'hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  current ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground',
                )}
              >
                {item.label}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** La colonne latérale : bordure et fond, jamais une ombre — c'est une surface statique. */
export function Sidebar({ className, children, ...props }: ComponentProps<'aside'>) {
  return (
    <aside
      data-slot="sidebar"
      className={cn(
        'hidden w-60 shrink-0 flex-col gap-4 border-r border-border bg-card p-4 md:flex',
        className,
      )}
      {...props}
    >
      {children}
    </aside>
  )
}

/** La marque du produit, en tête de la barre latérale et du panneau mobile. */
export function SidebarBrand({ children }: { readonly children: ReactNode }) {
  return <div className="px-3 py-2 text-sm font-semibold">{children}</div>
}
