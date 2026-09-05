import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, cn } from '@repo/ui'

import type { DocsNavigationSection } from '../application/docs-catalog'

/**
 * La navigation latérale, **dérivée de l'arborescence**.
 *
 * Aucune entrée n'est inscrite : les sections et les pages sont celles que
 * `docsNavigationTree` a construites depuis les fichiers. Déposer un `.mdx` le
 * fait apparaître ici.
 *
 * **Ce composant ne reçoit ni traducteur ni fonction de chemin, et c'est
 * structurel** : il est monté dans un `Sheet` sous `lg`, donc dans un composant
 * client, et une fonction ne traverse pas la frontière serveur → client (« Functions
 * cannot be passed directly to Client Components »). Mesuré au navigateur, en
 * HTTP 500, sur la première version de cet écran. Les libellés arrivent
 * **déjà traduits** et les `href` **déjà mis en forme** — c'est déjà la règle
 * de `packages/ui` (« aucun texte, jamais ») et celle de `app-navigation.tsx`.
 *
 * **Toutes les sections sont ouvertes par défaut**, et c'est une décision : le
 * repliement vient de Radix, donc de JavaScript. Fermées au rendu, elles
 * laisseraient un visiteur sans script devant une navigation qu'il ne peut pas
 * ouvrir. Ouvertes, le repliement est un confort qui s'ajoute quand le script
 * arrive, et rien ne se perd quand il n'arrive pas.
 *
 * **La page courante est marquée par `aria-current`**, jamais par une couleur
 * sémantique : s49 a mesuré les quatre variantes d'`Alert` sous le seuil WCAG AA
 * en thème clair. La distinction visuelle passe par la primaire et par la
 * graisse — le même choix que `Pagination` (s29) —, et `aria-current` porte
 * l'information pour une aide technique, à qui une couleur ne dit rien.
 */
export interface DocsSidebarProps {
  /** L'arbre, **avec ses `href` déjà mis en forme** par l'appelant. */
  readonly sections: readonly DocsNavigationSection[]
  /** L'adresse servie, comparée telle quelle. `null` quand aucune page ne l'est. */
  readonly currentHref: string | null
  /** Le nom accessible de la navigation, traduit par l'appelant. */
  readonly label: string
  /** Appelé au clic sur un lien — le panneau du petit écran s'en sert pour se fermer. */
  readonly onNavigate?: () => void
}

export function DocsSidebar({ sections, currentHref, label, onNavigate }: DocsSidebarProps) {
  return (
    <nav aria-label={label} className="min-w-0">
      <Accordion type="multiple" defaultValue={sections.map((section) => section.section)}>
        {sections.map((section) => (
          <AccordionItem key={section.section} value={section.section}>
            <AccordionTrigger>{section.title}</AccordionTrigger>
            <AccordionContent>
              <ul className="flex flex-col gap-0.5">
                {section.pages.map((page) => {
                  const active = page.href === currentHref

                  return (
                    <li key={page.slug} className="min-w-0">
                      <a
                        href={page.href}
                        aria-current={active ? 'page' : undefined}
                        onClick={onNavigate}
                        className={cn(
                          'block rounded-sm border-l-2 py-1 pl-3 text-sm focus-visible:ring-2 focus-visible:ring-ring',
                          active
                            ? 'border-primary font-medium text-foreground'
                            : 'border-transparent text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {page.title}
                      </a>
                    </li>
                  )
                })}
              </ul>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </nav>
  )
}
