import {
  unflattenMessages,
  type FlatMessages,
  type ModuleRegistry,
  type NestedMessages,
} from '@repo/core'

import { moduleRegistry } from './module-registry'
import enMessages from '../messages/en.json' with { type: 'json' }
import frMessages from '../messages/fr.json' with { type: 'json' }

/**
 * Le catalogue d'une locale : les traductions de l'application, plus **celles
 * des modules activés**.
 *
 * C'est ici que l'agrégation du registre devient réelle. Elle existait depuis
 * s03 et personne ne la lisait : `registry.messages` était construit, préfixé
 * par module, et jeté. Désormais un module qui déclare `messages` voit ses clés
 * arriver à l'écran, et le couper les retire — sans casser le chargement des
 * autres, puisqu'il n'y a rien à retirer : le registre ne les a jamais mises.
 *
 * Les deux moitiés ne peuvent pas se marcher dessus : les clés de module sont
 * préfixées par leur identifiant (`qualifyMessageKey`), celles de
 * l'application par `app.`. Un module qui s'appellerait `app` serait refusé par
 * la collision de clés que `unflattenMessages` lève.
 */
const APPLICATION_MESSAGES: Readonly<Record<string, FlatMessages>> = {
  fr: frMessages,
  en: enMessages,
}

/**
 * Le catalogue **plat** d'une locale, application et modules activés confondus.
 *
 * Le registre est un paramètre, avec le registre de l'application par défaut :
 * c'est ce qui permet d'observer le catalogue d'une **autre** configuration —
 * un module coupé — sans dépendre de l'état de `config/features.ts`. Un test
 * qui n'est vrai que dans l'état courant du dépôt ne prouve rien sur la
 * modularité.
 */
export function flatMessagesFor(
  locale: string,
  registry: ModuleRegistry = moduleRegistry,
): FlatMessages {
  return {
    ...(APPLICATION_MESSAGES[locale] ?? {}),
    ...(registry.messages[locale] ?? {}),
  }
}

/** Le même catalogue, dans la forme imbriquée que `next-intl` consomme. */
export function messagesFor(locale: string): NestedMessages {
  return unflattenMessages(flatMessagesFor(locale))
}
