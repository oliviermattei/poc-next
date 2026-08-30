import { z } from 'zod'

/** Règle métier pure : une note a un corps non vide de 500 caractères au plus. */
export const demoNoteBodySchema = z.string().trim().min(1).max(500)

export interface DemoNote {
  readonly id: string
  readonly ownerId: string
  readonly body: string
}

export class InvalidDemoNoteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidDemoNoteError'
  }
}

export function createDemoNote(input: {
  readonly id: string
  readonly ownerId: string
  readonly body: string
}): DemoNote {
  const body = demoNoteBodySchema.safeParse(input.body)

  if (!body.success) {
    throw new InvalidDemoNoteError(
      'Le corps d’une note de démonstration doit contenir de 1 à 500 caractères.',
    )
  }

  return { id: input.id, ownerId: input.ownerId, body: body.data }
}
