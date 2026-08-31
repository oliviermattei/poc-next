'use client'

import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react'
import { useId } from 'react'

import { Button } from '../components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/dropdown-menu'

/**
 * La bascule d'organisation, telle que `docs/design-system.md` la nomme (s15).
 *
 * Elle ne sait **rien** des organisations : ni comment l'appartenance est
 * vérifiée, ni où l'organisation courante est persistée, ni combien il y en a.
 * Elle reçoit des options déjà traduites et l'URL de la route qui bascule.
 * C'est ce qui lui permet de vivre dans le design system sans y faire entrer
 * une règle métier.
 *
 * **Chaque option est un bouton de soumission, pas un lien** — et c'est la
 * seule différence avec `LocaleSwitcher`, qui, lui, emploie des liens. La
 * langue vit dans l'URL, donc un `GET` la change ; l'organisation courante est
 * un **état serveur**, et un `GET` qui change un état serveur est une faute
 * d'HTTP autant qu'une porte ouverte à la requête intersite. Le `<form>` porte
 * donc `method="post"`, écrit en toutes lettres — `pnpm lint` refuse
 * l'inverse.
 *
 * Aucun texte en dur, y compris le nom accessible du déclencheur : `packages/ui`
 * ne connaît ni catalogue ni locale.
 */
export interface OrgSwitcherOption {
  readonly value: string
  readonly label: string
}

export interface OrgSwitcherProps {
  /**
   * Nom accessible du **menu**. Obligatoire : un contrôle anonyme est un défaut.
   *
   * Il n'est pas posé sur le déclencheur, et c'est un arbitrage : un
   * `aria-label` sur un bouton **remplace** son contenu pour une aide
   * technique, si bien que « Changer d'organisation » ferait disparaître le nom
   * de l'organisation courante — la seule information que ce bouton porte. Le
   * déclencheur est donc nommé par son texte visible, et c'est la liste qui dit
   * ce qu'elle est.
   */
  readonly label: string
  /** Libellé de l'organisation courante, déjà traduit par l'appelant. */
  readonly current: string
  /** L'identifiant de l'organisation courante, ou `null` s'il n'y en a pas. */
  readonly currentValue: string | null
  /** L'URL de la route qui bascule. */
  readonly action: string
  /** Le nom du champ posté. Le composant ne le devine pas. */
  readonly fieldName: string
  readonly options: readonly OrgSwitcherOption[]
}

export function OrgSwitcher({
  label,
  current,
  currentValue,
  action,
  fieldName,
  options,
}: OrgSwitcherProps) {
  /**
   * L'identifiant du formulaire, et il n'est **pas** décoratif.
   *
   * Le contenu du menu est rendu dans un portail (Radix) : dans le DOM, les
   * boutons d'option ne sont donc **pas** à l'intérieur du `<form>`, et un
   * `type="submit"` seul n'y soumettrait rien — mesuré au navigateur, le clic
   * fermait le menu sans rien changer. L'attribut `form` rétablit
   * l'association, qui est ce que HTML prévoit pour ce cas.
   *
   * `useId` plutôt qu'une constante : deux sélecteurs sur un même écran
   * soumettraient sinon le même formulaire.
   */
  const formId = useId()

  return (
    <form method="post" action={action} id={formId} className="min-w-0">
      {/*
        **Le repli sans JavaScript**, et il ne coûte que ce formulaire.

        Le contenu du menu est monté par Radix à l'ouverture, et l'ouverture est
        un état React : script coupé, le déclencheur est un bouton qui ne fait
        rien — mesuré, le balisage rendu ne contient aucune option. Les mêmes
        options, en boutons de soumission natifs, vivent donc ici. Elles sont
        **dans** le `<form>`, donc l'attribut `form` leur serait inutile ; et le
        navigateur masque tout ce bloc dès que le script tourne, si bien qu'une
        aide technique n'en voit jamais deux copies.

        `e2e/organizations.spec.ts` l'éprouve dans un contexte
        `javaScriptEnabled: false` : c'est le seul endroit du dépôt qui puisse
        le faire, un rendu statique n'ayant pas de moteur qui décide.
      */}
      <noscript>
        <ul className="flex flex-wrap gap-2">
          {options
            // L'organisation courante est **exclue** : le déclencheur la porte
            // déjà, et deux boutons du même nom sur un même écran sont
            // indiscernables pour une aide technique comme pour un parcours.
            // Ce qui reste est ce que le repli sert à faire : aller ailleurs.
            .filter((option) => option.value !== currentValue)
            .map((option) => (
              <li key={option.value}>
                <Button type="submit" variant="outline" name={fieldName} value={option.value}>
                  {option.label}
                </Button>
              </li>
            ))}
        </ul>
      </noscript>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" className="max-w-full">
            <span className="truncate">{current}</span>
            <ChevronsUpDownIcon aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent aria-label={label}>
          {options.map((option) => (
            <DropdownMenuItem
              key={option.value}
              asChild
              // Le menu se refermerait **avant** que la soumission ne parte :
              // Radix démonte son portail à la sélection, et le bouton avec.
              // Empêcher la fermeture laisse le clic faire ce que HTML prévoit ;
              // la navigation qui suit remplace la page de toute façon.
              onSelect={(event) => {
                event.preventDefault()
              }}
            >
              <button
                type="submit"
                form={formId}
                name={fieldName}
                value={option.value}
                aria-current={option.value === currentValue ? 'true' : undefined}
              >
                {option.value === currentValue ? (
                  <CheckIcon aria-hidden />
                ) : (
                  <span className="size-4" aria-hidden />
                )}
                {option.label}
              </button>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </form>
  )
}
