'use client'

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, cn } from '@repo/ui'
import { useEffect, useState } from 'react'

import type { DocsHeading } from '../domain/docs-page'

/**
 * Le sommaire de la page : ses titres, une ancre par section.
 *
 * **Le design system ne couvre pas ce composant** — c'est le manque n°2 du
 * design de la story, signalé et non comblé par une primitive nouvelle : ce
 * sommaire se **compose** d'une liste, de liens et d'`aria-current`, ce que le
 * système fournit déjà.
 *
 * `aria-current="location"` et non `"page"` : la page, c'est celle qu'on lit ;
 * la position courante y est un emplacement à l'intérieur. Le lecteur d'écran
 * annonce alors « emplacement courant » plutôt que de prétendre à une seconde
 * page courante à côté de celle de la navigation latérale.
 *
 * **Ce que le composant fait quand JavaScript n'arrive pas** : il rend le
 * sommaire, ses liens fonctionnent (ce sont des fragments), et aucune position
 * n'est marquée. Le suivi du défilement est un confort, pas la fonction — un
 * sommaire dont les liens dépendraient du script ne serait pas un sommaire.
 */
export interface DocsTocProps {
  readonly headings: readonly DocsHeading[]
  /** Le nom accessible du sommaire et son titre, **déjà traduits** : une fonction ne traverse pas la frontière serveur → client. */
  readonly label: string
  readonly title: string
  /**
   * Replié derrière son titre, `Accordion` du design system.
   *
   * C'est la forme du petit écran, où le sommaire passe **au-dessus du corps** :
   * déplié, il repousserait le premier paragraphe sous la ligne de flottaison
   * sur une page qui a beaucoup de titres. Sur la colonne de droite, à partir de
   * `lg`, il n'a rien à replier — il a sa place.
   */
  readonly collapsible?: boolean
  readonly className?: string
}

export function DocsToc({ headings, label, title, collapsible, className }: DocsTocProps) {
  const [current, setCurrent] = useState<string | null>(null)

  useEffect(() => {
    const targets = headings
      .map((heading) => document.getElementById(heading.id))
      .filter((element): element is HTMLElement => element !== null)

    if (targets.length === 0) {
      return
    }

    /*
     * **Le dernier titre passé sous la ligne de lecture**, et pas « le premier
     * titre visible ». La seconde formule est la plus courante et elle a un
     * angle mort mesuré : le dernier titre d'une page courte ne peut jamais
     * atteindre le haut de la fenêtre — la page a fini de défiler avant —, si
     * bien qu'il ne devient jamais courant, y compris après un clic sur son
     * propre lien. Le cas « bas de page » est donc traité pour lui-même.
     *
     * Aucune position n'est courante tant qu'aucun titre n'a passé la ligne :
     * en haut de page, le lecteur est dans l'introduction, pas dans une section.
     *
     * La ligne est à 96 px : la `scroll-mt-20` que l'échelle de prose pose sur
     * les titres vaut 80 px, et un titre qu'on vient de rejoindre doit compter
     * comme passé.
     */
    const READING_LINE = 96
    let frame = 0

    const update = (): void => {
      frame = 0

      const bottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2

      if (bottom) {
        setCurrent(targets.at(-1)?.id ?? null)

        return
      }

      let passed: string | null = null

      for (const target of targets) {
        if (target.getBoundingClientRect().top <= READING_LINE) {
          passed = target.id
        }
      }

      setCurrent(passed)
    }

    const schedule = (): void => {
      if (frame === 0) {
        frame = requestAnimationFrame(update)
      }
    }

    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    // Un clic sur une entrée déjà en bas de page ne produit aucun défilement,
    // donc aucun événement `scroll` : le changement de fragment est le seul
    // signal qui reste.
    window.addEventListener('hashchange', schedule)

    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('hashchange', schedule)

      if (frame !== 0) {
        cancelAnimationFrame(frame)
      }
    }
  }, [headings])

  if (headings.length === 0) {
    return null
  }

  const list = (
    <ol className="flex flex-col gap-1 border-l border-border">
      {headings.map((heading) => (
        <li key={heading.id} className="min-w-0">
          <a
            href={`#${heading.id}`}
            aria-current={heading.id === current ? 'location' : undefined}
            className={cn(
              '-ml-px block border-l-2 py-0.5 text-sm focus-visible:ring-2 focus-visible:ring-ring',
              heading.depth === 3 ? 'pl-6' : 'pl-3',
              heading.id === current
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {heading.text}
          </a>
        </li>
      ))}
    </ol>
  )

  return (
    <nav aria-label={label} className={cn('min-w-0', className)}>
      {collapsible === true ? (
        <Accordion type="single" collapsible>
          <AccordionItem value="toc" className="border-b-0">
            <AccordionTrigger className="py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {title}
            </AccordionTrigger>
            <AccordionContent>{list}</AccordionContent>
          </AccordionItem>
        </Accordion>
      ) : (
        <>
          <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {title}
          </p>
          {list}
        </>
      )}
    </nav>
  )
}
