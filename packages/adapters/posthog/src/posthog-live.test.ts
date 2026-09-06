import { describe, expect, it } from 'vitest'

import { createPostHogAnalytics } from './posthog-analytics'

/**
 * **Le second régime : envoi réel, hors CI, sur commande explicite** (critère 4
 * de s39).
 *
 * `docs/architecture.md` impose deux régimes d'intégration tierce et interdit de
 * les mélanger. `posthog-analytics.test.ts` est le premier : bloquant en CI, il
 * double le réseau et n'atteint aucun service. Celui-ci est le second — il parle
 * au **vrai** fournisseur, avec une **vraie** clé de projet de test.
 *
 * **Ce qu'il prouve, et qu'aucune doublure ne peut prouver** : que le
 * fournisseur *accepte* ce que nous émettons. C'est précisément la moitié que le
 * régime `recorded` du parcours doré a laissée vide — `tests/fixtures/stripe-events/`
 * ne porte aucun enregistrement, et une CI verte n'y dit donc rien de la fidélité
 * au fournisseur. Ici, la doublure ne prétend rien de la fidélité : elle est
 * explicitement bornée à la forme de nos requêtes, et la fidélité est le travail
 * de ce fichier-ci.
 *
 * La recette, à lancer avant un ship qui touche à l'analytique :
 *
 * ```sh
 * POSTHOG_LIVE_TEST=1 \
 *   POSTHOG_KEY=phc_… \
 *   POSTHOG_HOST=https://eu.i.posthog.com \
 *   pnpm vitest run packages/adapters/posthog/src/posthog-live.test.ts
 * ```
 *
 * Les variables sont lues ici, et ici seulement, directement dans
 * `process.env` : ce fichier est du **harnais de test**, pas du code applicatif
 * — le point d'accès unique à l'environnement (`@repo/config`) vaut pour ce que
 * l'application exécute, et ces variables-là ne sont pas les siennes.
 *
 * Sans `POSTHOG_LIVE_TEST=1`, la suite est **ignorée**. C'est ce qui garantit
 * qu'aucun envoi réel ne part d'une CI, y compris sur un poste où une clé
 * traînerait dans l'environnement. **Elle ne se substitue jamais au régime
 * doublé en silence** : ignorée, elle ne rend rien de vert qui ressemblerait à
 * une mesure — et sa **garde de configuration** ci-dessous échoue plutôt que de
 * se sauter elle-même quand elle est demandée sans clé.
 */

const live = process.env.POSTHOG_LIVE_TEST === '1'
const key = process.env.POSTHOG_KEY ?? ''
const host = (process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com').replace(/\/$/, '')

describe.runIf(live)('envoi réel vers un projet PostHog de test', () => {
  it('refuse de mesurer sans clé, au lieu de se sauter lui-même', () => {
    // Demandé sans clé, ce régime **échoue en le disant**. Se sauter ici serait
    // reproduire le défaut du régime `recorded` du parcours doré : une recette
    // verte qui n'a rien joué.
    expect(key, 'POSTHOG_LIVE_TEST=1 sans POSTHOG_KEY : il n’y a rien à envoyer').not.toBe('')
  })

  it('le fournisseur accepte l’événement que l’adaptateur émet', async () => {
    const analytics = createPostHogAnalytics({ apiKey: key, host })

    const result = await analytics.track({
      name: 'boilerplate.live_check',
      distinctId: `live-check-${String(Date.now())}`,
      properties: { source: 'posthog-live.test.ts' },
    })

    expect(result.ok, result.ok ? '' : `${result.error.code} : ${result.error.message}`).toBe(true)
  }, 15_000)

  it('le fournisseur accepte aussi l’affichage de page', async () => {
    const analytics = createPostHogAnalytics({ apiKey: key, host })

    const result = await analytics.page({
      path: '/live-check',
      distinctId: `live-check-${String(Date.now())}`,
      properties: {},
    })

    expect(result.ok, result.ok ? '' : `${result.error.code} : ${result.error.message}`).toBe(true)
  }, 15_000)
})
