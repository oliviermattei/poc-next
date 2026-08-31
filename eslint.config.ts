import { builtinModules } from 'node:module'

import { baseConfig, ignoresConfig } from '@repo/eslint-config/base'
import { boundariesConfig } from '@repo/eslint-config/boundaries'
import { APPLICATION_IMPORT_RESTRICTION, libraryConfig } from '@repo/eslint-config/library'
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
 * **`packages/ui` est la seule frontière avec le socle de composants** (ADR 022).
 *
 * L'ADR 022 remplace Base UI par Radix — aucune version stable publiée, quatorze
 * préversions — et garde de l'ADR 009 la clause qui rend le choix réversible :
 * aucun module, aucune application n'importe le socle directement. C'est elle
 * qui borne le coût du basculement le jour où Base UI se stabilise ; sans elle,
 * changer de socle redevient un refactor traversant. Une clause d'ADR n'est pas
 * une garde : le motif ci-dessous est ce qui fait échouer `pnpm lint`.
 *
 * Il est **repris** par les trois blocs qui déclarent `no-restricted-imports`
 * hors de `packages/ui` — en configuration plate, une seconde déclaration
 * remplace les options de la première, elle ne s'y ajoute pas.
 */
const COMPONENT_BASE_RESTRICTION = {
  group: ['@radix-ui/*', '@radix-ui/*/**'],
  message:
    'Le socle de composants ne sort pas de `packages/ui` (ADR 022) : un module ou un écran compose avec `@repo/ui`. C’est cette frontière qui garde le passage à Base UI, quand il aura une version stable, à un coût borné.',
} as const

/**
 * Formes où la grammaire n'admet qu'un littéral de chaîne.
 *
 * `TSImportType` est l'import de type en position d'annotation
 * (`type S = import('@repo/db').ModuleSchema`) : il ne survit pas à la
 * compilation, mais `import type … from '@repo/db'` non plus, et celui-là est
 * refusé. Laisser passer l'un des deux ferait de l'interdit une question de
 * mise en forme. `TSExternalModuleReference` est le `require` de
 * `import x = require('@repo/db')`.
 */
const STATIC_IMPORT_FORMS = [
  'ImportDeclaration',
  'ExportNamedDeclaration',
  'ExportAllDeclaration',
  'TSImportType',
  'TSExternalModuleReference',
]

/** Formes dynamiques : le spécificateur y est une expression, gabarit compris. */
const DYNAMIC_IMPORT_FORMS = ['ImportExpression', 'CallExpression[callee.name=require]']

/**
 * Le socle de composants en import **dynamique**.
 *
 * `no-restricted-imports` ne voit ni `import('@radix-ui/react-dialog')` ni son
 * `require` : mesuré, le cas passait au vert alors que les cinq écritures
 * statiques rougissaient. Un dialogue lourd chargé à la demande est exactement
 * l'écriture qu'on trouverait dans un module — la frontière serait donc franchie
 * par le chemin le plus probable. D'où ces sélecteurs, sur le modèle de la garde
 * d'ADR 020, repris par chaque bloc qui déclare `no-restricted-syntax`.
 */
const RADIX_PATTERN = '/^@radix-ui\\u002f/'

const COMPONENT_BASE_SYNTAX = DYNAMIC_IMPORT_FORMS.flatMap((parent) =>
  [
    `${parent} > Literal[value=${RADIX_PATTERN}]`,
    `${parent} > TemplateLiteral[quasis.0.value.raw=${RADIX_PATTERN}]`,
  ].map((selector) => ({ selector, message: COMPONENT_BASE_RESTRICTION.message })),
)

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
            // Ce bloc **remplace** les options des deux déclarations
            // précédentes pour les fichiers qu'il vise (`libraryConfig` et la
            // frontière du socle de composants) : sans ces deux motifs, ce
            // package serait le seul du dépôt où un import d'application ou de
            // Radix passerait. Repris depuis leur déclaration, jamais recopiés.
            { ...APPLICATION_IMPORT_RESTRICTION },
            { ...COMPONENT_BASE_RESTRICTION },
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
        // Même raison que pour les motifs d'import ci-dessus : ce bloc remplace
        // les options des précédents pour les fichiers qu'il vise.
        ...COMPONENT_BASE_SYNTAX,
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
 * lieu de s'y ajouter.
 *
 * **Ce qui a été balayé**, et rien de plus. Sur les écritures essayées une à
 * une contre la règle (`tests/lint-rules.test.ts` les rejoue) :
 *
 * - refusées — import statique et import de type, réexport nommé, réexport
 *   total (`export * as` compris), import d'effet de bord, sous-chemin
 *   `@repo/db/…`, `require`, import dynamique, `import x = require(…)`, et
 *   l'import de type en position d'annotation (`import('@repo/db').X`) ; en
 *   guillemets simples, doubles **et en accent grave** pour les formes
 *   dynamiques, seules où la grammaire admet un gabarit ;
 * - **non refusées, connues** : un spécificateur que la syntaxe ne donne pas
 *   au sélecteur — `import('@repo/' + 'db')`, `` import(`@repo/${'db'}`) ``,
 *   un `createRequire` aliasé, un identifiant reconstruit à l'exécution.
 *   Aucune de ces écritures ne se tape par accident et aucune ne rend un type ;
 *   elles sont citées pour dire où s'arrête la garde, pas pour être comptées
 *   comme couvertes.
 *
 * La portée est `packages/modules/**\/*.{ts,tsx,mts,cts}`, soit les extensions
 * que le `tsconfig` d'un module compile (`include: ["src"]`). Elle s'arrêtait à
 * `.ts`, et un fichier qu'aucune configuration ne matche n'est pas « autorisé » :
 * il n'est **pas linté du tout**. `docs/architecture.md` place les composants
 * React dans le `presentation/` de chaque module — le premier composant livré
 * serait sorti de la portée sans qu'un seul cas ne rougisse. Le balayage du
 * dépôt (`tests/module-registry.test.ts`) collecte les mêmes extensions ; les
 * deux côtés se corrigent ensemble ou la garantie est fausse d'un côté.
 */
