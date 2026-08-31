import { unflattenMessages, type NestedMessages } from '@repo/core'

import { requestConfigFor } from '../../apps/web/i18n/request-config'
import { flatMessagesFor } from '../../apps/web/lib/messages'

/**
 * Le **catalogue pseudo-locale** : chaque valeur remplacée par un marqueur
 * dérivé de sa clé.
 *
 * C'est le levier de `tests/rendered-text.test.ts`, et il est inversé par
 * rapport à un balayage de source : au lieu de chercher dans le code les formes
 * qui ressemblent à du texte — une liste qu'on élargit à chaque évasion —, il
 * rend les écrans avec un catalogue dont **toute** valeur est reconnaissable,
 * puis refuse ce qui n'en vient pas. La forme de la source n'entre pas dans la
 * question : une variable, un littéral d'objet, une concaténation, un appel de
 * fonction ou un `dangerouslySetInnerHTML` produisent tous une chaîne qui n'est
 * pas un marqueur.
 *
 * Les marqueurs portent des délimiteurs qu'aucun clavier ne produit par
 * accident (`⟦` U+27E6, `⟧` U+27E7) : un texte écrit en dur ne peut pas se faire
 * passer pour l'un d'eux.
 */
const OPEN = '⟦'
const CLOSE = '⟧'

export const markerFor = (key: string): string => `${OPEN}${key}${CLOSE}`

export const isMarker = (value: string): boolean =>
  value.startsWith(OPEN) && value.endsWith(CLOSE) && value.length > OPEN.length + CLOSE.length

/** Les clés réellement livrées par l'application et ses modules activés. */
export const catalogueKeys = (locale: string): readonly string[] =>
  Object.keys(flatMessagesFor(locale))

export const pseudoMessages = (locale: string): NestedMessages =>
  unflattenMessages(Object.fromEntries(catalogueKeys(locale).map((key) => [key, markerFor(key)])))

/**
 * La configuration de rendu de la pseudo-locale : le catalogue de marqueurs,
 * **avec les gestionnaires de la vraie configuration de requête**.
 *
 * Reprendre `requestConfigFor` n'est pas une commodité : c'est ce qui fait qu'un
 * écran citant une clé absente lève pendant ce rendu au lieu d'afficher le
 * chemin de la clé. La moitié « présence » du critère 3 est donc éprouvée par
 * le rendu lui-même, sans extraction statique.
 */
export const pseudoRequestConfig = (locale: string) => ({
  ...requestConfigFor(locale),
  messages: pseudoMessages(locale),
})
