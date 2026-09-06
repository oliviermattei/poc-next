import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { type ComponentSource, sweptComponentNames } from './contrast-rules'

/**
 * **Les fichiers que le contrôle de contraste lit — l'unique lecture du disque**
 * (s57).
 *
 * `scripts/contrast-rules.ts` reste pur : il calcule, il ne lit rien. Mais la
 * commande et `tests/contrast.test.ts` doivent lire **le même ensemble de
 * fichiers**, sans quoi la suite pourrait rester verte sur un balayage que la
 * commande, elle, ferait plus large — ou l'inverse. Deux lecteurs recopiés
 * dériveraient l'un de l'autre en silence ; il n'y en a donc qu'un.
 *
 * **Le dossier est balayé, jamais une liste de composants.** C'est le critère 5
 * de la story : un composant ajouté demain entre dans la mesure sans qu'on y
 * pense. Ce que ce balayage ne voit pas — les écrans de `apps/web`, les
 * composants d'un module — est écrit dans la sortie de la commande.
 */

const REPO_ROOT = new URL('../', import.meta.url)

export const COMPONENTS_DIRECTORY = 'packages/ui/src/components'
export const STYLESHEET_PATH = 'packages/ui/src/styles.css'

const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, REPO_ROOT)), 'utf8')

export function deliveredContrastInput(): {
  readonly components: readonly ComponentSource[]
  readonly stylesheet: string
} {
  // Le tri et le **plancher** vivent dans `contrast-rules.ts`, sur une liste de
  // noms : une garde enfermée derrière ce `readdirSync` n'aurait aucun point
  // d'injection, donc aucun cas ne pourrait la faire rougir (s57, revue).
  const files = sweptComponentNames(
    readdirSync(fileURLToPath(new URL(COMPONENTS_DIRECTORY, REPO_ROOT))),
    COMPONENTS_DIRECTORY,
  )

  return {
    components: files.map((name) => ({
      name,
      source: read(`${COMPONENTS_DIRECTORY}/${name}`),
    })),
    stylesheet: read(STYLESHEET_PATH),
  }
}
