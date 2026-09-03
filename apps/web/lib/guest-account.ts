import { authRoutePath } from '@repo/module-auth'
import type { GuestAccounts } from '@repo/module-billing'

/**
 * **Le compte d'un paiement invité** (s24, ADR 047) — la règle qui décide,
 * isolée de ce qui la construit, comme `lib/billing-permission.ts`.
 *
 * Elle vit ici, au point de composition, parce que le module `billing` ne
 * déclare aucun `requires` (ADR 034) et ne connaît pas `auth` : créer un compte
 * depuis le webhook ne peut donc pas se faire dans le module. C'est la même
 * forme que `seatsOf` et `seatSync` de s23 — le module dit ce dont il a besoin,
 * l'application sait comment le fournir.
 *
 * ## Le point sur lequel tout repose : le lien envoyé
 *
 * | L'adresse du paiement | Ce qui part |
 * |---|---|
 * | **aucun compte** | un lien de **définition de mot de passe** |
 * | **un compte existe déjà** | un **magic link**, et rien d'autre |
 *
 * La seconde ligne est la décision de cette story, et elle n'est pas
 * négociable. N'importe qui peut payer en saisissant l'adresse d'un tiers :
 * envoyer alors un lien de définition de mot de passe transformerait un
 * paiement en **chemin de réinitialisation déclenchable par un tiers**, sans
 * possession du mot de passe actuel. La boîte mail reste la barrière dans les
 * deux cas, mais l'un ne fait que connecter le titulaire, l'autre écrase son
 * secret.
 *
 * ## Deux choses qu'elle ne fait jamais
 *
 * - **Ouvrir une session.** Ni ici, ni à la page de retour, ni depuis un
 *   identifiant de session de paiement (critère 7). Le seul chemin vers le
 *   compte passe par un lien envoyé à l'adresse.
 * - **Croire l'adresse sur parole.** « Vérifiée par le paiement » est une
 *   affirmation du fournisseur, pas une preuve de possession de la boîte. Le
 *   compte neuf est donc créé **non vérifié** : c'est la consommation du lien
 *   — reçu dans la boîte — qui prouve la possession, et c'est elle qui marque
 *   l'adresse (`onPasswordReset` côté `auth`, et le greffon magic-link pour
 *   l'autre branche).
 *
 * ## L'idempotence, et où elle se joue
 *
 * `accountFor` est idempotente **par l'adresse** : elle retrouve avant de
 * créer, et l'unicité de `auth_user.email` ferme la course. C'est le seul
 * endroit du parcours où un second compte pourrait naître — la ligne client,
 * elle, est protégée par l'unicité de `provider_customer_id`. Le module
 * n'appelle `sendAccessLink` que lorsque le journal d'événements a **réellement**
 * accepté l'événement : un rejeu ne renvoie donc pas un second lien.
 */

/**
 * Ce que la règle a besoin de connaître de l'authentification : **la surface
 * pass-through et la lecture par adresse**, et rien d'autre.
 *
 * Réduite à cela pour que la règle soit éprouvable sans monter l'application —
 * `lib/auth.ts` importe `next/headers`, et le webhook s'exécute aussi hors de
 * Next (`e2e/billing.spec.ts`, `scripts/billing-reconcile.ts`). Elle est donc
 * résolue **de façon différée et asynchrone**, comme `emailOfScope`.
 */
export interface GuestAccountAuth {
  handle(request: Request): Promise<Response>
  readonly useCases: {
    identifyAccount(email: string): Promise<{ readonly userId: string } | null>
  }
}

export interface GuestAccountOptions {
  /** L'URL publique. Les requêtes internes sont construites dessus, jamais devinées. */
  readonly appUrl: string
  /**
   * Le mot de passe posé sur un compte neuf — **que personne ne connaît**.
   *
   * Il faut en poser un : la bibliothèque n'ouvre le parcours « définir mon mot
   * de passe » que sur un compte qui porte déjà un justificatif de type
   * `credential`, et un compte sans justificatif ne pourrait recevoir qu'un
   * magic link. Il est donc tiré du générateur cryptographique du système, il
   * n'est écrit nulle part, il ne part dans aucun email, et il est remplacé par
   * le premier usage du lien.
   */
  readonly generatePassword: () => string
  /** Où le magic link ramène. Un chemin interne, jamais une valeur reçue. */
  readonly callbackPath?: string
}

const jsonRequest = (url: string, body: unknown): Request =>
  new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

export function guestAccountsOf(
  auth: () => Promise<GuestAccountAuth>,
  options: GuestAccountOptions,
): GuestAccounts {
  const url = (path: Parameters<typeof authRoutePath>[0]): string =>
    `${options.appUrl}${authRoutePath(path)}`

  return {
    accountFor: async ({ email }) => {
      const service = await auth()
      const existing = await service.useCases.identifyAccount(email)

      if (existing !== null) {
        // **Rattaché, jamais dupliqué** (critère 4). C'est aussi ce qui rend le
        // rejeu inerte : un second passage retrouve le compte créé au premier.
        return { userId: existing.userId, created: false }
      }

      await service.handle(
        jsonRequest(url('signUp'), {
          email,
          // Le nom affiché : l'adresse, comme à l'inscription ordinaire. Le
          // fournisseur de paiement en donne parfois un, mais c'est une saisie
          // libre d'un tiers — elle n'entre pas dans le compte.
          name: email,
          password: options.generatePassword(),
        }),
      )

      // **Relu, jamais déduit du corps de la réponse** : la bibliothèque rend
      // une réponse générique quand l'adresse est déjà prise, et lire son corps
      // ferait dépendre la création d'un format qu'elle peut changer. Si rien
      // n'a été créé, il n'y a pas de compte à rattacher, et on le dit.
      const created = await service.useCases.identifyAccount(email)

      return created === null ? null : { userId: created.userId, created: true }
    },

    sendAccessLink: async ({ account, email }) => {
      const service = await auth()

      if (account.created) {
        // **Compte neuf : définir son mot de passe.** Le lien est reconstruit
        // par le module `auth` autour de son écran `/reset-password` ; celui de
        // la bibliothèque viserait un segment dynamique que le contrat de
        // module ne sait pas déclarer (ADR 017).
        await service.handle(jsonRequest(url('requestPasswordReset'), { email }))

        return
      }

      /**
       * **Compte existant : un magic link, et rien d'autre.**
       *
       * Voir l'en-tête de ce fichier. Poster ici sur
       * `request-password-reset` — c'est-à-dire envoyer un lien de définition
       * de mot de passe à l'adresse d'un tiers parce que quelqu'un a payé —
       * est exactement ce que cette story interdit.
       */
      await service.handle(
        jsonRequest(url('magicLink'), {
          email,
          callbackURL: options.callbackPath ?? '/billing',
        }),
      )
    },
  }
}
