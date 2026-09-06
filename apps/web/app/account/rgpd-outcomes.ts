import { z } from 'zod'

import { retryAfterMinutes } from '../refusal-message'

/**
 * **Ce que l'écran fait des réponses des deux droits RGPD** (s34b) — et rien
 * d'autre.
 *
 * Aucune règle n'est décidée ici. La comparaison de la confirmation, la règle du
 * dernier propriétaire, l'unicité d'une demande d'export et la limitation de
 * débit vivent côté serveur, chacune avec sa mutation (s34, s35, s28). Ce
 * fichier **classe une réponse déjà rendue** : il traduit un statut HTTP en un
 * message, ce qui est la seule chose qu'un écran ait le droit de décider.
 *
 * Il est écrit à part des deux composants parce que la suite tourne en
 * environnement `node`, sans DOM (`vitest.config.ts`) : la classification est
 * la moitié mesurable au poste, et `e2e/rgpd.spec.ts` tient l'autre. C'est la
 * séparation que s28 a posée entre `tests/rate-limiting.test.ts` et
 * `e2e/rate-limiting.spec.ts`.
 */

/* ------------------------------------------------------------------------- *
 * La suppression de compte.
 * ------------------------------------------------------------------------- */

/**
 * Ce que rend `POST /auth/delete-account`, vu de l'écran.
 *
 * Quatre issues, et elles ne disent pas la même chose à qui les lit : la saisie
 * ne correspond pas ; des organisations retiennent le compte, **nommées par le
 * serveur** ; la mise en file a été refusée, donc rien n'a été effacé ; ou la
 * requête a échoué pour une raison qu'on ne prétend pas connaître.
 */
export type DeletionOutcome =
  | { readonly kind: 'accepted' }
  | DeletionRefusalOutcome

/**
 * Les issues **refusées**, et elles seules.
 *
 * `accepted` en est exclue par construction : la suppression acceptée quitte
 * l'écran (la session ne lui survit pas), donc il n'y a personne pour lire un
 * message. Un type qui la laisserait passer obligerait à écrire une clé de
 * catalogue que rien ne rend — c'est le constat mineur de la revue, fermé par
 * le compilateur plutôt que par une convention.
 */
export type DeletionRefusalOutcome =
  | { readonly kind: 'confirmation' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'sole_owner'; readonly organizations: readonly string[] }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'failed' }

/**
 * Le corps du 409, **validé avant d'être affiché**.
 *
 * Zod à chaque frontière (`docs/security.md` §4), et celle-ci en est une : ce
 * qui arrive ici a traversé le réseau, et ces chaînes sont rendues dans la
 * page. Un corps qui ne porte pas la forme attendue n'est pas un refus de
 * dernier propriétaire — il retombe sur l'échec générique plutôt que de faire
 * afficher une liste vide accompagnée d'un message qui promet des noms.
 */
const SOLE_OWNER = z.object({
  reason: z.literal('sole_owner'),
  organizations: z.array(z.string().min(1)).min(1),
})

/**
 * **Le motif d'un 400, tel que la route le nomme** (s34).
 *
 * La route en distingue trois — `confirmation_differente`, qui vient de la
 * règle et signifie que la comparaison a bel et bien eu lieu ;
 * `confirmation_absente`, qui vient de Zod et signifie qu'elle n'a pas eu
 * lieu ; et une session absente. Les fondre ferait dire à l'écran quelle règle
 * a mordu alors qu'aucune ne l'a fait — et le premier des trois est
 * atteignable à la saisie (des espaces seuls sont rognés avant la comparaison).
 *
 * Zod ici aussi : ce corps a traversé le réseau, et il décide d'un message.
 */
const CONFIRMATION_MISMATCH = z.object({ reason: z.literal('confirmation_differente') })

export function deletionOutcomeOf(status: number, body: unknown): DeletionOutcome {
  if (status === 202) {
    return { kind: 'accepted' }
  }

  // **Le statut avant le corps** : un 429 refuse au répartiteur, avant tout
  // gestionnaire, et son corps ne ressemble à aucun de ceux d'ici (s28).
  if (status === 400) {
    return CONFIRMATION_MISMATCH.safeParse(body).success
      ? { kind: 'confirmation' }
      : { kind: 'invalid' }
  }

  if (status === 409) {
    const parsed = SOLE_OWNER.safeParse(body)

    return parsed.success
      ? { kind: 'sole_owner', organizations: parsed.data.organizations }
      : { kind: 'failed' }
  }

  if (status === 503) {
    return { kind: 'unavailable' }
  }

  return { kind: 'failed' }
}

/** Le message d'un refus de suppression. Un par issue, jamais un pour deux. */
export const deletionRefusalKey = (outcome: DeletionRefusalOutcome): string => {
  switch (outcome.kind) {
    case 'confirmation':
      return 'app.account.deletion.error.confirmation'
    case 'invalid':
      return 'app.account.deletion.error.invalid'
    case 'sole_owner':
      return 'app.account.deletion.error.soleOwner'
    case 'unavailable':
      return 'app.account.deletion.error.unavailable'
    case 'failed':
      return 'app.account.deletion.error.failed'
  }
}

