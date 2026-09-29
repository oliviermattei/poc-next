import { MODULE_ROUTE_PREFIX } from '@repo/core'
import { describe, expect, it } from 'vitest'

import type {
  OrganizationOutcome,
  OrganizationsUseCases,
} from '../application/organization-use-cases'
import {
  createOrganizationRoutes,
  MEMBERS_SCREEN_PATH,
  organizationRoutePath,
  ORGANIZATIONS_SCREEN_PATH,
} from './organization-routes'

/**
 * **Chaque action revient sur la rubrique de l'action** (s62b).
 *
 * Depuis que l'écran des organisations est rangé en deux rubriques, un 303 vers
 * la mauvaise ne casse aucune carte : l'écran s'affiche, simplement pas celui où
 * l'on vient d'agir, et le motif d'un refus s'affiche sous une rubrique qui ne
 * montre pas le formulaire refusé. Seul un cas par action le voit.
 *
 * Ce qui est doublé ici est **l'application**, jamais une règle : ce fichier
 * juge la destination que la route choisit pour un résultat donné, et les règles
 * qui produisent ce résultat sont prouvées à côté d'elles
 * (`domain/*.test.ts`, `tests/organizations.test.ts` contre une vraie base).
 *
 * L'acceptation d'une invitation n'est pas dans la table : son refus retourne à
 * l'écran d'invitation, pas à une rubrique — elle a son propre cas plus bas.
 */
const EXPECTED: Readonly<Record<string, string>> = {
  [organizationRoutePath('create')]: ORGANIZATIONS_SCREEN_PATH,
  [organizationRoutePath('switch')]: ORGANIZATIONS_SCREEN_PATH,
  [organizationRoutePath('update')]: ORGANIZATIONS_SCREEN_PATH,
  [organizationRoutePath('delete')]: ORGANIZATIONS_SCREEN_PATH,
  [organizationRoutePath('invite')]: MEMBERS_SCREEN_PATH,
  [organizationRoutePath('resendInvitation')]: MEMBERS_SCREEN_PATH,
  [organizationRoutePath('revokeInvitation')]: MEMBERS_SCREEN_PATH,
  [organizationRoutePath('removeMember')]: MEMBERS_SCREEN_PATH,
  [organizationRoutePath('setMemberRole')]: MEMBERS_SCREEN_PATH,
}

/**
 * **Un filtre qui laisse tout passer**, délibérément (s62c, ADR 076).
 *
 * Ce fichier ne peut pas importer le vrai (`@repo/module-auth`, frontière de
 * `docs/security.md` §7), et il n'en a pas besoin : les cas d'ici prouvent que
 * la route **ne lit pas** `next` là où elle ne doit pas — un refus, une autre
 * route. Avec un filtre permissif, une route qui le lirait quand même rougit.
 * Les chemins que le filtre refuse sont joués contre le vrai, dans
 * `tests/organizations.test.ts`.
 */
const letEverythingThrough = (candidate: string | null | undefined, fallback: string): string =>
  candidate ?? fallback

/** Des cas d'usage qui répondent tous `outcome`, quelle que soit l'action. */
const answering = (outcome: OrganizationOutcome) => {
  const useCases = new Proxy(
    {},
    { get: () => () => Promise.resolve(outcome) },
  ) as OrganizationsUseCases

  return createOrganizationRoutes(() => ({ useCases, safeReturnPath: letEverythingThrough }))
}

const post = (path: string, body = 'organizationId=org_1'): Request =>
  new Request(`https://app.example.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })

const session = { session: { userId: 'usr_1', roles: [] as readonly string[] } }

describe('le retour 303 de chaque action', () => {
  const outcomes: readonly OrganizationOutcome[] = [
    { status: 'ok', organizationId: 'org_1' },
    { status: 'refused', refusal: 'invalid_name' },
  ]

  for (const outcome of outcomes) {
    it(`revient sur la rubrique de l’action (${outcome.status})`, async () => {
      const routes = answering(outcome).filter(
        (route) => `${MODULE_ROUTE_PREFIX}${route.path}` !== organizationRoutePath('acceptInvitation'),
      )

      // Une route ajoutée force une décision : elle n'hérite pas d'une rubrique.
      expect(routes.map((route) => `${MODULE_ROUTE_PREFIX}${route.path}`).sort()).toEqual(
        Object.keys(EXPECTED).sort(),
      )

      for (const route of routes) {
        const path = `${MODULE_ROUTE_PREFIX}${route.path}`
        const response = await route.handler(post(path), session)
        const location = new URL(response.headers.get('location') ?? '', 'https://x.test')

        expect(response.status, path).toBe(303)
        expect(location.pathname, path).toBe(EXPECTED[path])
        expect(location.searchParams.get('error'), path).toBe(
          outcome.status === 'refused' ? outcome.refusal : null,
        )
      }
    })
  }

  it('ramène une invitation acceptée sur la rubrique Organisation', async () => {
    const accept = answering({ status: 'ok', organizationId: 'org_1' }).find(
      (route) => `${MODULE_ROUTE_PREFIX}${route.path}` === organizationRoutePath('acceptInvitation'),
    )

    expect(accept).toBeDefined()

    const response = await accept!.handler(
      post(organizationRoutePath('acceptInvitation')),
      session,
    )

    expect(response.headers.get('location')).toBe(ORGANIZATIONS_SCREEN_PATH)
  })
})

/**
 * **Le retour reçu ne sert qu'au succès de `switch`** (s62c, ADR 076). Le filtre
 * est ici permissif : ce qui est prouvé, c'est que la route ne lui demande rien
 * ailleurs.
 */
describe('le champ `next` hors du succès de `switch`', () => {
  const routeOf = (outcome: OrganizationOutcome, path: string) => {
    const route = answering(outcome).find(
      (candidate) => `${MODULE_ROUTE_PREFIX}${candidate.path}` === path,
    )

    expect(route, path).toBeDefined()

    return route!
  }

  it('un refus de `switch` revient sur la rubrique, avec son motif', async () => {
    const path = organizationRoutePath('switch')
    const response = await routeOf({ status: 'refused', refusal: 'invalid_name' }, path).handler(
      post(path, 'organizationId=org_1&next=%2Fapp%2Fdemo'),
      session,
    )
    expect(response.status).toBe(303)
    // ADR 080 : un chemin relatif, jamais l'hôte d'écoute de `request.url`.
    expect(response.headers.get('location')).toBe(`${ORGANIZATIONS_SCREEN_PATH}?error=invalid_name`)
  })

  it('une autre route du module ignore `next`', async () => {
    const path = organizationRoutePath('update')
    const response = await routeOf({ status: 'ok', organizationId: 'org_1' }, path).handler(
      post(path, 'organizationId=org_1&name=Nord&next=%2Fapp%2Fdemo'),
      session,
    )

    expect(response.headers.get('location')).toBe(ORGANIZATIONS_SCREEN_PATH)
  })
})
