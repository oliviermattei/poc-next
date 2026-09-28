import type { ModuleRegistry } from '@repo/core'
import { ACCOUNT_SCREEN_PATH } from '@repo/module-auth'
import { BILLING_SCREEN_PATH } from '@repo/module-billing'
import { ORGANIZATIONS_SCREEN_PATH } from '@repo/module-organizations'

/**
 * **La table des anciens chemins d'écran** (s62a, ADR 075) : ancien chemin
 * interne → nouveau chemin interne.
 *
 * C'est la **seule** source des redirections permanentes de l'application.
 * `apps/web/proxy.ts` la lit sur le chemin **interne** — préfixe de langue
 * retiré — et répond 308 vers la cible, re-préfixée dans la langue de la
 * requête, requête conservée. Pas de `redirects()` dans `next.config.ts` :
 * `output: 'standalone'` fige cette configuration au build, et la cible doit
 * dépendre des modules activés.
 *
 * **La cible est toujours une constante d'ici**, jamais une valeur lue dans la
 * requête : une redirection pilotée par un paramètre est une redirection
 * ouverte (`docs/security.md` §4). Les constantes viennent des modules qui
 * servent l'écran — le renommer là-bas déplace la cible sans que ce fichier
 * change.
 *
 * Chaque story qui déplace un écran ajoute une ligne ici **et** son ancien
 * chemin à `tests/fixtures/legacy-screen-paths.json` : `tests/legacy-paths.test.ts`
 * exige que chaque chemin de l'inventaire soit servi ou redirigé.
 */
export const LEGACY_SCREEN_PATHS: Readonly<Record<string, string>> = {
  '/account': ACCOUNT_SCREEN_PATH,
  '/organizations': ORGANIZATIONS_SCREEN_PATH,
  '/billing': BILLING_SCREEN_PATH,
  // s62b — l'écran Compte de s62a, rangé en rubriques : son adresse mène à la
  // première, Profil, comme `/account` — directement, jamais par un second 308.
  '/app/settings/account': ACCOUNT_SCREEN_PATH,
}

const TABLE: ReadonlyMap<string, string> = new Map(Object.entries(LEGACY_SCREEN_PATHS))

/**
 * La cible d'un ancien chemin **interne**, ou `null` s'il n'y a rien à faire.
 *
 * `null` aussi quand l'écran cible n'est pas servi dans cette configuration :
 * module coupé, l'ancien chemin répond comme avant — 404 —, plutôt que de
 * renvoyer vers un second 404. « Servi » se lit dans la **navigation du
 * registre**, qui n'agrège que les modules activés : chaque écran de la table
 * y déclare son entrée, si bien qu'aucune condition ici ne nomme un module.
 */
export function legacyScreenTarget(
  internalPath: string,
  registry: Pick<ModuleRegistry, 'navigation'>,
): string | null {
  const target = TABLE.get(internalPath)

  if (target === undefined) {
    return null
  }

  return registry.navigation.some((entry) => entry.href === target) ? target : null
}
