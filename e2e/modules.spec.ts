import { MODULE_ROUTE_PREFIX, visibleNavigation, type AnyModuleDefinition } from '@repo/core'
import { expect, test } from '@playwright/test'

import { moduleRegistry } from '../apps/web/lib/module-registry'
import { availableModules } from '../config/features'

/**
 * Le registre, vu depuis un serveur réellement démarré.
 *
 * Les tests Vitest importent le répartiteur et le registre dans le même
 * processus : ils prouvent la règle, pas le montage. Ce fichier passe par HTTP,
 * sur l'application que Playwright démarre — c'est la seule preuve qui attrape
 * un montage cassé, une route qui n'atteint pas le point d'entrée, ou une
 * navigation rendue autrement que par le registre.
 *
 * **Les attentes sont dérivées du registre, jamais recopiées** : ce fichier doit
 * passer dans les deux états de `config/features.ts`. Une suite qui adapte ses
 * attentes à la configuration ne prouve plus rien sur la configuration ; une
 * suite qui les code en dur oblige à l'éditer à chaque bascule.
 */

const isEnabled = (module: AnyModuleDefinition): boolean =>
  moduleRegistry.moduleIds.includes(module.id)

const disabledModules = availableModules.filter((module) => !isEnabled(module))

const publicRoutes = moduleRegistry.routes.filter(
  (route) => route.method === 'GET' && route.protection.level === 'public',
)

const protectedRoutes = moduleRegistry.routes.filter(
  (route) => route.method === 'GET' && route.protection.level !== 'public',
)

test('la route publique d’un module activé est servie', async ({ request }) => {
  for (const route of publicRoutes) {
    const response = await request.get(`${MODULE_ROUTE_PREFIX}${route.path}`, {
      maxRedirects: 0,
    })

    // **Joignable**, et non « 200 » : depuis s07, une route publique peut
    // légitimement rediriger (un lien de vérification consommé) ou refuser une
    // requête sans paramètre. Ce qui se vérifie ici est l'inverse exact du cas
    // suivant — la route d'un module activé est montée, celle d'un module non
    // activé n'existe pas.
    expect(response.status(), `${route.moduleId} ${route.path}`).not.toBe(404)
  }
})

test('l’URL d’un module non activé répond 404, sans exécuter son gestionnaire', async ({
  request,
}) => {
  // Non vide dans les deux états : en configuration livrée, `demo-disabled` ;
  // configuration vidée, les deux modules de démonstration.
  expect(disabledModules.length).toBeGreaterThan(0)

  for (const module of disabledModules) {
    for (const route of module.routes) {
      const response = await request.fetch(`${MODULE_ROUTE_PREFIX}${route.path}`, {
        method: route.method,
      })

      expect(response.status(), `${module.id} ${route.path}`).toBe(404)
      expect(await response.json()).toEqual({ error: 'not_found' })
    }
  }
})

test('une route protégée refuse l’appel anonyme sans atteindre son gestionnaire', async ({
  request,
}) => {
  for (const route of protectedRoutes) {
    const response = await request.get(`${MODULE_ROUTE_PREFIX}${route.path}`)

    // 401 et non 403 : aucune authentification n'existe encore (s07), le
    // serveur ne sait pas qui appelle et refuse pour cette raison.
    expect(response.status(), `${route.moduleId} ${route.path}`).toBe(401)
    expect(await response.json()).toEqual({ error: 'unauthorized' })
  }
})

test('la navigation rendue est exactement celle que le registre autorise', async ({ page }) => {
  await page.goto('/')

  const links = page.getByRole('navigation', { name: 'Modules' }).getByRole('link')
  const expected = visibleNavigation(moduleRegistry, null)

  await expect(links).toHaveCount(expected.length)

  for (const [index, entry] of expected.entries()) {
    await expect(links.nth(index)).toHaveAttribute('href', entry.href)
  }

  // Deux absences, vraies dans les deux états : aucune entrée d'un module non
  // activé — la promesse du produit — et aucune entrée dont la protection
  // déclarée n'est pas satisfaite par un visiteur anonyme, qui divulguerait
  // l'existence d'un écran refusé (`docs/security.md` §3).
  const rendered = await Promise.all(
    (await links.all()).map((link) => link.getAttribute('href')),
  )
  const hidden = [
    ...disabledModules.flatMap((module) => module.navigation),
    ...moduleRegistry.navigation.filter((entry) => entry.protection.level !== 'public'),
  ]

  expect(hidden.length).toBeGreaterThan(0)

  for (const entry of hidden) {
    expect(rendered, entry.id).not.toContain(entry.href)
  }
})
