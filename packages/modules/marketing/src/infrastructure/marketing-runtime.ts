import { randomUUID } from 'node:crypto'

import { resolveLocale } from '@repo/core'
import type { Mailer, RateLimiter } from '@repo/ports'

import {
  createPublicFormsUseCases,
  type PublicFormsUseCases,
} from '../application/public-forms'
import type { ScopeEmailResolver } from '../application/ports'
import type { MarketingForms } from '../domain/marketing-config'
import {
  createDrizzleContactMessages,
  createDrizzlePublicSubscriptions,
  type MarketingDatabase,
} from './drizzle-public-forms'
import { createSharedSubmissionThrottle } from './shared-submission-throttle'

/**
 * Le service du module, **construit à la première requête**, pas à l'import.
 *
 * `config/features.ts` charge le contrat du module, et ce fichier est lu par
 * `pnpm ks list` comme par `pnpm db:generate`, qui n'ont ni base ni mailer. Les
 * routes reçoivent donc un accès **différé** au service, posé par le point de
 * composition de l'application (`apps/web/lib/marketing.ts`). Une route appelée
 * avant cette configuration échoue en le disant, elle ne sert rien à moitié.
 *
 * C'est le patron de `auth` et de `organizations`, repris à l'identique — y
 * compris la distinction entre `configureMarketing` (construit maintenant : ce
 * qu'une suite de tests emploie) et `provideMarketing` (dit **comment**
 * construire : ce que l'application emploie, pour qu'aucune connexion ne
 * s'ouvre au seul fait qu'une requête a atteint le répartiteur).
 */

export interface ConfigureMarketingOptions {
  /** Connexion Drizzle, fournie par le point de composition (jamais lue ici). */
  readonly db: MarketingDatabase
  readonly mailer: Mailer
  /**
   * Le compteur **partagé** du dépôt (s28, ADR 050).
   *
   * Obligatoire, et le mot compte : facultatif, il aurait laissé un point de
   * composition retomber silencieusement sur un compteur local, c'est-à-dire
   * sur la duplication que cette story supprime.
   */
  readonly rateLimiter: RateLimiter
  /** Destinataire du contact, source d'inscription et seuils : de `config/marketing.ts`. */
  readonly forms: MarketingForms
  /** Les langues servies, pour que l'email parte dans celle de la requête. */
  readonly locales?: readonly string[]
  readonly defaultLocale?: string
  /**
   * L'adresse d'un périmètre de purge ou d'export.
   *
   * Le module ne connaît pas `auth` et ne lit pas ses tables : c'est
   * l'application qui résout un identifiant de compte en adresse.
   */
  readonly emailOfScope: ScopeEmailResolver
  readonly now?: () => Date
  readonly generateId?: () => string
  readonly runInBackground?: (task: Promise<unknown>) => void
}

export interface MarketingService {
  readonly useCases: PublicFormsUseCases
}

export class MarketingNotConfiguredError extends Error {
  constructor() {
    super(
      'Le module « marketing » n’est pas configuré : le point de composition ' +
        'de l’application doit appeler provideMarketing() avant de servir une requête.',
    )
    this.name = 'MarketingNotConfiguredError'
  }
}

let service: MarketingService | null = null
let provider: (() => ConfigureMarketingOptions) | null = null

const build = (options: ConfigureMarketingOptions): MarketingService => {
  const locales = options.locales ?? ['fr']
  const defaultLocale = options.defaultLocale ?? locales[0] ?? 'fr'

  return {
    useCases: createPublicFormsUseCases({
      contactMessages: createDrizzleContactMessages(options.db),
      subscriptions: createDrizzlePublicSubscriptions(options.db),
      // s28 : le compteur est celui du port partagé. `public_form_throttle`
      // n'est plus écrite — la règle des deux seaux, elle, reste ici.
      throttle: createSharedSubmissionThrottle({
        limiter: options.rateLimiter,
        windowSeconds: options.forms.rateLimit.windowSeconds,
      }),
      mailer: options.mailer,
      forms: options.forms,
      now: options.now ?? (() => new Date()),
      // Un identifiant, pas un préfixe : il sert aux deux tables du chemin de
      // soumission, et « sub_ » sur une ligne de `contact_message` mentirait.
      generateId: options.generateId ?? (() => randomUUID()),
      // La **règle unique** de langue d'un email, celle de `@repo/core` : la
      // même que l'écran applique à la requête. Une seconde implémentation
      // ferait recevoir un email anglais à qui lit le site en français.
      emailLocaleFor: (candidate) => resolveLocale({ locales, defaultLocale, candidate }),
      emailOfScope: options.emailOfScope,
      runInBackground:
        options.runInBackground ??
        ((task: Promise<unknown>) => {
          // L'échec d'envoi est déjà journalisé par l'implémentation du port ;
          // ce `catch` n'est là que pour ne pas laisser un rejet non traité
          // tomber le processus, faute d'appelant pour l'attendre.
          void task.catch(() => {})
        }),
    }),
  }
}

/** Construit le service **maintenant**. C'est la forme qu'une suite de tests emploie. */
export function configureMarketing(options: ConfigureMarketingOptions): MarketingService {
  service = build(options)

  return service
}

/**
 * Dit **comment** construire le service, sans le construire.
 *
 * Le répartiteur de modules prépare les services à **chaque** requête, y
 * compris celles qu'aucune route ne satisfait : construire aussitôt ouvrirait
 * une connexion à la base pour répondre 404 sur un chemin inconnu — mesuré en
 * s15, `tests/module-off.test.ts` échouait exactement là.
 */
export function provideMarketing(factory: () => ConfigureMarketingOptions): void {
  provider = factory
}

export function requireMarketingService(): MarketingService {
  if (service !== null) {
    return service
  }

  if (provider === null) {
    throw new MarketingNotConfiguredError()
  }

  service = build(provider())

  return service
}

/** Remet le module à son état non configuré. Réservé aux suites de tests. */
export function resetMarketingService(): void {
  service = null
  provider = null
}
