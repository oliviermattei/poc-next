'use client'

import {
  Badge,
  Button,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@repo/ui'
import { SearchIcon } from 'lucide-react'
import { useState } from 'react'

import { searchDocsIndex, type DocsSearchEntry } from '../application/docs-search'

/**
 * La palette de recherche de la documentation — `Command`, que
 * `docs/design-system.md` désigne nommément pour cet usage.
 *
 * **Aucune requête ne part.** L'index arrive avec la page, dérivé du catalogue
 * au build, et le filtrage est une fonction pure appelée dans le navigateur.
 * C'est le critère « sans service externe » tenu au sens fort — et c'est aussi
 * ce qui évite qu'une frappe au clavier se heurte à la limitation de débit :
 * `routeIsRateLimited` (ADR 050) plafonne **toute** route publique à 120
 * requêtes par minute et par appelant, sans qu'elle ait rien à déclarer.
 *
 * **Aucun traducteur ne traverse la frontière** : une fonction ne peut pas être
 * passée à un composant client — HTTP 500 mesuré au navigateur sur la première
 * version de cet écran (s30). Les libellés arrivent déjà traduits, et les
 * `href` déjà mis en forme dans la langue servie.
 *
 * **La palette n'est rendue que si l'index porte quelque chose.** Module coupé,
 * il est vide et rien n'apparaît : la décision se lit sur une **donnée**, jamais
 * sur l'identifiant d'un module.
 *
 * **Le contenu ne se monte qu'à l'ouverture**, et ce n'est pas qu'une économie :
 * `cmdk` pose un attribut `style` en ligne sur son étiquette masquée, gouverné
 * par `style-src-attr` — la seule directive CSP qui ne connaisse pas les nonces
 * (s45). Rendu dans le flux de la page, il ferait une violation à chaque visite.
 */
export interface DocsSearchLabels {
  /** Le libellé du déclencheur, **déjà traduit**. */
  readonly open: string
  readonly title: string
  readonly description: string
  readonly placeholder: string
  readonly empty: string
  /**
   * Le nom accessible de la **liste de résultats**.
   *
   * Sans lui, `cmdk` annonce « Suggestions » — une chaîne anglaise en dur, dans
   * toutes les locales, absente de toute source du dépôt. `CommandList` l'exige
   * depuis la revue de s54 : c'est un type, donc `pnpm typecheck` refuse.
   */
  readonly results: string
  readonly close: string
  /** La mention portée par une page servie dans la langue par défaut. */
  readonly untranslated: string
}

export interface DocsSearchProps {
  /** L'index de la langue servie, **avec ses `href` déjà mis en forme**. */
  readonly entries: readonly DocsSearchEntry[]
  readonly labels: DocsSearchLabels
}

export function DocsSearch({ entries, labels }: DocsSearchProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const results = searchDocsIndex(entries, query)

  if (entries.length === 0) {
    // Module coupé, ou documentation sans page : un champ de recherche qui ne
    // peut rien trouver est pire qu'une absence — il promet.
    return null
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="w-full justify-start text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <SearchIcon aria-hidden />
        {labels.open}
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)

          if (!next) {
            // La requête ne survit pas à la fermeture : rouvrir sur un filtre
            // qu'on ne voit plus donnerait une liste inexplicablement vide.
            setQuery('')
          }
        }}
        title={labels.title}
        description={labels.description}
        closeLabel={labels.close}
        /* Le filtrage est le nôtre : `searchDocsIndex` classe le titre avant le
           corps, ce que le filtre par défaut de `cmdk` ne sait pas faire — il ne
           voit que le texte rendu, et le corps des pages n'est pas rendu ici. */
        shouldFilter={false}
      >
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder={labels.placeholder}
          /* Pas d'`aria-label` ici : `CommandDialog` remplit l'étiquette masquée
             de `cmdk`, vers laquelle l'`aria-labelledby` du champ pointe déjà —
             et `aria-labelledby` l'emporte. En poser un doublerait le nom, et
             masquerait une étiquette redevenue vide. */
        />
        <CommandList label={labels.results}>
          <CommandEmpty>{labels.empty}</CommandEmpty>
          {results.map((entry) => (
            <CommandItem
              key={entry.href}
              value={entry.href}
              onSelect={() => {
                // Ce module ne dépend pas de `next` : la navigation est celle du
                // navigateur, comme pour tout lien du contenu.
                window.location.assign(entry.href)
              }}
            >
              <span className="flex w-full items-center gap-2">
                <span className="truncate font-medium">{entry.title}</span>
                {entry.translated ? null : (
                  /* **Le critère 4, à l'écran.** La page est proposée — elle se
                     sert —, mais jamais comme si elle était dans la langue
                     affichée. */
                  <Badge variant="outline">{labels.untranslated}</Badge>
                )}
              </span>
              <span className="line-clamp-2 text-xs text-muted-foreground">
                {entry.section} — {entry.description}
              </span>
            </CommandItem>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  )
}
