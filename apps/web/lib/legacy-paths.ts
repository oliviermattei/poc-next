import type { ModuleRegistry } from '@repo/core'
import { ACCOUNT_SCREEN_PATH } from '@repo/module-auth'
import { BILLING_SCREEN_PATH } from '@repo/module-billing'
import { DEMO_PREMIUM_SCREEN_PATH } from '@repo/module-demo-enabled'
import { NOTIFICATIONS_SCREEN_PATH } from '@repo/module-notifications'
import { ONBOARDING_SCREEN_PATH } from '@repo/module-onboarding'
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
/**
 * Une ligne de la table : la cible, et **le module qui sert cet écran** (ADR 077).
 *
 * `module` est l'identifiant du module tel que l'annuaire le déclare
 * (`config/features.ts`) — `tests/legacy-paths.test.ts` exige qu'il y existe.
 */
export interface LegacyScreenPath {
  readonly target: string
  readonly module: string
}

export const LEGACY_SCREEN_PATHS: Readonly<Record<string, LegacyScreenPath>> = {
  '/account': { target: ACCOUNT_SCREEN_PATH, module: 'auth' },
  '/organizations': { target: ORGANIZATIONS_SCREEN_PATH, module: 'organizations' },
  '/billing': { target: BILLING_SCREEN_PATH, module: 'billing' },
  // s62b — l'écran Compte de s62a, rangé en rubriques : son adresse mène à la
  // première, Profil, comme `/account` — directement, jamais par un second 308.
  '/app/settings/account': { target: ACCOUNT_SCREEN_PATH, module: 'auth' },
  // s63 — les derniers écrans applicatifs rangés sous `/app`. Le centre de
  // notifications et le parcours d'intégration n'ont aucune entrée de
  // navigation : c'est pourquoi la ligne nomme son module (ADR 077).
  '/notifications': { target: NOTIFICATIONS_SCREEN_PATH, module: 'notifications' },
  '/onboarding': { target: ONBOARDING_SCREEN_PATH, module: 'onboarding' },
  '/premium': { target: DEMO_PREMIUM_SCREEN_PATH, module: 'demo-enabled' },
}

const TABLE: ReadonlyMap<string, LegacyScreenPath> = new Map(Object.entries(LEGACY_SCREEN_PATHS))

/**
 * La cible d'un ancien chemin **interne**, ou `null` s'il n'y a rien à faire.
 *
 * `null` aussi quand l'écran cible n'est pas servi dans cette configuration :
 * module coupé, l'ancien chemin répond comme avant — 404 —, plutôt que de
 * renvoyer vers un second 404. « Servi » se lit dans les **modules du
 * registre** (ADR 077, qui amende l'ADR 075) : chaque ligne nomme le module qui
 * sert son écran, et le registre n'agrège que les modules activés. La
 * navigation ne suffit plus — le centre de notifications et le parcours
 * d'intégration n'y ont, par décision, aucune entrée.
 */
export function legacyScreenTarget(
  internalPath: string,
  registry: Pick<ModuleRegistry, 'moduleIds'>,
): string | null {
  const row = TABLE.get(internalPath)

  if (row === undefined) {
    return null
  }

  return registry.moduleIds.includes(row.module) ? row.target : null
}
