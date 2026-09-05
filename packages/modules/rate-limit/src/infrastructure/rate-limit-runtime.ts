import type { RateLimiter } from '@repo/ports'

/**
 * Le compteur du module, **posé par le point de composition**, jamais construit
 * ici (ADR 020).
 *
 * Il existe pour **une** raison, et elle est datée : `sweepClosedWindows` est
 * déclarée au contrat depuis s28 et son corps était **vide**, avec le
 * commentaire « c'est donc l'application qui remplacera ce corps quand
 * l'ordonnanceur existera ». L'ordonnanceur existe (s33) ; ce fichier est ce
 * qu'il fallait pour que la tâche ait un corps sans que le module ouvre la base
 * à l'import — ce qu'il ferait pour `pnpm ks list` et `pnpm db:generate`, qui
 * n'en ont pas.
 *
 * Le patron est celui de `notifications`, `organizations`, `marketing` et
 * `storage` : dire **comment** construire, pas construire.
 */

export class RateLimiterNotProvidedError extends Error {
  constructor() {
    super(
      'Le compteur de limitation n’est pas fourni : le point de composition de ' +
        'l’application doit appeler provideRateLimiter() avant qu’une tâche planifiée ne ' +
        'balaie les fenêtres closes.',
    )
    this.name = 'RateLimiterNotProvidedError'
  }
}

let provider: (() => RateLimiter) | null = null

export function provideRateLimiter(factory: () => RateLimiter): void {
  provider = factory
}

export function requireRateLimiter(): RateLimiter {
  if (provider === null) {
    throw new RateLimiterNotProvidedError()
  }

  return provider()
}

/** Remet le module à son état non fourni. Réservé aux suites de tests. */
export function resetRateLimitRuntime(): void {
  provider = null
}
