import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import type { JobEmission } from '@repo/ports'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createInngestJobs, createInngestRunner } from './inngest-jobs'

/**
 * **Le second régime : exécution réelle, hors CI, sur commande explicite.**
 *
 * `docs/architecture.md` impose deux régimes d'intégration tierce et interdit de
 * les mélanger. `inngest-jobs.test.ts` est le premier : bloquant en CI, il
 * double le réseau et n'atteint aucun service. Celui-ci est le second — il parle
 * à un **vrai serveur de développement Inngest**, qui découvre une vraie
 * application, reçoit un vrai événement et exécute une vraie tâche.
 *
 * Ce qu'il prouve, et qu'aucun double ne peut prouver : que la boucle **se
 * ferme**. Un adaptateur qui émettrait correctement vers un fournisseur qui ne
 * rappellerait jamais passerait tous les cas doublés — et n'exécuterait rien en
 * production, ce qui est exactement le défaut que s33 corrige.
 *
 * La recette, à lancer avant un ship qui touche aux tâches :
 *
 * ```sh
 * # terminal 1 — le serveur de développement du fournisseur
 * npx inngest-cli@latest dev --no-discovery
 *
 * # terminal 2
 * INNGEST_LIVE_TEST=1 \
 *   pnpm vitest run packages/adapters/inngest/src/inngest-live.test.ts
 * ```
 *
 * `INNGEST_DEV_URL` vise un autre serveur que `http://localhost:8288`.
 *
 * Les variables sont lues ici, et ici seulement, directement dans
 * `process.env` : ce fichier est du harnais de test, pas du code applicatif — le
 * point d'accès unique à l'environnement (`@repo/config`) vaut pour ce que
 * l'application exécute, et ces variables-là ne sont **pas** celles de
 * l'application.
 *
 * Sans `INNGEST_LIVE_TEST=1`, la suite est ignorée — c'est ce qui garantit
 * qu'aucune exécution réelle ne part d'une CI, y compris si un serveur de
 * développement tournait sur la machine. **Elle ne se substitue jamais au
 * régime doublé en silence** : ignorée, elle ne rend rien de vert qui
 * ressemblerait à une mesure.
 */

const live = process.env.INNGEST_LIVE_TEST === '1'
const devUrl = (process.env.INNGEST_DEV_URL ?? 'http://localhost:8288').replace(/\/$/, '')

/** Le chemin sous lequel le harnais sert le gestionnaire de rappel. */
const SERVE_PATH = '/api/inngest'

/** La tâche de démonstration : elle n'a d'autre effet que d'être comptée. */
const DEMO_JOB = 'demo.live-check'

describe.runIf(live)('exécution réelle contre le serveur de développement Inngest', () => {
  const dispatched: JobEmission[] = []
  let server: Server
  let origin: string

  beforeAll(async () => {
    const handler = createInngestRunner({
      appId: 'killer-saas-live-check',
      servePath: SERVE_PATH,
      // Le mode développement est **explicite**, jamais déduit de `NODE_ENV` :
      // c'est lui qui dispense le serveur de développement de clé de signature.
      isDev: true,
      baseUrl: devUrl,
      jobs: [{ id: DEMO_JOB, schedule: '0 3 * * *' }],
      dispatch: async (emission) => {
        dispatched.push(emission)

        return { ok: true }
      },
    })

    server = createServer((request, response) => {
      const url = `http://${request.headers.host ?? 'localhost'}${request.url ?? '/'}`
      const chunks: Buffer[] = []

      request.on('data', (chunk: Buffer) => void chunks.push(chunk))
      request.on('end', () => {
        void (async () => {
          const body = chunks.length === 0 ? undefined : Buffer.concat(chunks)
          const answer = await handler(
            new Request(url, {
              method: request.method,
              headers: request.headers as Record<string, string>,
              ...(body === undefined || request.method === 'GET' ? {} : { body }),
            }),
          )

          response.writeHead(answer.status, Object.fromEntries(answer.headers.entries()))
          response.end(Buffer.from(await answer.arrayBuffer()))
        })()
      })
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

    const { port } = server.address() as AddressInfo

    origin = `http://127.0.0.1:${port}`

    // Le `PUT` du gestionnaire est la **synchronisation** : c'est le SDK qui
    // annonce l'application au serveur de développement, avec ses fonctions.
    const synced = await fetch(`${origin}${SERVE_PATH}`, { method: 'PUT' })

    expect(
      synced.ok,
      `Le serveur de développement Inngest n’a pas accepté la synchronisation (${synced.status}). ` +
        `Est-il lancé sur ${devUrl} ?`,
    ).toBe(true)
  }, 30_000)

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('exécute réellement la tâche de démonstration que l’émission nomme', { timeout: 60_000 }, async () => {
    const jobs = createInngestJobs({
      // Le serveur de développement accepte n'importe quelle clé : elle est
      // posée quand même, parce que l'adaptateur refuse une clé vide et que la
      // recette doit emprunter le chemin de production.
      eventKey: 'live-check',
      baseUrl: devUrl,
      declared: [DEMO_JOB],
    })

    const key = `live-check@${new Date().toISOString()}`
    const emitted = await jobs.emit({ job: DEMO_JOB, key, data: { origin: 'recette' } })

    expect(emitted.ok, emitted.ok ? '' : emitted.error.message).toBe(true)

    // Le fournisseur exécute de façon asynchrone : on **observe** l'effet, on ne
    // le suppose pas. C'est le seul endroit de la suite où une attente est
    // légitime — l'effet vient d'un processus qu'on ne pilote pas.
    const deadline = Date.now() + 45_000

    while (Date.now() < deadline && !dispatched.some((entry) => entry.key === key)) {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }

    expect(
      dispatched.filter((entry) => entry.key === key),
      'Le serveur de développement n’a jamais rappelé le gestionnaire.',
    ).toEqual([{ job: DEMO_JOB, key, data: { origin: 'recette' } }])
  })
})
