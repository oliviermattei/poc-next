import { z } from 'zod'

/**
 * Règles métier pures du module de démonstration.
 *
 * Aucun framework, aucun ORM, aucun SDK, aucun module de Node : la pureté du
 * `domain` est vérifiée par `pnpm lint` (ADR 006), pas par relecture.
 *
 * `zod` est explicitement autorisé ici : ce n'est ni un framework, ni un ORM,
 * ni un SDK — c'est une bibliothèque pure, sans entrée-sortie, et un type de
 * valeur validé appartient au domaine. Le socle de sécurité impose Zod aux
 * frontières ; il ne l'interdit pas au centre.
 */

/** Un titre est un texte non vide, sans espaces superflus, de 80 caractères au plus. */
export const demoItemTitleSchema = z.string().trim().min(1).max(80)

export interface DemoItem {
  readonly id: string
  readonly ownerId: string
  readonly title: string
}

export class InvalidDemoItemError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidDemoItemError'
  }
}

/**
 * Construit un élément valide, ou refuse.
 *
 * La règle vit ici et nulle part ailleurs : une route qui validerait de son
 * côté ferait exister deux vérités, et c'est toujours la plus permissive qui
 * gagne.
 */
export function createDemoItem(input: {
  readonly id: string
  readonly ownerId: string
  readonly title: string
}): DemoItem {
  const title = demoItemTitleSchema.safeParse(input.title)

  if (!title.success) {
    throw new InvalidDemoItemError(
      'Le titre d’un élément de démonstration doit contenir de 1 à 80 caractères.',
    )
  }

  return { id: input.id, ownerId: input.ownerId, title: title.data }
}
