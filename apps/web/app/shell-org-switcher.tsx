'use client'

import { OrgSwitcher, type OrgSwitcherProps } from '@repo/ui'
import { usePathname } from 'next/navigation'

/**
 * Le sélecteur d'organisation **de la barre du haut** (s62c).
 *
 * Il ne fait qu'une chose de plus que `OrgSwitcher` : poster l'écran où il est
 * affiché, dans le champ `next`, pour que le changement d'organisation y
 * revienne (critère 2). C'est pourquoi il est client — le chemin courant se lit
 * par `usePathname()`, que le shell serveur ne connaît pas.
 *
 * **Le chemin seul, sans la chaîne de requête** : `useSearchParams` forcerait un
 * rendu client de toute la barre (ADR 076). La valeur est une donnée reçue par
 * la route, qui la filtre avant de s'en servir.
 */
export function ShellOrgSwitcher(props: Omit<OrgSwitcherProps, 'returnTo'>) {
  return <OrgSwitcher {...props} returnTo={{ name: 'next', value: usePathname() }} />
}
