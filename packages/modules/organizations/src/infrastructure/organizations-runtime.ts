import { randomUUID } from 'node:crypto'

import type { Mailer } from '@repo/ports'

import {
  createOrganizationsUseCases,
  type OrganizationsUseCases,
} from '../application/organization-use-cases'
import type {
  InvitationTokenFactory,
  NotifyRecipient,
  SeatSync,
  SecurityLog,
} from '../application/ports'
import { consoleSecurityLog } from './console-security-log'
import {
  createDrizzleOrganizationRepository,
  type OrganizationsDatabase,
} from './drizzle-organization-repositories'
import { createInvitationTokenFactory } from './invitation-tokens'

/**
 * Le service du module, **construit à la première requête**, pas à l'import.
 *
 * `config/features.ts` charge le contrat du module, et ce fichier est lu par
 * `pnpm ks list` comme par `pnpm db:generate`, qui n'ont pas de base. Les
 * routes reçoivent donc un accès **différé** au service, posé par le point de
 * composition de l'application. Une route appelée avant cette configuration
 * échoue en le disant, elle ne sert rien à moitié — c'est le patron du module
 * `auth`.
 */

export interface ConfigureOrganizationsOptions {
  /** Connexion Drizzle, fournie par le point de composition (jamais lue ici). */
  readonly db: OrganizationsDatabase
  /**
   * Les identifiants publics que le produit se réserve : les routes du système.
   * Le module ne les connaît pas — l'application les dérive et les transmet.
   */
  readonly reservedSlugs: ReadonlySet<string>
  /** Fabrique d'identifiants, pour que la suite puisse en poser de déterministes. */
  readonly generateId?: (prefix: string) => string
  /**
   * Le port d'envoi d'emails, **fourni** par le point de composition (s16).
   *
   * Le module ne sait pas qu'il existe un fournisseur ni une capture locale : il
   * ne connaît que `Mailer` (`@repo/ports`), exactement comme le module `auth`.
   */
  readonly mailer: Mailer
  /** L'URL publique, qui construit le lien d'invitation. Jamais déduite d'un en-tête. */
  readonly appUrl: string
  /** La langue de l'email d'invitation : celle du site, faute de destinataire connu. */
  readonly emailLocale: string
  /** L'horloge, injectable : une échéance non injectée est une échéance non testable. */
  readonly now?: () => Date
  /** La fabrique de jetons. Injectable pour la même raison que l'horloge. */
  readonly tokens?: InvitationTokenFactory
  /**
   * Le journal des événements de sécurité (s17, `docs/security.md` §7).
   *
   * Injectable pour la même raison que l'horloge : un journal non injecté est un
   * journal qu'aucun cas ne peut lire. Par défaut, la sortie standard.
   */
  readonly securityLog?: SecurityLog
  /**
   * Ce que la nouvelle taille de l'organisation doit traverser **avant** que
   * l'écriture qui l'a changée soit validée (s23, ADR 046).
   *
   * **Obligatoire, jamais optionnelle avec un repli permissif** : un point de
   * composition qui l'oublierait laisserait la facturation dériver en silence,
   * et cette dérive ne se découvre qu'à la facture du client. Le compilateur
   * réclame donc la ligne. Un projet sans facturation la rend `true` — ne rien
   * avoir à faire est un succès.
   */
  readonly seatSync: SeatSync
  /**
   * L'émission de notifications de l'application (s32).
   *
   * **Obligatoire, pour la raison qui rend `seatSync` obligatoire** : un repli
   * neutre ferait d'un point de composition distrait un produit qui n'avertit
   * plus personne, et cela ne se découvrirait qu'à la plainte d'un client. Le
   * compilateur réclame donc la ligne.
   */
  readonly notify: NotifyRecipient
}

export interface OrganizationsService {
  readonly useCases: OrganizationsUseCases
}

export class OrganizationsNotConfiguredError extends Error {
  constructor() {
    super(
      'Le module « organizations » n’est pas configuré : le point de composition ' +
        'de l’application doit appeler configureOrganizations() avant de servir une requête.',
    )
    this.name = 'OrganizationsNotConfiguredError'
  }
}

let service: OrganizationsService | null = null
let provider: (() => ConfigureOrganizationsOptions) | null = null

const defaultIdGenerator = (prefix: string): string => `${prefix}_${randomUUID()}`

const build = (options: ConfigureOrganizationsOptions): OrganizationsService => ({
  useCases: createOrganizationsUseCases({
    repository: createDrizzleOrganizationRepository(options.db, options.seatSync),
    reservedSlugs: options.reservedSlugs,
    generateId: options.generateId ?? defaultIdGenerator,
    mailer: options.mailer,
    appUrl: options.appUrl,
    emailLocale: options.emailLocale,
    now: options.now ?? (() => new Date()),
    tokens: options.tokens ?? createInvitationTokenFactory(),
    securityLog: options.securityLog ?? consoleSecurityLog,
    notify: options.notify,
  }),
})

/** Construit le service **maintenant**. C'est la forme qu'une suite de tests emploie. */
export function configureOrganizations(
  options: ConfigureOrganizationsOptions,
): OrganizationsService {
  service = build(options)

  return service
}

/**
 * Dit **comment** construire le service, sans le construire.
 *
 * C'est la forme que le point de composition de l'application emploie, et la
 * différence n'est pas cosmétique : le répartiteur de modules prépare les
 * services à **chaque** requête, y compris celles qu'aucune route ne
 * satisfait. Construire aussitôt ouvrirait une connexion à la base pour
 * répondre 404 sur un chemin inconnu — mesuré, `tests/module-off.test.ts`
 * échouait faute de `DATABASE_URL` sur exactement ce cas. Rien n'est donc
 * construit tant qu'une route du module n'est pas réellement servie.
 */
export function provideOrganizations(factory: () => ConfigureOrganizationsOptions): void {
  provider = factory
}

export function requireOrganizationsService(): OrganizationsService {
  if (service !== null) {
    return service
  }

  if (provider === null) {
    throw new OrganizationsNotConfiguredError()
  }

  service = build(provider())

  return service
}

/** Remet le module à son état non configuré. Réservé aux suites de tests. */
export function resetOrganizationsService(): void {
  service = null
  provider = null
}
