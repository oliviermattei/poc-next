import { MODULE_ROUTE_PREFIX } from '@repo/core'
import { expect, test, type Page } from '@playwright/test'

import { moduleRegistry } from '../../apps/web/lib/module-registry'
import { availableModules } from '../../config/features'
import { assertSweepIsNotEmpty, sweepProfile } from '../../scripts/minimal-profile-rules'
import { aSignedInAccount } from '../support/account'
import { publicPath, urlOf } from '../support/locale'

/**
 * **La recette du profil minimal, vue depuis un serveur réellement démarré**
 * (s26, critères 3, 4 et 6).
 *
 * Ce fichier n'est joué que par `pnpm test:minimal-profile`, dans le **clone**
 * où le profil a été appliqué : `playwright.config.ts` l'exclut, exactement
 * comme le parcours doré de s25. La raison est la même — chaque story paierait
 * sinon un clone, une installation et une base neuve.
 *
 * **Rien ici ne nomme un module.** Ce qui doit être absent est dérivé de la
 * différence entre l'annuaire (`availableModules`) et le registre monté
 * (`moduleRegistry.moduleIds`), donc du contrat que chaque module déclare
 * déjà. Ajouter un module au profil ne demande aucune modification de ce
 * fichier — c'est le critère 8, et c'est ce qui le rend vrai plutôt
 * qu'affirmé.
 *
 * Et **les comptes sont assertés** : un balayage qui rendrait zéro route et
 * zéro entrée serait vert sans rien avoir vérifié.
 */

const sweep = sweepProfile({
  profileId: 'minimal',
  available: [...availableModules],
  enabled: [...moduleRegistry.moduleIds],
})

/** Les `href` réellement rendus dans la navigation des modules. */
const renderedNavigation = async (page: Page): Promise<string[]> => {
  const links = page.getByRole('navigation', { name: 'Modules' }).getByRole('link')

  return (await Promise.all((await links.all()).map((link) => link.getAttribute('href')))).filter(
    (href): href is string => href !== null,
  )
}

/**
 * La navigation rendue, **comparée à l'union des entrées déclarées par les
 * modules activés** — la formulation exacte du critère 4.
 *
 * Deux sens, et le second est celui que la story vise : aucune entrée rendue
 * n'est étrangère au registre, et aucune entrée d'un module coupé n'apparaît.
 */
const expectNavigationIsDerivedFromEnabledModules = (rendered: readonly string[]): void => {
  const declared = new Set(moduleRegistry.navigation.map((entry) => publicPath(entry.href)))

  for (const href of rendered) {
    expect(declared.has(href), `l’entrée ${href} n’est déclarée par aucun module activé`).toBe(true)
  }

  for (const entry of sweep.navigation) {
    expect(rendered, `${entry.moduleId} ${entry.entryId}`).not.toContain(publicPath(entry.href))
  }
}

test('le profil coupe réellement des modules, et le balayage n’est pas vide', () => {
  // Cette garde d'inertie porte tout le fichier : sans elle, les deux cas
  // suivants seraient verts en n'examinant rien — le mode d'échec que la revue
  // de s25 a nommé, et que le plan de s26 reprend comme premier risque.
  expect(() => assertSweepIsNotEmpty(sweep)).not.toThrow()

  expect(sweep.cutModuleIds.length).toBeGreaterThan(0)
  expect(sweep.routes.length).toBeGreaterThan(0)
  expect(sweep.navigation.length).toBeGreaterThan(0)

  console.log(
    `Profil minimal, serveur réel — ${sweep.cutModuleIds.length} module(s) coupé(s) : ` +
      `${sweep.cutModuleIds.join(', ')} ; ${sweep.routes.length} route(s) et ` +
      `${sweep.navigation.length} entrée(s) de navigation balayées.`,
  )
})

test('aucune route d’un module coupé n’est joignable (critère 3)', async ({ request }) => {
  let swept = 0

  for (const route of sweep.routes) {
    const response = await request.fetch(`${MODULE_ROUTE_PREFIX}${route.path}`, {
      method: route.method,
    })

    expect(response.status(), `${route.moduleId} ${route.method} ${route.path}`).toBe(404)
    // Et pas seulement le code : un 404 rendu **après** avoir exécuté le
    // gestionnaire serait une route montée qui ment sur son statut.
    expect(await response.json()).toEqual({ error: 'not_found' })

    swept += 1
  }

  expect(swept).toBe(sweep.routes.length)

  // **Le contrôle positif, sur le même montage.** Sans lui, une application
  // entièrement morte — routeur non monté, serveur qui rend 404 partout —
  // rendrait les absences ci-dessus vertes pour la pire des raisons.
  //
  // Les routes des modules **activés** répondent, elles : 401 sans session pour
  // une route protégée, le statut du gestionnaire pour une route publique.
  // Jamais 404, qui est réservé à « aucune route activée ne correspond »
  // (`dispatchModuleRequest`). Seules les `GET` sont appelées : une écriture
  // anonyme sur une route publique aurait un effet de bord, ce qu'un contrôle
  // n'a pas à payer.
  const readable = moduleRegistry.routes.filter((route) => route.method === 'GET')
  const answered: string[] = []

  for (const route of readable) {
    const response = await request.fetch(`${MODULE_ROUTE_PREFIX}${route.path}`, { method: 'GET' })

    if (response.status() !== 404) {
      answered.push(`${route.moduleId} ${route.path} → ${response.status()}`)
    }
  }

  expect(
    answered.length,
    `aucune des ${readable.length} route(s) GET des modules activés ne répond : le montage est ` +
      'mort, et les 404 ci-dessus ne prouvent rien',
  ).toBeGreaterThan(0)

  console.log(
    `Contrôle positif — ${answered.length} route(s) de module activé répondent : ` +
      `${answered.join(' ; ')}.`,
  )
})

test('la navigation anonyme ne contient que des entrées de modules activés (critère 4)', async ({
  page,
}) => {
  await page.goto('/')

  const rendered = await renderedNavigation(page)

  expect(rendered.length).toBeGreaterThan(0)
  expectNavigationIsDerivedFromEnabledModules(rendered)
})

/**
 * **Le produit réduit reste utilisable** (critère 6).
 *
 * `auth` est au socle, donc toujours présent ; ce parcours est ce qui prouve
 * que le couper des trois modules optionnels n'a pas cassé le seul geste sans
 * lequel il n'y a pas de SaaS. Il porte aussi la navigation **connectée**, qui
 * rend davantage d'entrées que celle d'un visiteur anonyme.
 */
test('inscription et connexion de bout en bout, puis navigation connectée (critères 6 et 4)', async ({
  page,
}) => {
  await aSignedInAccount(page, 'profil-minimal')

  await expect(page).toHaveURL(urlOf('/'))

  const rendered = await renderedNavigation(page)

  expect(rendered.length).toBeGreaterThan(0)
  expectNavigationIsDerivedFromEnabledModules(rendered)
})
