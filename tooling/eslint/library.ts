import type { Linter } from 'eslint'

/**
 * Preset des packages de bibliothèque (`packages/*`, `tooling/*`).
 *
 * Un package est réutilisable ou il ne l'est pas. Le seul interdit qui le
 * décide mécaniquement : ne jamais dépendre d'une application. `apps/web`
 * dépend de `@repo/config` et `@repo/db` ; l'inverse rendrait ces packages
 * indéployables ailleurs et créerait un cycle que `pnpm` accepterait sans rien
 * dire.
 */
export function libraryConfig(files: string[]): Linter.Config[] {
  return [
    {
      files,
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['@repo/web', '**/apps/*', '**/apps/*/**'],
                message:
                  "Un package ne dépend jamais d'une application : c'est l'application qui dépend du package.",
              },
            ],
          },
        ],
      },
    },
  ]
}
