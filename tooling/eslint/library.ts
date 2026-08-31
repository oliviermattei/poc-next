import type { Linter } from 'eslint'

/**
 * L'interdit qui décide mécaniquement qu'un package est réutilisable : ne
 * jamais dépendre d'une application.
 *
 * Exporté séparément parce qu'il est **recomposé** ailleurs. En configuration
 * plate, deux blocs qui déclarent la même règle ne fusionnent pas : le second
 * remplace les options du premier. Tout bloc qui redéclare
 * `no-restricted-imports` sur `packages/**` doit donc reprendre ce motif, sous
 * peine d'effacer cet interdit en silence — d'où une seule déclaration, citée,
 * plutôt qu'une copie qui divergerait.
 */
export const APPLICATION_IMPORT_RESTRICTION = {
  group: ['@repo/web', '**/apps/*', '**/apps/*/**'],
  message:
    "Un package ne dépend jamais d'une application : c'est l'application qui dépend du package.",
} as const

/**
 * Preset des packages de bibliothèque (`packages/*`, `tooling/*`).
 *
 * Un package est réutilisable ou il ne l'est pas. `apps/web` dépend de
 * `@repo/config` et `@repo/db` ; l'inverse rendrait ces packages indéployables
 * ailleurs et créerait un cycle que `pnpm` accepterait sans rien dire.
 */
export function libraryConfig(files: string[]): Linter.Config[] {
  return [
    {
      files,
      rules: {
        'no-restricted-imports': ['error', { patterns: [{ ...APPLICATION_IMPORT_RESTRICTION }] }],
      },
    },
  ]
}
