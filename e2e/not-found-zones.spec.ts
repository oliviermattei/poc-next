import { expect, test, type Page } from '@playwright/test'

import { organizations } from '../apps/web/lib/organizations'
import { publicPath } from './support/locale'

/**
 * **Une 404, un shell** (s66, ADR 072).
 *
 * Un `notFound()` levé par une **page** est rendu sous le layout de sa zone,
 * qui fournit déjà le shell ; une URL qui ne mène à aucune route n'a que le
 * layout racine, et c'est `app/not-found.tsx` qui fournit le shell. Depuis s60,
 * la première forme rendait **deux** barres latérales — mesuré sous Chromium sur
 * `/fr/blog/nexiste-pas`.
 *
 * **Seul un navigateur le voit** : la 404 levée par une page part dans le flux
 * RSC, le HTML brut qu'un `curl` reçoit ne porte qu'un shell. D'où ce fichier,
 * et le compte fait **après** que l'écran 404 est affiché : compter avant
 * compterait le shell du HTML initial, et une assertion qui réessaie jusqu'à
 * trouver `1` passerait avant l'arrivée du second.
 *
 * **Les témoins par zone**, et ce qui les rend atteignables :
 *
 * - `(site)` : `/blog/<slug inconnu>` — la page lève sur un article absent, que
 *   le module blog soit activé ou non. Atteignable dans toute configuration.
 * - `(auth)` : `/invitations/accept` — la page ne lève que lorsque le module
 *   `organizations` est coupé (configuration `socle` de la CI).
 * - `(app)` : `/organizations` — même condition. Les cinq pages de `(app)` qui
 *   lèvent `notFound()` le font toutes sur un module ou une fonctionnalité
 *   **absente** ; avec tout activé (`tous`), aucune n'a de témoin atteignable,
 *   et le cas le dit en sautant plutôt que de passer vert sur rien.
 * - `(console)` : `/console/users/<identifiant inconnu>`, lu par le superadmin
 *   — mesuré dans `e2e/admin.spec.ts`, pas ici : il faut inscrire le compte
 *   désigné, et cette série-là est la seule à le faire, en série et avec sa
 *   remise à zéro. L'inscrire aussi depuis ce fichier, qui tourne en
 *   parallèle, ferait se refuser les deux inscriptions.
 */

const NOT_FOUND_TITLE = 'Page introuvable'

/** Attend l'écran 404, puis compte les shells sans réessayer. */
const expectOneShell = async (page: Page, pathname: string): Promise<void> => {
  const response = await page.goto(publicPath(pathname))

  expect(response?.status(), pathname).toBe(404)
  await expect(
    page.getByRole('heading', { name: NOT_FOUND_TITLE, level: 1 }),
    pathname,
  ).toBeVisible()
  await page.waitForLoadState('networkidle')

  expect(await page.locator('[data-slot="sidebar"]').count(), `${pathname} : barres latérales`).toBe(1)
  expect(await page.getByRole('heading', { level: 1 }).count(), `${pathname} : titres`).toBe(1)
}

test('une URL sans route rend la 404 dans un seul shell, bannière comprise', async ({ page }) => {
  await expectOneShell(page, '/nexiste-pas-s66')

  // Le shell de `app/not-found.tsx` est ici le **seul** : sans lui, la page
  // perdrait la navigation et la bannière de consentement.
  await expect(page.getByRole('region', { name: 'Consentement aux cookies' })).toBeVisible()
})

test('une 404 levée par une page de (site) rend un seul shell', async ({ page }) => {
  await expectOneShell(page, '/blog/aucun-article-s66')
})

test('une 404 levée par une page de (auth) rend un seul shell', async ({ page }) => {
  test.skip(
    organizations.available,
    'Module organizations activé : la seule page de (auth) qui lève notFound() ' +
      '(invitations/accept) ne lève que module coupé. Témoin atteignable en socle.',
  )

  await expectOneShell(page, '/invitations/accept')
})

test('une 404 levée par une page de (app) rend un seul shell', async ({ page }) => {
  test.skip(
    organizations.available,
    'Module organizations activé : les pages de (app) ne lèvent notFound() que ' +
      'sur un module ou une fonctionnalité absente. Témoin atteignable en socle.',
  )

  await expectOneShell(page, '/organizations')
})
