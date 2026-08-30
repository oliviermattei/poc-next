import js from '@eslint/js'
import type { Linter } from 'eslint'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * Preset de base, commun à tout le dépôt.
 *
 * Deux choses à savoir avant d'y toucher :
 *
 * 1. **Configuration plate obligatoire.** ESLint 10 a supprimé `.eslintrc` ;
 *    toute recette antérieure à ESLint 9 est inapplicable ici.
 * 2. **Le parser tourne sur l'API TypeScript 6, pas 7.** `typescript-eslint`
 *    refuse explicitement de démarrer sur TypeScript 7 (« typescript-eslint
 *    does not support TS 7.0 »), et Microsoft documente le fonctionnement côte
 *    à côte : les outils qui ont besoin de l'API restent en 6.0, le
 *    compilateur passe en 7. `@repo/eslint-config` est donc le seul package du
 *    dépôt à déclarer `typescript@^6`. `pnpm typecheck` compile toujours avec
 *    TypeScript 7 (ADR 011) : aucune ligne de code du dépôt n'est vérifiée par
 *    le compilateur 6.
 *
 * Le lint n'est **pas** typé (`projectService` désactivé). C'est un choix :
 * l'analyse typée exige que chaque fichier linté appartienne à un `tsconfig`,
 * ce qui exclurait l'arborescence de fixtures qui prouve la règle de
 * frontières — et ce qu'elle apporterait est déjà couvert par `pnpm typecheck`.
 */
// `tseslint.config()` renvoie ses propres types de configuration plate, qui ne
// sont pas structurellement assignables à ceux d'ESLint (leur `languageOptions`
// n'a pas d'index de chaîne). Le dépôt s'exprime dans les types d'ESLint : la
// conversion est faite ici, une fois, plutôt qu'à chaque usage.
export const baseConfig = tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // Trois règles à correction automatique : elles donnent son sens à
      // `pnpm lint:fix`, qui doit réparer ce que `pnpm lint` refuse.
      'prefer-const': 'error',
      'no-var': 'error',
      // `disallowTypeAnnotations: false` : la règle sépare `import type` de
      // `import`, elle n'a pas à interdire un type `import('…')` en position
      // d'annotation, seule écriture possible dans un `vi.doMock`.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'separate-type-imports',
          disallowTypeAnnotations: false,
        },
      ],
      // Aligné sur `noUnusedParameters` du tsconfig : un paramètre volontairement
      // ignoré se nomme `_quelqueChose`.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
) as unknown as Linter.Config[]

/**
 * Chemins ignorés par tout le dépôt.
 *
 * `tests/fixtures/layers/**` est ignoré **ici et seulement ici** : cette
 * arborescence contient des violations volontaires de la règle de frontières,
 * et c'est `tests/lint-rules.test.ts` qui l'analyse, avec sa propre
 * configuration. Sans cette exclusion, `pnpm lint` échouerait en permanence.
 */
export const ignoresConfig: Linter.Config = {
  ignores: [
    '**/node_modules/**',
    '**/.next/**',
    '**/.turbo/**',
    '**/dist/**',
    '**/playwright-report/**',
    '**/test-results/**',
    'apps/web/next-env.d.ts',
    'tests/fixtures/layers/**',
  ],
}