const REPO_DB_PATTERN = '/^@repo\\u002fdb($|\\u002f)/'

/** Le spécificateur en littéral de chaîne : `'…'` comme `"…"`. */
const REPO_DB_LITERAL = `Literal[value=${REPO_DB_PATTERN}]`

/**
 * Le même spécificateur en accent grave.
 *
 * Un `TemplateLiteral` n'est pas un `Literal` : le sélecteur précédent le
 * laissait passer, prouvé par mutation en revue. Le motif porte sur le premier
 * fragment brut, donc `` `@repo/db` `` comme `` `@repo/db${suffixe}` ``.
 */
const REPO_DB_TEMPLATE = `TemplateLiteral[quasis.0.value.raw=${REPO_DB_PATTERN}]`

const MODULE_DB_MESSAGE =
  'Un module ne dépend jamais de `@repo/db` (ADR 020) : la connexion est injectée par le point de composition. La dépendance inverse ferme un cycle dont la conséquence est une table lue avant son initialisation, à l’exécution.'

const moduleDatabaseBoundary: Linter.Config[] = [
  {
    files: ['packages/modules/**/*.{ts,tsx,mts,cts}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...[
          ...STATIC_IMPORT_FORMS.map((parent) => `${parent} > ${REPO_DB_LITERAL}`),
          ...DYNAMIC_IMPORT_FORMS.flatMap((parent) => [
            `${parent} > ${REPO_DB_LITERAL}`,
            `${parent} > ${REPO_DB_TEMPLATE}`,
          ]),
        ].map((selector) => ({ selector, message: MODULE_DB_MESSAGE })),
        // Un module n'importe pas non plus le socle de composants (ADR 022).
        // Les deux interdits partagent ce bloc parce qu'ils partagent la règle :
        // les séparer en deux blocs sur les mêmes fichiers ferait disparaître le
        // premier.
        ...COMPONENT_BASE_SYNTAX,
      ],
    },
  },
]

/**
 * La frontière du socle de composants, appliquée (ADR 022, motif ci-dessus).
 *
 * Deux blocs, pour deux raisons de forme :
 *
 * - `packages/**` et `tooling/**` **redéclarent** `no-restricted-imports`, que
 *   `libraryConfig` occupe déjà. En configuration plate, la seconde
 *   déclaration remplace les options de la première : le motif « ne pas
 *   dépendre d'une application » est donc repris ici, depuis sa déclaration
 *   d'origine, jamais recopié. Un cas de `tests/lint-rules.test.ts` rougit si
 *   on l'oublie ;
 * - `apps/**` a besoin du même interdit sans le premier motif — une
 *   application a le droit de dépendre d'un package.
 *
 * `packages/ui` est exclu du premier bloc, et retrouve donc la déclaration de
 * `libraryConfig` : il ne peut pas dépendre d'une application, il peut importer
 * Radix. `packages/config/src` porte sa propre déclaration, plus haut, où le
 * motif est également repris.
 */
const componentBaseBoundary: Linter.Config[] = [
  {
    files: ['packages/**/*.{ts,tsx,mts,cts}', 'tooling/**/*.ts'],
    ignores: ['packages/ui/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [{ ...APPLICATION_IMPORT_RESTRICTION }, { ...COMPONENT_BASE_RESTRICTION }],
        },
      ],
    },
  },
  {
    files: ['apps/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ ...COMPONENT_BASE_RESTRICTION }] }],
    },
  },
  {
    // La forme dynamique, là où `no-restricted-syntax` est libre. Les deux
    // blocs qui l'occupent déjà — `packages/config/src` et
    // `packages/modules/**` — portent les mêmes sélecteurs chez eux ; les
    // exclure ici est ce qui les empêche d'être écrasés.
    files: ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx,mts,cts}', 'tooling/**/*.ts'],
    ignores: ['packages/ui/**', 'packages/config/src/**', 'packages/modules/**'],
    rules: { 'no-restricted-syntax': ['error', ...COMPONENT_BASE_SYNTAX] },
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
  // `.tsx` compris : s08 apporte les premiers composants React de package, et
  // un fichier qu'aucune portée ne nomme n'est pas « autorisé » — il n'est pas
  // linté du tout. La portée suit celle des `tsconfig` de packages
  // (`include: ["src"]`, toutes extensions TypeScript), comme la garde d'ADR
  // 020 plus bas. `tooling/` reste en `.ts` : il n'y a pas de composant dans
  // de la configuration.
  ...libraryConfig(['packages/**/*.{ts,tsx,mts,cts}', 'tooling/**/*.ts']),
  ...nextConfig(['apps/web/**/*.ts', 'apps/web/**/*.tsx']),
  // Après `libraryConfig`, dont il reprend le motif ; avant
  // `configClientSurface`, qui reprend les deux. L'ordre **est** la règle : le
  // dernier bloc qui matche un fichier décide de `no-restricted-imports`.
  ...componentBaseBoundary,
  ...configClientSurface,
  ...moduleDatabaseBoundary,
  ...testHarnessException,
]

export default config
