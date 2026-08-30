import type { WebhookHandler } from '@repo/core'
import { z } from 'zod'

import type { DemoItemUseCases } from '../application/demo-items'

/**
 * Un webhook entrant, et la seule propriété qui compte pour lui : **rejouer le
 * même événement ne produit pas un second effet** (socle de fiabilité). La clé
 * de rejeu est l'identifiant d'événement, porté par le contrat — sans lui,
 * chaque module inventerait la sienne.
 *
 * La vérification de signature appartient au transport (la couche API), pas au
 * module : elle a lieu avant que cet appel n'existe.
 */
const importedEventSchema = z.object({
  ownerId: z.string().min(1),
  title: z.string(),
})

export function createDemoWebhookHandlers(
  useCases: DemoItemUseCases,
): readonly WebhookHandler[] {
  const handledEventIds = new Set<string>()

  return [
    {
      id: 'demo-item-imported',
      source: 'demo',
      eventTypes: ['demo.item.imported'],
      handle: async (event) => {
        if (handledEventIds.has(event.id)) {
          return
        }

        const parsed = importedEventSchema.safeParse(event.payload)

        if (!parsed.success) {
          // Un événement malformé est refusé sans effet de bord, et sans être
          // marqué comme traité : le rejeu d'un événement corrigé reste possible.
          return
        }

        handledEventIds.add(event.id)

        await useCases.addDemoItem(parsed.data)
      },
    },
  ]
}
