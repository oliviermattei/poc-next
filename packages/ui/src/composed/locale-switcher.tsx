'use client'

import { CheckIcon, LanguagesIcon } from 'lucide-react'

import { Button } from '../components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/dropdown-menu'

/**
 * Le sélecteur de langue, tel que `docs/design-system.md` le nomme.
 *
 * Il ne sait **rien** de l'i18n : ni comment une locale est résolue, ni où le
 * choix est persisté, ni même combien de langues existent. Il reçoit des
 * options déjà traduites et déjà munies de leur URL. C'est ce qui lui permet de
 * vivre dans le design system sans y faire entrer une bibliothèque.
 *
 * Chaque option est un **lien**, pas un bouton : la langue vit dans l'URL, donc
 * une URL partagée s'ouvre dans sa langue, un clic milieu ouvre l'autre langue
 * dans un onglet, et le changement fonctionne sans JavaScript. La persistance
 * du choix n'est pas ici : suivre le lien suffit, c'est le serveur qui en tire
 * le cookie — un composant du design system n'a pas à savoir qu'un cookie
 * existe.
 *
 * Aucun texte en dur, y compris le nom des langues : le libellé d'une option
 * vient du catalogue de l'appelant.
 */
export interface LocaleOption {
  readonly value: string
  readonly label: string
  readonly href: string
}

export interface LocaleSwitcherProps {
  /** Nom accessible du déclencheur. « Langue », traduit par l'appelant. */
  readonly label: string
  readonly current: string
  readonly options: readonly LocaleOption[]
}

export function LocaleSwitcher({ label, current, options }: LocaleSwitcherProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label}>
          <LanguagesIcon aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {options.map((option) => (
          <DropdownMenuItem key={option.value} asChild>
            <a
              href={option.href}
              hrefLang={option.value}
              aria-current={option.value === current ? 'true' : undefined}
            >
              {option.value === current ? (
                <CheckIcon aria-hidden />
              ) : (
                <span className="size-4" aria-hidden />
              )}
              {option.label}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
