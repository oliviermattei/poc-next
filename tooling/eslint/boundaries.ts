import type { Linter } from 'eslint'
import boundaries from 'eslint-plugin-boundaries'
import tseslint from 'typescript-eslint'

/**
 * Règle de dépendance des couches (ADR 006).
 *
 *   presentation ─┐
 *                 ├─→ application ─→ domain
 *   infrastructure┘
 *
 * `domain` n'importe aucune autre couche. `application` n'importe que
 * `domain`. `infrastructure` et `presentation` importent `application` et
 * `domain`, et **ne se connaissent pas**.
 *
 * Les chemins collent à `docs/architecture.md` :
 * `packages/modules/<module>/src/{domain,application,infrastructure,presentation}`.
 * Le préfixe globstar des motifs est ce qui permet à la même configuration de
 * servir l'arborescence réelle et l'arborescence de fixtures : micromatch fait
 * correspondre un globstar de tête à zéro segment.
 *
 * Aucun module n'existe encore (le premier arrive en s03) : écrite « à blanc »,
 * cette règle serait inerte sans qu'on s'en aperçoive — un motif de chemin qui
 * ne matche rien ne lève jamais. Elle est donc prouvée sur
 * `tests/fixtures/layers/`, qui contient une violation réelle de **chacune**
 * des sept arêtes interdites, par `tests/lint-rules.test.ts`.
 *
 * `capture: ['module']` isole le nom du module dans le chemin ; il sert aux
 * messages d'erreur et laisse la porte ouverte à une règle inter-modules, qui
 * n'est pas de cette story.
 */
export const layerElements = [
  {
    type: 'domain',
    pattern: '**/packages/modules/*/src/domain',
    capture: ['module'],
  },
  {
    type: 'application',
    pattern: '**/packages/modules/*/src/application',
    capture: ['module'],
  },
  {
    type: 'infrastructure',
    pattern: '**/packages/modules/*/src/infrastructure',
    capture: ['module'],
  },
  {
    type: 'presentation',
    pattern: '**/packages/modules/*/src/presentation',
    capture: ['module'],
  },
]

/** Ce que chaque couche a le droit d'importer. Le reste est refusé. */
export const layerPolicies = [
  { from: { element: { type: 'application' } }, allow: { to: { element: { type: 'domain' } } } },
  {
    from: { element: { type: 'infrastructure' } },
    allow: { to: { element: { types: { anyOf: ['application', 'domain'] } } } },
  },
  {
    from: { element: { type: 'presentation' } },
    allow: { to: { element: { types: { anyOf: ['application', 'domain'] } } } },
  },
]

/**
 * Ce que le `domain` n'a pas le droit d'importer (ADR 006, tranché en s03).
 *
 * L'ADR interdit au `domain` « framework, ORM ou SDK » ; voici la liste, et
 * elle est une **liste de refus**, pas une liste blanche. Interdire tout ce qui
 * n'est pas nommé serait plus strict que l'ADR : une bibliothèque pure de plus
 * (dates, décimales) n'a aucune raison d'être refusée, et une règle plus
 * sévère que sa décision finit désactivée plutôt que discutée.
 *
 * Les motifs portent sur la **base** du spécificateur : `drizzle-orm` couvre
 * `drizzle-orm/pg-core`, `next` couvre `next/navigation`.
 *
 * `zod` n'y est délibérément pas : ce n'est ni un framework, ni un ORM, ni un
 * SDK — c'est une bibliothèque pure, sans entrée-sortie, et un type de valeur
 * validé appartient au domaine. Le socle de sécurité impose Zod aux frontières ;
 * il ne l'interdit pas au centre.
 */
export const domainForbiddenSources = [
  // frameworks
  'next',
  'react',
  'react-dom',
  // ORM et pilotes
  'drizzle-orm',
  'drizzle-kit',
  'pg',
  // couche API
  'hono',
  '@orpc/*',
  // authentification
  'better-auth',
  '@better-auth/*',
  // SDK de services tiers
  'stripe',
  'resend',
  'inngest',
  '@aws-sdk/*',
  'posthog-*',
  '@sentry/*',
  // packages d'infrastructure du dépôt
  '@repo/db',
  '@repo/ui',
  '@repo/api',
  '@repo/config',
]

/**
 * Bloc de configuration ESLint portant la règle. Partagé, littéralement, entre
 * `eslint.config.ts` (le dépôt réel) et le test qui l'éprouve sur les
 * fixtures : une règle prouvée ailleurs que là où elle s'applique ne prouve
 * rien.
 *
 * `checkAllOrigins: true` est ce qui donne son existence à la pureté du
 * `domain`. Par défaut, la règle n'examine **que** les dépendances locales :
 * `node_modules` et les modules natifs de Node ne sont jamais regardés — c'est
 * précisément pourquoi, après s02, un `domain` important `drizzle-orm` passait
 * sans une erreur. L'activer oblige à dire ce que les autres couches ont le
 * droit d'importer, d'où la politique qui suit immédiatement les couches.
 */
export const boundariesConfig: Linter.Config = {
  plugins: { boundaries },
  settings: {
    'boundaries/elements': layerElements,
    // Le résolveur par défaut ne connaît pas l'extension `.ts` : sans cette
    // ligne, aucun import relatif n'est résolu, aucune dépendance n'est
    // classée, et la règle ne lève jamais rien.
    'import/resolver': {
      node: { extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] },
    },
  },
  rules: {
    'boundaries/dependencies': [
      'error',
      {
        default: 'disallow',
        checkAllOrigins: true,
        message:
          'Frontière de couches (ADR 006) : {{from.type}} ne peut pas importer {{to.type}}.',
        policies: [
          ...layerPolicies,
          // Hors du `domain`, un paquet tiers ou un module de Node ne regarde
          // pas cette règle : c'est le rôle du manifeste du package.
          {
            from: { element: { type: '!domain' } },
            allow: { to: { module: { origin: ['external', 'core'] } } },
          },
          // Dans le `domain`, la liste de refus ci-dessous décide — donc tout
          // le reste passe. L'ordre compte : au sein d'une même règle, le
          // dernier sélecteur qui correspond l'emporte, et le refus vient après.
          {
            from: { element: { type: 'domain' } },
            allow: { to: { module: { origin: 'external' } } },
          },
          {
            from: { element: { type: 'domain' } },
            disallow: {
              to: {
                module: [
                  // Tous les modules natifs de Node, sous leurs deux écritures :
                  // l'origine « core » les couvre sans liste à maintenir.
                  { origin: 'core' },
                  { origin: 'external', source: domainForbiddenSources },
                ],
              },
            },
            message:
              'Pureté du domain (ADR 006) : « {{dependency.source}} » n’a pas sa place dans domain/. Les règles métier ne connaissent ni framework, ni ORM, ni SDK, ni système de fichiers — l’adaptateur va dans infrastructure/, le port dans application/.',
          },
        ],
      },
    ],
  },
}

/**
 * La même règle, seule, avec le strict nécessaire pour analyser du TypeScript.
 *
 * C'est ce que `tests/lint-rules.test.ts` exécute sur `tests/fixtures/layers/`.
 * L'objet `boundariesConfig` y est le **même** que celui du dépôt : prouver la
 * règle sur une copie ne prouverait que la copie.
 */
export const boundariesOnlyConfig: Linter.Config[] = [
  { files: ['**/*.ts'], languageOptions: { parser: tseslint.parser } },
  boundariesConfig,
]
