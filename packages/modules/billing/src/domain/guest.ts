import type { ModuleScope } from '@repo/core'
import { z } from 'zod'

/**
 * **Le périmètre invité — au stockage, et nulle part ailleurs** (ADR 047).
 *
 * `billing_customer` ne porte aucune clé étrangère (ADR 018) : le périmètre y
 * est stocké en deux colonnes de texte. Un visiteur sans compte peut donc y
 * être rattaché **à l'ouverture du tunnel**, c'est-à-dire au moment qu'exige
 * l'ADR 034 — dont la garantie d'ordre est ainsi préservée intacte : tout
 * événement continue de résoudre son propriétaire par `provider_customer_id`,
 * qui ne change jamais.
 *
 * `ModuleScope` (`packages/core/src/module.ts`) **n'est pas touché**, et c'est
 * le point de la décision : ce type est partagé par la purge et l'export de
 * *tous* les modules, et un troisième cas obligerait à rouvrir chaque module
 * déjà écrit pour lui faire traiter un périmètre qui n'a ni donnée à exporter
 * ni donnée à purger.
 *
 * Ce fichier ne **tire** pas d'identifiant : le `domain` n'a pas le droit de
 * connaître `node:crypto` (ADR 006). Il dit quelle forme un identifiant invité
 * doit avoir ; `infrastructure/guest-scope-id.ts` la produit.
 */

/** La troisième valeur que `billing_customer.scope_kind` peut porter. */
export const GUEST_SCOPE_KIND = 'guest'

/**
 * Les valeurs qu'une ligne client peut porter en `scope_kind`.
 *
 * **Un type de stockage, pas un type de périmètre** : `ModuleScope` garde ses
 * deux formes, et c'est `accountScopeOfCustomer` qui fait le passage — en
 * refusant l'invité.
 */
export type BillingScopeKind = ModuleScope['kind'] | typeof GUEST_SCOPE_KIND

export const isGuestScopeKind = (kind: string): boolean => kind === GUEST_SCOPE_KIND

/**
 * La forme d'un identifiant invité : **soixante-quatre hexadécimaux
 * minuscules**, soit trente-deux octets de tirage.
 *
 * Elle ne prouve pas l'entropie — une chaîne constante la satisferait —, elle
 * refuse les formes qui n'en ont visiblement aucune : un compteur, un
 * horodatage, un identifiant de session du fournisseur. L'imprévisibilité est
 * une propriété du **générateur**, et c'est là qu'elle se mesure.
 */
const GUEST_SCOPE_ID = /^[0-9a-f]{64}$/

export const isOpaqueGuestScopeId = (value: string): boolean => GUEST_SCOPE_ID.test(value)

/**
 * La référence de **diagnostic** portée chez le fournisseur.
 *
 * Elle ne décide de rien (ADR 034 : `metadata` et `client_reference_id` sont
 * modifiables depuis le tableau de bord du fournisseur, donc jamais une source
 * d'autorisation). Le préfixe la distingue d'un `user:` ou d'un
 * `organization:` : une référence invitée ne doit pas pouvoir se lire comme
 * celle d'un compte.
 */
export const guestScopeReference = (guestScopeId: string): string => `guest:${guestScopeId}`

/**
 * **Le périmètre de compte que désigne une ligne client, ou `null`.**
 *
 * `null` pour un invité, et c'est la règle qu'ADR 047 impose : « une requête
 * qui lit *le client de ce périmètre* doit ignorer les invités partout où elle
 * sert un compte ». Sans ce refus, une ligne invitée se reconstruirait en
 * `user:<jeton opaque>` — un compte que personne n'a jamais créé — et la
 * réconciliation le passerait au compteur de sièges comme un périmètre réel.
 */
export const accountScopeOfCustomer = (customer: {
  readonly scopeKind: string
  readonly scopeId: string
}): ModuleScope | null => {
  if (customer.scopeKind === 'organization') {
    return { kind: 'organization', organizationId: customer.scopeId }
  }

  return customer.scopeKind === 'user' ? { kind: 'user', userId: customer.scopeId } : null
}

/**
 * **L'adresse du payeur, à la frontière** (`docs/security.md` §4).
 *
 * Elle vient du fournisseur de paiement, donc de l'extérieur : « vérifiée par
 * le paiement » est une **affirmation du fournisseur**, pas une preuve de
 * possession de la boîte. C'est exactement pourquoi elle ne sert qu'à deux
 * choses — retrouver ou créer un compte, et lui envoyer un lien — et jamais à
 * ouvrir une session.
 *
 * Normalisée à la même forme que celle des invitations
 * (`organizations/domain/invitation.ts`) : découpée, minuscule, bornée, validée
 * par `z.email()`. Sans normalisation, « Alice@Example.test » et
 * « alice@example.test » fabriqueraient **deux comptes** pour une seule
 * personne, et le critère 4 tomberait sans que rien ne rougisse.
 *
 * `null` quand la valeur n'est pas une adresse : le paiement reste encaissé, la
 * ligne client reste invitée, et aucun compte n'est créé au hasard.
 */
const GUEST_EMAIL = z.string().trim().toLowerCase().min(3).max(254).pipe(z.email())

export const guestPaymentEmailOf = (value: unknown): string | null => {
  const parsed = GUEST_EMAIL.safeParse(value)

  return parsed.success ? parsed.data : null
}
