import { NextIntlClientProvider } from 'next-intl'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { defaultLocale } from '../config/i18n'
import {
  dataExportRefusalKey,
  dataExportRefusalOf,
  dataExportStateOf,
  deletionOutcomeOf,
  deletionRefusalKey,
  type DataExportRefusal,
  type DataExportRequestView,
  type DeletionRefusalOutcome,
} from '../apps/web/app/account/rgpd-outcomes'

/**
 * Le routeur, absent d'un rendu de nœud : la carte d'export en demande un pour
 * redemander l'état au serveur après une demande acceptée. C'est du contexte de
 * requête, comme la session — pas une règle. Même doublure que
 * `tests/rendered-text.test.ts`.
 */
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: () => {} }),
}))

/* ------------------------------------------------------------------------- *
 * s34b — les écrans des deux droits RGPD.
 *
 * Le serveur est livré et éprouvé (s34, s35) : rien ici ne rejoue une règle du
 * serveur. Ce que ce fichier tient est ce que **l'écran** fait de la réponse :
 *
 * 1. chaque refus garde son message, et aucun ne se replie sur le message
 *    générique — c'est le constat que la revue de s35 avait laissé ouvert :
 *    « il n'existe aujourd'hui aucun écran pour afficher le 429 » ;
 * 2. la liste des organisations qui bloquent la suppression est **celle que le
 *    serveur envoie**, rendue telle quelle. Un écran qui la recalculerait — ou
 *    qui l'omettrait — aurait deux vérités, et la seconde serait celle qui ment.
 *
 * Ce que ce fichier ne peut pas tenir, et qui est tenu par `e2e/rgpd.spec.ts` :
 * la soumission elle-même. La suite Vitest tourne en environnement `node`, sans
 * DOM (`vitest.config.ts`), donc aucun clic n'y est simulable. Le dépôt sépare
 * déjà les deux depuis s28 — `tests/rate-limiting.test.ts` tient la
 * classification, `e2e/rate-limiting.spec.ts` tient ce que l'alerte affiche.
 * ------------------------------------------------------------------------- */

const messagesOf = async (): Promise<Record<string, unknown>> => {
  const { flatMessagesFor } = await import('../apps/web/lib/messages')
  const { moduleRegistry } = await import('../apps/web/lib/module-registry')
  const { unflattenMessages } = await import('@repo/core')

  return unflattenMessages(flatMessagesFor(defaultLocale, moduleRegistry)) as Record<
    string,
    unknown
  >
}

const renderWithMessages = async (node: ReactNode): Promise<string> =>
  renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale: defaultLocale, messages: await messagesOf(), children: node },
    ),
  )

describe('la suppression de compte, telle que l’écran la rend', () => {
  /**
   * Le refus rendu par le classement — et le cas rougit si le statut passait
   * pour une acceptation, ce que le compilateur interdit par ailleurs
   * (`DeletionRefusalOutcome` exclut `accepted`).
   */
  const refusalOf = (status: number, body: unknown): DeletionRefusalOutcome => {
    const outcome = deletionOutcomeOf(status, body)

    expect(outcome.kind, `le statut ${status} devait être un refus`).not.toBe('accepted')

    return outcome as DeletionRefusalOutcome
  }

  it('rend la liste d’organisations **que le serveur envoie**, sans la deviner', async () => {
    const { DeletionRefusal } = await import('../apps/web/app/account/delete-account-card')
    const outcome = refusalOf(409, {
      error: 'conflict',
      reason: 'sole_owner',
      organizations: ['Acme Corp', 'Globex'],
    })

    expect(outcome).toEqual({
      kind: 'sole_owner',
      organizations: ['Acme Corp', 'Globex'],
    })

    const markup = await renderWithMessages(createElement(DeletionRefusal, { outcome }))

    expect(markup).toContain('Acme Corp')
    expect(markup).toContain('Globex')
  })

  it('distingue le refus de confirmation, le dernier propriétaire et la mise en file refusée', () => {
    const keys = [
      deletionRefusalKey(
        refusalOf(400, { error: 'invalid_request', reason: 'confirmation_differente' }),
      ),
      deletionRefusalKey(
        refusalOf(400, { error: 'invalid_request', reason: 'confirmation_absente' }),
      ),
      deletionRefusalKey(refusalOf(409, { reason: 'sole_owner', organizations: ['Acme'] })),
      deletionRefusalKey(refusalOf(503, { error: 'unavailable' })),
      deletionRefusalKey(refusalOf(500, null)),
    ]

    expect(new Set(keys).size).toBe(keys.length)
  })

  /**
   * **La route répond 400 pour trois raisons, et elle les nomme** (s34) :
   * `confirmation_differente` vient de la règle, qui a bel et bien comparé ;
   * `confirmation_absente` vient de Zod, qui n'a rien comparé du tout ; la
   * troisième est une session absente. Les fondre en « la saisie ne correspond
   * pas à l'adresse de ce compte » fait dire à l'écran quelle règle a mordu —
   * alors qu'aucune ne l'a fait.
   *
   * Le cas est atteignable depuis l'écran : une saisie de seuls espaces est
   * rognée par Zod avant la comparaison, donc elle rend `confirmation_absente`.
   */
  it('ne prétend pas que l’adresse ne correspond pas quand rien n’a été comparé', () => {
    const compared = refusalOf(400, {
      error: 'invalid_request',
      reason: 'confirmation_differente',
    })

    for (const body of [
      { error: 'invalid_request', reason: 'confirmation_absente' },
      { error: 'invalid_request', reason: 'session absente' },
      { error: 'invalid_request' },
      null,
    ]) {
      expect(deletionRefusalKey(refusalOf(400, body)), JSON.stringify(body)).not.toBe(
        deletionRefusalKey(compared),
      )
    }
  })

  it('n’invente pas un refus de dernier propriétaire quand le serveur n’en nomme aucune', () => {
    expect(deletionOutcomeOf(409, { error: 'conflict', reason: 'autre' })).toEqual({
      kind: 'failed',
    })
  })
})