/* ------------------------------------------------------------------------- *
 * L'export de ses données.
 * ------------------------------------------------------------------------- */

/**
 * Ce que rend `POST /auth/data-export`, vu de l'écran — `null` quand la demande
 * est acceptée.
 *
 * Les trois refus du critère 6 y sont **distincts**, et c'est le point de la
 * story : la revue de s35 a relevé qu'aucun écran n'existait pour montrer le
 * 429. Les fondre dans un message générique jetterait ce que le serveur a
 * séparé.
 */
export type DataExportRefusal =
  | { readonly kind: 'already_pending' }
  | { readonly kind: 'throttled'; readonly minutes: number | null }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'failed' }

export function dataExportRefusalOf(response: Response): DataExportRefusal | null {
  if (response.ok) {
    return null
  }

  // **Le statut d'abord** (s28) : la limitation de débit refuse au répartiteur,
  // et l'attente vient de son en-tête, jamais d'une recopie de
  // `config/security.ts`.
  if (response.status === 429) {
    return { kind: 'throttled', minutes: retryAfterMinutes(response) }
  }

  if (response.status === 409) {
    return { kind: 'already_pending' }
  }

  if (response.status === 503) {
    return { kind: 'unavailable' }
  }

  // **Ni 403 ni 404 n'ont de branche ici**, et ce n'est pas un oubli : la carte
  // ne poste que `scope: 'user'`. Le 403 de la route est celui d'un membre non
  // propriétaire d'une **organisation**, et son 404 celui d'une organisation
  // qu'on ne connaît pas ou d'une session absente — que le répartiteur refuse
  // avant, en 401. Leur donner un message que rien ne peut afficher serait une
  // clé de catalogue morte ; ils tombent donc dans l'échec générique, comme
  // tout statut que cet écran ne sait pas provoquer.
  return { kind: 'failed' }
}

/**
 * Le message d'un refus d'export.
 *
 * Deux clés pour la limitation, comme `app/public-form.tsx` depuis s11 : le
 * message sans chiffre existe pour de bon, il sert quand l'en-tête est absent
 * ou illisible.
 */
export const dataExportRefusalKey = (refusal: DataExportRefusal): string => {
  switch (refusal.kind) {
    case 'already_pending':
      return 'app.account.export.error.alreadyPending'
    case 'throttled':
      return refusal.minutes === null
        ? 'app.account.export.error.throttled'
        : 'app.account.export.error.throttledIn'
    case 'unavailable':
      return 'app.account.export.error.unavailable'
    case 'failed':
      return 'app.account.export.error.failed'
  }
}

/* ------------------------------------------------------------------------- *
 * L'état d'une demande d'export, tel que le **serveur** le rend.
 * ------------------------------------------------------------------------- */

/**
 * Une demande, réduite à ce que l'écran affiche.
 *
 * **Aucun jeton, et il n'y en a jamais eu** : la trace que le serveur rend
 * (`DataExportTrace`) porte trois champs — l'instant de la demande, son état,
 * l'échéance du lien —, et le lien lui-même part par email vers une route
 * **publique**. Le faire passer par l'écran, fût-ce dans une URL de page,
 * donnerait accès à toutes les données d'une personne à qui lit son historique
 * de navigation.
 */
export interface DataExportRequestView {
  readonly status: string
  readonly requestedAt: string
  readonly expiresAt: string | null
}

/**
 * Ce que la carte d'export montre : la demande la plus récente, et si l'une est
 * encore en cours.
 *
 * Une demande en cours **remplace le bouton** plutôt que d'être proposée une
 * seconde fois : le serveur refuse la seconde (409, critère 7 de s35), donc un
 * écran qui l'offrirait mentirait.
 */
export interface DataExportState {
  readonly pending: boolean
  readonly latest: DataExportRequestView | null
}

export function dataExportStateOf(
  requests: readonly DataExportRequestView[],
): DataExportState {
  const latest = requests.reduce<DataExportRequestView | null>(
    (kept, candidate) =>
      kept === null || candidate.requestedAt > kept.requestedAt ? candidate : kept,
    null,
  )

  return { pending: requests.some((request) => request.status === 'pending'), latest }
}

/**
 * Le message d'un état, **un par état déclaré**.
 *
 * Un état inconnu a le sien plutôt qu'un repli silencieux : la colonne est un
 * `text`, et afficher « prête » sur une valeur qu'on ne connaît pas serait pire
 * que de dire qu'on ne sait pas.
 */
const STATE_KEYS: Readonly<Record<string, string>> = {
  pending: 'app.account.export.state.pending',
  ready: 'app.account.export.state.ready',
  failed: 'app.account.export.state.failed',
}

export const dataExportStateKey = (status: string): string =>
  STATE_KEYS[status] ?? 'app.account.export.state.unknown'
