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
 * Bloc de configuration ESLint portant la règle. Partagé, littéralement, entre
 * `eslint.config.ts` (le dépôt réel) et le test qui l'éprouve sur les
 * fixtures : une règle prouvée ailleurs que là où elle s'applique ne prouve
 * rien.
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
        message:
          'Frontière de couches (ADR 006) : {{from.type}} ne peut pas importer {{to.type}}.',
        policies: layerPolicies,
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