/**
 * **Le critère 5, et sa moitié qui persiste** (constat M1 de la revue).
 *
 * « Affiche l'état d'une demande en cours plutôt que d'en permettre une
 * seconde » a deux moitiés, et une seule était mesurée : le parcours navigateur
 * observe l'action qui disparaît **après** une demande acceptée, ce que le
 * drapeau local `accepted` suffit à produire. L'autre moitié — une demande
 * encore en cours **au chargement de la page** — ne se produit jamais au poste,
 * où l'exécuteur de tâches en mémoire construit l'archive à la macro-tâche
 * suivante ; avec un vrai ordonnanceur, elle dure. C'est donc la branche que
 * l'on livre sans jamais l'exécuter.
 *
 * Mesuré : `dataExportStateOf` rendant `pending: false` laissait `pnpm test` à
 * 2 531 verts et `e2e/rgpd.spec.ts` à 2 verts.
 */
describe('l’état d’une demande d’export, dérivé du serveur', () => {
  const at = (iso: string, status: string): DataExportRequestView => ({
    status,
    requestedAt: iso,
    expiresAt: null,
  })

  it('reconnaît une demande encore en cours, et n’en invente pas', () => {
    const ready = at('2026-09-01T10:00:00.000Z', 'ready')
    const failed = at('2026-09-02T10:00:00.000Z', 'failed')
    const pending = at('2026-09-03T10:00:00.000Z', 'pending')

    expect(dataExportStateOf([ready, failed, pending]).pending).toBe(true)
    expect(dataExportStateOf([ready, failed]).pending).toBe(false)
    expect(dataExportStateOf([]).pending).toBe(false)
  })

  /**
   * La seconde moitié : la carte **consomme** ce drapeau. Le serveur refuse la
   * seconde demande (409, critère 7 de `s35`), donc l'offrir serait promettre un
   * refus — et le drapeau vient du serveur, pas du navigateur.
   */
  it('retire l’action tant que le serveur dit qu’une demande est en cours', async () => {
    const { DataExportCard } = await import('../apps/web/app/account/data-export-card')
    const action = '/api/modules/auth/data-export'
    const card = async (pending: boolean): Promise<string> =>
      await renderWithMessages(
        createElement(DataExportCard, {
          action,
          pending,
          latest: { status: 'pending', requestedAt: '3 septembre 2026 à 10:00', expiresAt: null },
        }),
      )

    expect(await card(false)).toContain(action)
    expect(await card(true)).not.toContain(action)
  })
})

describe('l’export de ses données, tel que l’écran le rend', () => {
  const responseOf = (status: number, headers: Record<string, string> = {}): Response =>
    new Response(null, { status, headers })

  /** Le refus rendu par le classement, et le cas rougit si le serveur acceptait. */
  const refusalOf = (status: number, headers: Record<string, string> = {}): DataExportRefusal => {
    const refusal = dataExportRefusalOf(responseOf(status, headers))

    expect(refusal, `le statut ${status} devait être un refus`).not.toBeNull()

    return refusal as DataExportRefusal
  }

  it('garde les trois refus distincts, et aucun ne se replie sur le message générique', () => {
    const refusals = [refusalOf(409), refusalOf(429, { 'retry-after': '600' }), refusalOf(503)]
    const generic = dataExportRefusalKey(refusalOf(500))
    const keys = refusals.map(dataExportRefusalKey)

    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).not.toContain(generic)
  })

  it('lit l’attente dans l’en-tête `Retry-After` du serveur, jamais ailleurs', () => {
    expect(refusalOf(429, { 'retry-after': '600' })).toEqual({ kind: 'throttled', minutes: 10 })
    // Un en-tête absent ou illisible n'affiche **aucun** chiffre, plutôt que
    // « NaN minutes » : la règle de `app/refusal-message.ts` depuis s11.
    expect(refusalOf(429, { 'retry-after': 'jeudi' })).toEqual({ kind: 'throttled', minutes: null })
    expect(dataExportRefusalKey({ kind: 'throttled', minutes: 10 })).not.toBe(
      dataExportRefusalKey({ kind: 'throttled', minutes: null }),
    )
  })

  it('une demande acceptée n’est pas un refus', () => {
    expect(dataExportRefusalOf(responseOf(202))).toBeNull()
  })
})
