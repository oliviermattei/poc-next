import { MODULE_ROUTE_PREFIX, entitlementFeatureOf, type ModuleSession } from '@repo/core'
import { DEMO_PREMIUM_FEATURE, demoEnabledModule } from '@repo/module-demo-enabled'
import { describe, expect, it, vi } from 'vitest'

import { billing } from '../apps/web/lib/billing'
import { createEntitlements, entitlements } from '../apps/web/lib/entitlements'
import { featureGates } from '../apps/web/lib/feature-gates'
import { featureGates as declared } from '../config/gating'

/**
 * **La fonction unique qui dit ce à quoi un compte a droit** — le premier
 * critère de la story, éprouvé au **point de composition** où il vit.
 *
 * C'est ici que le défaut habite, et la leçon est écrite dans
 * `packages/modules/billing/AGENTS.md` : les deux constats majeurs de la
 * seconde revue de s19 — la permission et l'adresse — ont été « prouvés » par
 * une mutation posée dans le module, laquelle laissait 1 320 cas sur 1 320 au
 * vert parce que le vrai défaut vivait dans `apps/web/lib/billing.ts`. La règle
 * est donc écrite dans une fabrique, injectable, et le fichier mesure **aussi**
 * l'objet réellement composé.
 *
 * Ce que ce fichier ne mesure pas, et qui est mesuré ailleurs : le refus 403 au
 * répartiteur (`tests/module-registry.test.ts`), la règle de gating
 * (`packages/core/src/entitlement.test.ts`), les offres qu'un périmètre détient
 * (`tests/billing.test.ts` et le `domain` du module), et le câblage du
 * résolveur sur la route montée (`e2e/billing.spec.ts`, qui est le seul endroit
 * où la vraie session et la vraie base se rencontrent).
 */

const SESSION: ModuleSession = { userId: 'usr_s21', roles: [] }

/**
 * **Seule l'identité de l'appelant est doublée**, et rien d'autre.
 *
 * Le point de montage résout la session par un cookie, donc par la base et par
 * `next/headers` : la fournir ici est ce qui rend le câblage mesurable sans
 * navigateur. Ce que le double **ne** décide pas, c'est le droit — il reste
 * celui du vrai `entitlements`, et c'est justement ce qui est en jeu. Un double
 * qui répondrait à la place du serveur ne mesurerait que lui-même.
 */
vi.mock('../apps/web/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../apps/web/lib/auth')>()),
  resolveModuleSession: () => Promise.resolve(SESSION),
}))

/** Le chemin de la route réservée, **dérivé du contrat du module**. */
const PREMIUM_ROUTE =
  demoEnabledModule.routes.find((route) => entitlementFeatureOf(route.protection) !== null)?.path ??
  ''

const GATES = [
  { id: 'premium-report', offers: ['pro-monthly', 'pro-yearly', 'lifetime'] },
  { id: 'exports', offers: ['pro-yearly'] },
] as const

/** Une facturation d'essai : le drapeau, et ce qu'elle répond. */
const aBilling = (
  available: boolean,
  offers: readonly string[],
): { readonly source: Parameters<typeof createEntitlements>[0]['billing']; readonly asked: string[] } => {
  const asked: string[] = []

  return {
    source: {
      available,
      entitledOffers: (session) => {
        asked.push(session.userId)

        return Promise.resolve(offers)
      },
    },
    asked,
  }
}

