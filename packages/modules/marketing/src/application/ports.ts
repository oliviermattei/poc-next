import type { ModuleScope } from '@repo/core'
import type { Mailer } from '@repo/ports'

import type { MarketingForms } from '../domain/marketing-config'
import type { RateLimitBucket } from '../domain/rate-limit'

/**
 * Les **ports** du module (ADR 006) : ce dont les cas d'usage des formulaires
 * publics ont besoin, dit par eux, sans savoir qui l'implémente.
 * `infrastructure/` les branche sur Drizzle et sur le port `Mailer` de s06.
 *
 * Aucun de ces ports ne connaît une requête HTTP, un en-tête ou une table.
 */

/** Une inscription publique, telle que le module la manipule. */
export interface PublicSubscriptionRecord {
  readonly id: string
  readonly email: string
  readonly source: string
  readonly locale: string
  readonly createdAt: Date
}

/**
 * Un message de contact, tel que le module le conserve.
 *
 * `deliveredAt` est la **trace** : vide, le message a été reçu mais n'est pas
 * parti. C'est ce que le constat F8 de la revue de s11 exigeait — jusque-là, un
 * envoi en échec rendait 502 et ne laissait rien derrière lui, si bien que le
 * message était perdu pour de bon. Une colonne nullable suffit à donner à
 * l'éditeur de quoi rattraper ce que le fournisseur n'a pas pris.
 */
export interface ContactMessageRecord {
  readonly id: string
  readonly name: string
  readonly email: string
  readonly message: string
  readonly locale: string
  readonly createdAt: Date
  /** Date de remise au fournisseur, ou `null` : reçu, pas encore parti. */
  readonly deliveredAt: Date | null
}

export interface ContactMessageRepository {
  /** Enregistre le message. Appelé **avant** l'envoi, jamais après. */
  record(input: {
    readonly id: string
    readonly name: string
    readonly email: string
    readonly message: string
    readonly locale: string
  }): Promise<ContactMessageRecord>

  markDelivered(input: { readonly id: string; readonly at: Date }): Promise<void>

  /** Les messages envoyés depuis une adresse. Périmètre d'export et de purge. */
  listByEmail(email: string): Promise<readonly ContactMessageRecord[]>

  deleteByEmail(email: string): Promise<number>
}

export interface PublicSubscriptionRepository {
  /**
   * Inscrit, ou **ne fait rien** si le couple `(source, email)` existe déjà.
   *
   * Rend l'inscription créée, ou `null` quand il n'y avait rien à créer. C'est
   * cette valeur, et non une lecture préalable, qui dit s'il faut envoyer un
   * email de confirmation : une vérification suivie d'une insertion laisserait
   * la fenêtre où deux soumissions simultanées écrivent toutes les deux
   * (`docs/reliability.md` §1).
   */
  subscribe(input: {
    readonly id: string
    readonly email: string
    readonly source: string
    readonly locale: string
  }): Promise<PublicSubscriptionRecord | null>

  /** Les inscriptions d'une adresse, toutes sources confondues. */
  listByEmail(email: string): Promise<readonly PublicSubscriptionRecord[]>

  /** Efface les inscriptions d'une adresse. Rend le nombre de lignes effacées. */
  deleteByEmail(email: string): Promise<number>
}

/**
 * Le compteur partagé entre instances (`docs/security.md` §7).
 *
 * `hit` **incrémente et rend le compte** en une opération : lire puis écrire
 * laisserait deux instances observer le même compte et le dépasser toutes les
 * deux. La fenêtre est décidée par l'appelant — le domaine l'aligne — et
 * l'implémentation condense la clé avant de l'écrire.
 */
export interface SubmissionThrottle {
  hit(input: {
    readonly bucket: RateLimitBucket
    readonly windowStart: Date
  }): Promise<number>

  /**
   * Efface les seaux dont **leur propre** fenêtre est close à cet instant.
   *
   * Le paramètre est l'**instant présent**, pas une borne : le magasin est
   * partagé depuis s28 et ses seaux n'ont pas la même durée, si bien qu'une
   * borne « efface tout ce qui précède » effaçait les seaux longs encore ouverts
   * des autres routes (constat C1 de la revue de s28). C'est la ligne qui porte
   * son échéance ; un instant passé ne peut que retarder la récupération, jamais
   * effacer un seau ouvert.
   *
   * Sans lui, la table ne se vide jamais : un seau par identifiant d'appelant,
   * et l'identifiant vient d'un en-tête que le client écrit lui-même. Le
   * constat F1 de la revue de s11 l'a mesuré — 500 identifiants distincts, 500
   * lignes, rien pour les reprendre. Une fenêtre close n'a plus de lecteur :
   * ses lignes ne servent plus à rien, et elles s'effacent.
   *
   * Il rend le compte parce qu'une purge se **prouve en l'exécutant**
   * (`docs/reliability.md` §1), pas en la déclarant.
   */
  sweep(now: Date): Promise<number>
}

/**
 * L'adresse email d'un périmètre de purge ou d'export, ou `null`.
 *
 * Ce module ne connaît pas `auth` et ne lit pas ses tables : le contrat lui
 * donne un identifiant de compte, pas une adresse. C'est donc le point de
 * composition de l'application qui résout l'une depuis l'autre et l'injecte —
 * même patron que `reservedSlugs` pour les organisations. Périmètre
 * organisation : `null`, une inscription publique n'appartient à aucune
 * organisation.
 */
export type ScopeEmailResolver = (scope: ModuleScope) => Promise<string | null>

export interface PublicFormsDependencies {
  readonly contactMessages: ContactMessageRepository
  readonly subscriptions: PublicSubscriptionRepository
  readonly throttle: SubmissionThrottle
  readonly mailer: Mailer
  /** Destinataire du contact, source d'inscription et seuils : de la configuration. */
  readonly forms: MarketingForms
  readonly now: () => Date
  readonly generateId: () => string
  /** La règle de langue d'un email, la même que celle de l'écran. */
  readonly emailLocaleFor: (knownLocale: string | null | undefined) => string
  readonly emailOfScope: ScopeEmailResolver
  /**
   * Ce qui part **hors du temps de réponse**.
   *
   * Injecté, et pas seulement pour la testabilité : une inscription nouvelle
   * envoie un email, un doublon non. Dans le temps de réponse, la latence
   * dirait lequel des deux cas s'est produit, et le formulaire redeviendrait
   * l'oracle que `docs/security.md` §7 refuse. Le patron vient du module
   * `auth`, dont le courrier de réinitialisation part de la même façon.
   */
  readonly runInBackground: (task: Promise<unknown>) => void
}
