import { expect, test } from '@playwright/test'

/**
 * Parcours de démonstration, et seul test du dépôt qui exerce une application
 * réellement démarrée : serveur Next lancé par la configuration Playwright,
 * navigateur, requête HTTP, base de données.
 *
 * Ce qu'il attrape et qu'aucun test unitaire n'attrape : une application qui ne
 * démarre pas. Le route handler de `/api/health` est déjà couvert par
 * `tests/health.test.ts`, mais en l'important directement — le serveur n'y
 * existe pas.
 */
test('l’application démarre et sert la page d’accueil', async ({ page }) => {
  const response = await page.goto('/')

  expect(response?.status()).toBe(200)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
})

/**
 * **Cas intermittent de s52, cause non établie** — `read ECONNRESET` sur ce
 * `GET`, vu une fois pendant `pnpm test:socle`, vert au second passage. Même
 * symptôme et même famille que `e2e/blog.spec.ts` (« un article qui n'existe
 * pas répond 404 »), où le raisonnement est écrit ; ni l'un ni l'autre n'a été
 * reproduit sur cette branche.
 */
test('la sonde de santé répond 200 avec la base connectée', async ({ request }) => {
  // Une sonde qui répond 200 par principe ne vaut rien (socle de fiabilité §5) :
  // celle-ci interroge réellement la base. Ce test échoue donc aussi quand
  // Postgres est absent — c'est voulu, la CI en démarre un.
  const response = await request.get('/api/health')

  expect(response.status()).toBe(200)
  expect(await response.json()).toEqual({ status: 'ok', database: 'connected' })
})
