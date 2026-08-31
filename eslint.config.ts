import { builtinModules } from 'node:module'

import { baseConfig, ignoresConfig } from '@repo/eslint-config/base'
import { boundariesConfig } from '@repo/eslint-config/boundaries'
import { libraryConfig } from '@repo/eslint-config/library'
import { nextConfig } from '@repo/eslint-config/next'
import type { Linter } from 'eslint'

/**
 * Tous les modules Node, sous leurs deux écritures : `fs` et `node:fs`.
 * Dérivée de `node:module`, jamais recopiée à la main — une liste figée
 * vieillit et laisse passer le module qu'on a oublié.
 */
const NODE_BUILTINS = builtinModules.flatMap((name) => [name, `node:${name}`])

/** Sélecteur esquery couvrant `require('fs')` et `import('node:fs')`. */
const nodeBuiltinLiteral = (): string => {
  const alternatives = builtinModules.map((name) => name.replaceAll('/', '\\u002f')).join('|')

  return `Literal[value=/^(node:)?(${alternatives})$/]`
}

/**
 * Surface client de `@repo/config` (finding N13 de s01).
 *
 * Ce package est le point d'accès unique à l'environnement et hébergera les
 * variables `NEXT_PUBLIC_*` : un composant client finira par l'importer. Si son
 * barril tire `node:fs`, c'est tout le graphe client qui le tire.
 *
 * s01 gardait cette frontière avec une expression régulière sur le texte du
 * fichier, qui ne reconnaissait que les guillemets simples et les
 * spécificateurs préfixés `node:` — un `import … from "node:fs"` passait, prouvé
 * par mutation en revue. La règle ci-dessous couvre les deux écritures de
 * guillemets, les spécificateurs nus (`fs`), `require` et l'import dynamique,
 * et s'applique à **tout** le package sauf ses deux fichiers explicitement
 * serveur : la garantie est alors transitive, et non limitée au barril.
 */
const configClientSurface: Linter.Config[] = [
  {
    files: ['packages/config/src/**/*.ts'],
    ignores: ['packages/config/src/dotenv.ts', 'packages/config/src/server.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: NODE_BUILTINS.map((name) => ({
            name,
            message:
              "Surface client de @repo/config : ce qui lit le système de fichiers vit dans `@repo/config/server` (src/dotenv.ts, src/server.ts), jamais dans le barril public.",
          })),
          patterns: [
            {
              group: ['./dotenv', '../dotenv'],
              message:
                'Réexporter `./dotenv` depuis la surface client ramène `node:fs` dans le graphe client.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: `CallExpression[callee.name=require] > ${nodeBuiltinLiteral()}`,
          message: 'Surface client de @repo/config : aucun module Node, même en `require`.',
        },
        {
          selector: `ImportExpression > ${nodeBuiltinLiteral()}`,
          message: 'Surface client de @repo/config : aucun module Node, même en import dynamique.',
        },
      ],
    },
  },
]

/**
 * **Un module n'importe jamais `@repo/db`** (ADR 020).
 *
 * `packages/db` construit son schéma relationnel depuis l'agrégat généré, qui
 * importe les packages des modules activés. La dépendance inverse fermerait un
 * cycle — `@repo/db` → agrégat → module → `@repo/db` — dont la conséquence
 * n'est pas une erreur de compilation mais une table lue avant d'être
 * initialisée, à l'exécution, dans le module le plus sensible du socle. Un
 * module **reçoit** sa connexion de son point de composition.
 *
 * s07 gardait cette frontière par une expression régulière sur le texte des
 * fichiers, qui ne reconnaissait que les guillemets simples : un
 * `import type { ModuleSchema } from "@repo/db"` passait `pnpm test`,
 * `pnpm lint` et `pnpm typecheck`, prouvé par mutation en revue. Même classe de
 * défaut que la garde de s01 sur `@repo/config` : une règle qu'un guillemet
 * défait n'est pas une règle.
 *
 * C'est `no-restricted-syntax` et non `no-restricted-imports` parce que
 * `libraryConfig` occupe déjà le second sur `packages/**` : le redéfinir ici
 * remplacerait l'interdit « un package ne dépend pas d'une application » au
 * lieu de s'y ajouter. Les cinq sélecteurs couvrent l'import statique (type
 * compris), le réexport nommé, le réexport total, l'import dynamique et
 * `require` — donc les deux écritures de guillemets, par construction.
 */
const REPO_DB_SPECIFIER = 'Literal[value=/^@repo\\u002fdb($|\\u002f)/]'

const MODULE_DB_MESSAGE =
  'Un module ne dépend jamais de `@repo/db` (ADR 020) : la connexion est injectée par le point de composition. La dépendance inverse ferme un cycle dont la conséquence est une table lue avant son initialisation, à l’exécution.'

const moduleDatabaseBoundary: Linter.Config[] = [
  {
    files: ['packages/modules/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...[
          'ImportDeclaration',
          'ExportNamedDeclaration',
          'ExportAllDeclaration',
          'ImportExpression',
          'CallExpression[callee.name=require]',
        ].map((parent) => ({
          selector: `${parent} > ${REPO_DB_SPECIFIER}`,
          message: MODULE_DB_MESSAGE,
        })),
      ],
    },
  },
]

/**
 * Exception nommée pour le harnais de test (finding F8 / N17 de s01).
 *
 * Les tests franchissent délibérément les frontières que ce fichier fait
 * respecter partout ailleurs : `vitest.config.ts` alias `@repo/config` et
 * `@repo/db` vers leurs sources, `tests/health.test.ts` importe
 * `../apps/web/app/api/health/route`, et le harnais lit des fichiers du dépôt
 * sur le disque. C'est assumé : un test de câblage doit pouvoir observer le
 * câblage, et un test de couche doit pouvoir importer la couche.
 *
 * Ce qui compte est que l'exception soit **écrite** et **bornée**, et non
 * obtenue par omission — un chemin qu'aucune règle ne mentionne ne se
 * distingue pas d'un oubli.
 *
 * Elle est **plus étroite que `vitest.config.ts`**, et c'est délibéré. Vitest
 * accepte les tests de n'importe quelle profondeur sous `packages/`, futurs
 * modules compris ; l'exception ci-dessous s'arrête aux packages de premier
 * niveau. **Les tests d'un module sont donc soumis aux règles de couches de ce
 * module** : un test de `domain` qui a besoin d'`infrastructure` ne signale pas
 * une règle trop stricte, il signale un `domain` qui n'est plus pur. L'écart
 * échoue fermé et bruyamment ; s'il devenait un jour injustifiable, il se
 * lèvera par un ADR, pas par un astérisque. Portée épinglée par
 * `tests/lint-rules.test.ts`.
 */
const testHarnessException: Linter.Config[] = [
  {
    files: ['tests/**/*.ts', 'e2e/**/*.ts', 'packages/*/src/**/*.test.ts'],
    rules: {
      'no-restricted-imports': 'off',
      'boundaries/dependencies': 'off',
    },
  },
]

const config: Linter.Config[] = [
  ignoresConfig,
  ...baseConfig,
  boundariesConfig,
  ...libraryConfig(['packages/**/*.ts', 'tooling/**/*.ts']),
  ...nextConfig(['apps/web/**/*.ts', 'apps/web/**/*.tsx']),
  ...configClientSurface,
  ...moduleDatabaseBoundary,
  ...testHarnessException,
]

export default config