describe('ce à quoi un compte a droit', () => {
  it('n’ouvre rien à qui ne détient aucune offre', async () => {
    const { source } = aBilling(true, [])
    const decide = createEntitlements({ billing: source, gates: [...GATES] })

    expect(await decide.featuresOf(SESSION)).toEqual(new Set())
    expect(await decide.allows(SESSION, 'premium-report')).toBe(false)
  })

  it('ouvre la fonctionnalité que l’offre détenue déclare', async () => {
    const { source } = aBilling(true, ['pro-monthly'])
    const decide = createEntitlements({ billing: source, gates: [...GATES] })

    expect(await decide.allows(SESSION, 'premium-report')).toBe(true)
    // `exports` n'est ouverte que par l'offre annuelle : détenir l'une
    // n'ouvre pas l'autre.
    expect(await decide.allows(SESSION, 'exports')).toBe(false)
  })

  it('ouvre par l’achat unique aussi bien que par l’abonnement', async () => {
    // Le troisième critère de la story, et le sixième de s20 : le gating lit un
    // droit **consolidé**, jamais l'état d'un abonnement.
    const { source } = aBilling(true, ['lifetime'])
    const decide = createEntitlements({ billing: source, gates: [...GATES] })

    expect(await decide.allows(SESSION, 'premium-report')).toBe(true)
  })

  it('n’ouvre pas une fonctionnalité que rien ne déclare', async () => {
    const { source } = aBilling(true, ['pro-yearly'])
    const decide = createEntitlements({ billing: source, gates: [...GATES] })

    expect(await decide.allows(SESSION, 'fantome')).toBe(false)
  })

  /**
   * **Le sixième critère : module de facturation coupé, tout est accordé.**
   *
   * Un projet qui ne vend rien ne réserve rien. Et la facturation n'est même
   * pas interrogée — il n'y a ni client, ni offre, ni base à ouvrir.
   */
  it('accorde toutes les fonctionnalités déclarées quand la facturation est coupée', async () => {
    const { source, asked } = aBilling(false, ['pro-yearly'])
    const decide = createEntitlements({ billing: source, gates: [...GATES] })

    expect(await decide.featuresOf(SESSION)).toEqual(new Set(['premium-report', 'exports']))
    expect(await decide.allows(SESSION, 'premium-report')).toBe(true)
    expect(asked).toEqual([])
  })

  it('n’accorde toujours rien qui ne soit déclaré, module coupé', async () => {
    // « Tout accorder » veut dire « toutes les fonctionnalités déclarées », pas
    // « oui à n'importe quelle question ». Sans cette borne, une route qui
    // réserverait une fonctionnalité inconnue serait servie module coupé et
    // refusée module activé.
    const { source } = aBilling(false, [])
    const decide = createEntitlements({ billing: source, gates: [...GATES] })

    expect(await decide.allows(SESSION, 'fantome')).toBe(false)
  })
})

/**
 * **L'objet réellement composé**, et pas seulement la règle.
 *
 * Une fabrique éprouvée dont personne ne branche le résultat est une règle
 * morte : c'est le défaut mesuré en s09 (`buildRegistry({ locales })` oublié au
 * point de composition) et deux fois en s19.
 */
describe('le point de composition de l’application', () => {
  it('lit les déclarations de `config/gating.ts`, validées', () => {
    expect(featureGates().map((gate) => gate.id)).toEqual(declared.map((gate) => gate.id))
    expect(featureGates().map((gate) => gate.id)).toContain(DEMO_PREMIUM_FEATURE)
  })

  /**
   * **Module de facturation coupé, l'objet composé accorde tout** — le sixième
   * critère, mesuré sur l'objet réel et non sur la fabrique.
   *
   * L'autre moitié — module monté — vit dans `tests/billing.test.ts`, avec le
   * harnais de base de données du point de composition : elle a besoin d'une
   * vraie session, d'un vrai client et d'un vrai abonnement.
   */
  it.runIf(!billing.available)('accorde tout quand la facturation n’est pas montée', async () => {
    expect([...(await entitlements.featuresOf(SESSION))].sort()).toEqual(
      featureGates()
        .map((gate) => gate.id)
        .sort(),
    )
  })

  /**
   * **Le résolveur est branché sur la route montée** (constat m1 de la revue).
   *
   * Le répartiteur est fail-closed : sans `resolveFeatures`, toute route
   * réservée répond 403. Retirer la ligne du point de montage laissait donc
   * `pnpm test` intégralement vert, et seul `e2e/billing.spec.ts` rougissait —
   * un parcours que le module de facturation coupé fait sauter. **Aucune
   * commande ne rougissait dans cette configuration-là.**
   *
   * Ce cas la couvre : facturation coupée, tout est accordé, donc la route doit
   * **servir**. Les deux configurations sont ainsi tenues — celle-ci par
   * `pnpm test`, l'autre par le parcours navigateur, qui mesure le 403 puis le
   * 200 avec une vraie session et un vrai abonnement.
   */
  it.runIf(!billing.available)(
    'sert la route réservée par le point de montage, résolveur compris',
    async () => {
      const { GET } = await import('../apps/web/app/api/modules/[...path]/route')

      const response = await GET(
        new Request(`http://localhost${MODULE_ROUTE_PREFIX}${PREMIUM_ROUTE}`, { method: 'GET' }),
      )

      // L'attente est **dérivée** de ce que la règle accorde à cette session :
      // le cas ne recopie pas un statut, il vérifie que la route obéit à la
      // fonction unique.
      expect(response.status).toBe(
        (await entitlements.featuresOf(SESSION)).has(DEMO_PREMIUM_FEATURE) ? 200 : 403,
      )
    },
  )
})
