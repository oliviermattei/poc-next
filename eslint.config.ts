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

/**
 * La portée des gardes de ce fichier, écrite **une fois**.
 *
 * Un fichier qu'aucune portée ne nomme n'est pas « autorisé » : il n'est pas
 * linté du tout. Les portées divergeaient — `apps/**` en `*.{ts,tsx}`,
 * `packages/**` en `*.{ts,tsx,mts,cts}` — et un `.mts` d'application passait
 * sous toutes les gardes, mesuré en revue de s08. Une seule liste, partagée,
 * pour que l'écart ne se recrée pas.
 *
 * Elle couvre les extensions TypeScript **et** JavaScript. Le dépôt ne compte
 * que deux sources JavaScript au 31 août 2026 — `apps/web/postcss.config.mjs`
 * et `packages/cli/bin/ks.mjs` — mais un `.mjs` d'application important Radix
 * passait toutes les gardes, mesuré. Une portée qui dépend du fait qu'on
 * n'écrit pas de JavaScript n'est pas une portée. Elle est donc plus large que
 * ce que les `tsconfig` compilent, et c'est voulu : le balayage du dépôt
 * (`tests/module-registry.test.ts`) reste, lui, aligné sur le compilateur.
 */
const SOURCE_EXTENSIONS = '{ts,tsx,mts,cts,js,jsx,mjs,cjs}'

const sources = (directory: string): string => `${directory}/**/*.${SOURCE_EXTENSIONS}`

/** Les fichiers de premier niveau : configuration du dépôt, scripts isolés. */
const ROOT_SOURCES = `*.${SOURCE_EXTENSIONS}`

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
  // `radix-ui` — le paquet unifié, celui que la documentation de Radix installe
  // aujourd'hui — est visé au même titre que les paquets par composant. Il
  // n'est pas installé ici ; ne pas le nommer laissait la garde entière
  // contournable par un `pnpm add radix-ui`.
  group: ['@radix-ui/*', '@radix-ui/*/**', 'radix-ui', 'radix-ui/**'],
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
const RADIX_PATTERN = '/^(@radix-ui\\u002f|radix-ui($|\\u002f))/'

const COMPONENT_BASE_SYNTAX = [
  // Les deux formes statiques que `no-restricted-imports` ne voit pas.
  // `export type P = import('@radix-ui/react-dialog').DialogProps` passait
  // **partout**, module compris — mesuré en revue. Elle est typée, elle
  // compile, elle donne le type du socle sans qu'aucun `import` n'apparaisse :
  // c'est exactement l'argument qui l'avait fait fermer pour `@repo/db`, et la
  // laisser ouverte ici faisait de l'interdit une question de mise en forme.
  ...['TSImportType', 'TSExternalModuleReference'].map(
    (parent) => `${parent} > Literal[value=${RADIX_PATTERN}]`,
  ),
  ...DYNAMIC_IMPORT_FORMS.flatMap((parent) => [
    `${parent} > Literal[value=${RADIX_PATTERN}]`,
    `${parent} > TemplateLiteral[quasis.0.value.raw=${RADIX_PATTERN}]`,
  ]),
].map((selector) => ({ selector, message: COMPONENT_BASE_RESTRICTION.message }))

/**
 * **Un `<form>` déclare toujours sa méthode** (C1 de la revue de s08).
 *
 * Un formulaire sans `method` est un `GET` vers l'URL courante : c'est le
 * défaut du navigateur, et il s'applique chaque fois que le gestionnaire React
 * n'est pas encore attaché — hydratation en cours, script en échec, réseau
 * lent. Mesuré, JavaScript coupé, sur les deux écrans du dépôt :
 * `/account?currentPassword=…&newPassword=…` et `/sign-in?email=…&password=…`.
 * Le secret atterrit alors dans le journal d'accès du serveur, dans
 * l'historique du navigateur et dans le `Referer` des requêtes suivantes —
 * `docs/security.md` §5.
 *
 * La règle ne juge pas la **valeur** : `method="get"` reste légitime pour un
 * formulaire qui ne porte pas de secret. Elle exige que le choix soit **écrit
 * sur place**, en toutes lettres, là où le repli se paie. Ce qu'elle refuse
 * donc aussi, et c'est délibéré : un `method` étalé depuis un objet
 * (`<form {...props}>`) et un `method` calculé (`<form method={m}>`,
 * `<form method={undefined}>`) — le sélecteur ne peut pas lire ce qu'ils
 * valent, et une garde qui accepte ce qu'elle ne peut pas vérifier n'est pas
 * une garde. Un composant qui aurait besoin d'une méthode variable est une
 * décision, pas un détail d'écriture.
 *
 * Repris par chaque bloc qui déclare `no-restricted-syntax`, `packages/ui`
 * compris : c'est là que vivront les composants `Form` du design system.
 */
const FORM_METHOD_SYNTAX = [
  {
    selector:
      "JSXOpeningElement[name.name='form']:not(:has(JSXAttribute[name.name='method'][value.type='Literal']))",
    message:
      'Un `<form>` déclare sa méthode : sans `method`, le repli du navigateur est un `GET` vers l’URL courante, et les champs — mot de passe compris — partent dans la chaîne de requête (docs/security.md §5). `method="post"` pour tout formulaire qui envoie quelque chose.',
  },
]

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
    files: [sources('packages/config/src')],
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
        ...FORM_METHOD_SYNTAX,
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
 * La portée est celle de `sources()`, partagée par toutes les gardes de ce
 * fichier. Elle s'arrêtait à `.ts`, et un fichier qu'aucune configuration ne
 * matche n'est pas « autorisé » : il n'est **pas linté du tout**.
 * `docs/architecture.md` place les composants React dans le `presentation/` de
 * chaque module — le premier composant livré serait sorti de la portée sans
 * qu'un seul cas ne rougisse. Elle est aujourd'hui **plus large** que le
 * balayage du dépôt (`tests/module-registry.test.ts`), qui suit ce que le
 * `tsconfig` d'un module compile : c'est le lint qui garde, le balayage qui
 * confirme — l'inverse serait faux.
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

/**
 * **La porte réseau d'un module** (s12, `docs/reliability.md` §3).
 *
 * « Tout appel réseau sortant porte un délai d'attente explicite. Aucun appel
 * sans délai. » Le délai, les reprises et leur recul vivent en un seul endroit
 * par module — `infrastructure/oauth-outbound.ts` pour `auth` —, et cette règle
 * est ce qui empêche le prochain appel sortant d'être écrit à côté. Sans elle,
 * la conformité mesurée aujourd'hui ne dirait rien de demain : c'est
 * exactement le constat qui a bloqué la revue de s12.
 */
const OUTBOUND_FETCH_MESSAGE =
  'Un appel réseau sortant d’un module passe par sa porte bornée (`infrastructure/oauth-outbound.ts`) : `docs/reliability.md` §3 exige un délai d’attente explicite, et des reprises en recul exponentiel avec dispersion et plafond, sur les seules erreurs transitoires. `@better-fetch/fetch` comme `fetch` n’en arment aucun par défaut.'

const OUTBOUND_FETCH_SYNTAX = [
  // `fetch(…)` nu.
  { selector: "CallExpression[callee.type='Identifier'][callee.name='fetch']" },
  // `globalThis.fetch(…)`, `window.fetch(…)`, et toute autre écriture qui passe
  // par une propriété : le sélecteur porte sur le nom appelé, pas sur l'objet.
  { selector: "CallExpression[callee.type='MemberExpression'][callee.property.name='fetch']" },
].map((entry) => ({ ...entry, message: OUTBOUND_FETCH_MESSAGE }))

/**
 * Les interdits communs à tous les fichiers d'un module.
 *
 * Extraits parce qu'ils sont déclarés **deux fois** : une fois pour le module
 * entier, une fois pour la porte réseau, qui les garde tous sauf le sien. En
 * configuration plate, le dernier bloc qui matche remplace la valeur de
 * `no-restricted-syntax` — les recopier serait le moyen le plus sûr d'en perdre
 * un au prochain ajout.
 */
const MODULE_SYNTAX = [
  ...[
    ...STATIC_IMPORT_FORMS.map((parent) => `${parent} > ${REPO_DB_LITERAL}`),
    ...DYNAMIC_IMPORT_FORMS.flatMap((parent) => [
      `${parent} > ${REPO_DB_LITERAL}`,
      `${parent} > ${REPO_DB_TEMPLATE}`,
    ]),
  ].map((selector) => ({ selector, message: MODULE_DB_MESSAGE })),
  // Un module n'importe pas non plus le socle de composants (ADR 022).
  // Les trois interdits partagent ce bloc parce qu'ils partagent la règle :
  // les séparer en trois blocs sur les mêmes fichiers ferait disparaître les
  // deux premiers.
  ...COMPONENT_BASE_SYNTAX,
  ...FORM_METHOD_SYNTAX,
]
const moduleDatabaseBoundary: Linter.Config[] = [
  {
    files: [sources('packages/modules')],
    rules: {
      'no-restricted-syntax': ['error', ...MODULE_SYNTAX, ...OUTBOUND_FETCH_SYNTAX],
    },
  },
  {
    // La porte, et elle seule : c'est le fichier dont le métier est d'appeler
    // le réseau, sous délai et sous reprise. Il garde tous les autres
    // interdits du module.
    files: ['packages/modules/*/src/infrastructure/oauth-outbound.ts'],
    rules: { 'no-restricted-syntax': ['error', ...MODULE_SYNTAX] },
  },
]

/**
 * **Une lecture du module `organizations` passe par sa porte unique**
 * (constat F2 de la revue de s15).
 *
 * La story affirmait rendre « l'oubli du périmètre organisationnel impossible
 * plutôt que déconseillé ». La revue a mesuré le contraire : un fichier neuf
 * dans `infrastructure/`, lisant `organization` par un identifiant venu du
 * corps de la requête, passait `pnpm typecheck`, `pnpm lint` et les 811 tests.
 * La marque de type d'`OrganizationAccess` garde les deux **écritures** qui
 * l'exigent ; aucune commande ne gardait les **lectures**, c'est-à-dire le
 * chemin par lequel une fuite se produit.
 *
 * D'où cette règle, qui est le levier le plus étroit qui morde : dans tout le
 * module, appeler `select`, `from` ou `execute` sur une connexion est refusé,
 * **sauf** dans `infrastructure/scoped-reads.ts`. Ce fichier est la seule porte
 * de lecture, et chacune de ses fonctions prend le propriétaire en premier
 * paramètre — le compilateur refuse alors de l'omettre. Une lecture neuve n'a
 * plus que deux issues : passer par la porte, ou faire échouer `pnpm lint`.
 *
 * **Ce qu'elle ne tient pas**, et il faut le lire avant de s'y fier :
 *
 * - à l'intérieur de la porte, rien n'oblige le prédicat à porter le compte.
 *   C'est `tests/organizations.test.ts` qui l'éprouve, par mutation ;
 * - un appel dont le nom de méthode n'est pas visible à la syntaxe
 *   (`const { select } = db`) n'est pas vu. Il faut l'écrire exprès ;
 * - la portée est **ce module**. Un futur module qui porterait de la donnée
 *   d'organisation aura besoin de la sienne : cette règle ne la lui donne pas.
 *
 * Elle **reprend** les sélecteurs des blocs précédents : en configuration
 * plate, une seconde déclaration de `no-restricted-syntax` sur les mêmes
 * fichiers remplace les options de la première. Sans la reprise, ce module
 * serait le seul du dépôt où `@repo/db` et un `<form>` sans `method`
 * passeraient — deux cas de `tests/lint-rules.test.ts` rougissent si elle
 * disparaît.
 */
const SCOPED_READ_MESSAGE =
  'Périmètre organisationnel (revue s15, F2) : une lecture du module `organizations` passe par `infrastructure/scoped-reads.ts`, dont chaque fonction exige le propriétaire en premier paramètre. Une lecture écrite ailleurs peut oublier l’appartenance — c’est exactement ce qui a été mesuré, et ce qui rendait `dataOwnerOf` capable de résoudre vers une organisation quittée.'

const SCOPED_READ_SYNTAX = ['select', 'from', 'execute'].flatMap((method) =>
  [
    // `db.select(…)`, `?.` compris — la forme qu'on écrit.
    `CallExpression[callee.type='MemberExpression'][callee.property.name='${method}']`,
    // `db['select'](…)` — la même chose, écrite pour ne pas être vue.
    `CallExpression[callee.type='MemberExpression'][callee.property.value='${method}']`,
  ].map((selector) => ({ selector, message: SCOPED_READ_MESSAGE })),
)

const organizationPerimeter: Linter.Config[] = [
  {
    files: [sources('packages/modules/organizations/src')],
    ignores: ['packages/modules/organizations/src/infrastructure/scoped-reads.ts'],
    rules: {
      // En configuration plate, le dernier bloc qui matche **remplace** la
      // valeur de `no-restricted-syntax` : ce bloc doit donc reprendre tout ce
      // que le module devait déjà respecter — les interdits communs et la
      // porte réseau de s12 — sinon les poser ici les ferait disparaître pour
      // ce module précis, sans que rien ne rougisse.
      'no-restricted-syntax': [
        'error',
        ...MODULE_SYNTAX,
        ...OUTBOUND_FETCH_SYNTAX,
        ...SCOPED_READ_SYNTAX,
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
    files: [sources('packages'), sources('tooling')],
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
    // Tout ce qui n'est ni un package ni du tooling : les applications, mais
    // aussi `config/`, `scripts/`, `generated/` et les fichiers de premier
    // niveau. Ces quatre-là n'étaient dans aucune portée — un interdit qu'aucun
    // motif ne nomme ne se distingue pas d'un oubli.
    //
    // `generated/` porte les barils produits par `pnpm db:generate` depuis les
    // schémas des modules : ils sont versionnés, compilés par le `tsconfig`
    // racine, et réécrits par `pnpm ks toggle`. Les mettre hors de portée
    // reviendrait à parier sur ce que le gabarit de génération produit
    // aujourd'hui — « il ne peut pas contenir de JSX » est précisément
    // l'affirmation d'exhaustivité que le `AGENTS.md` racine interdit. Le
    // gabarit change, la portée reste.
    files: [
      sources('apps'),
      sources('config'),
      sources('scripts'),
      sources('generated'),
      ROOT_SOURCES,
    ],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ ...COMPONENT_BASE_RESTRICTION }] }],
    },
  },
  {
    // La forme dynamique, là où `no-restricted-syntax` est libre. Les deux
    // blocs qui l'occupent déjà — `packages/config/src` et
    // `packages/modules/**` — portent les mêmes sélecteurs chez eux ; les
    // exclure ici est ce qui les empêche d'être écrasés.
    files: [
      sources('apps'),
      sources('packages'),
      sources('tooling'),
      sources('config'),
      sources('scripts'),
      sources('generated'),
      ROOT_SOURCES,
    ],
    ignores: ['packages/ui/**', 'packages/config/src/**', 'packages/modules/**'],
    rules: {
      'no-restricted-syntax': ['error', ...COMPONENT_BASE_SYNTAX, ...FORM_METHOD_SYNTAX],
    },
  },
  {
    // `packages/ui` est le seul endroit du dépôt sans interdit de socle — c'est
    // sa raison d'être — donc le seul qu'aucun bloc `no-restricted-syntax` ne
    // visait. Il lui faut le sien : les composants `Form` du design system y
    // vivront, et c'est le formulaire de quinze écrans qui se décide là.
    files: [sources('packages/ui')],
    rules: { 'no-restricted-syntax': ['error', ...FORM_METHOD_SYNTAX] },
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
  // linté du tout. La portée est celle de `sources()`, partagée par toutes les
  // gardes de ce fichier : une seule liste d'extensions, pour que la divergence
  // mesurée en revue de s08 (`apps/**` en `*.{ts,tsx}`) ne se recrée pas.
  ...libraryConfig([sources('packages'), sources('tooling')]),
  ...nextConfig(['apps/web/**/*.ts', 'apps/web/**/*.tsx']),
  // Après `libraryConfig`, dont il reprend le motif ; avant
  // `configClientSurface`, qui reprend les deux. L'ordre **est** la règle : le
  // dernier bloc qui matche un fichier décide de `no-restricted-imports`.
  ...componentBaseBoundary,
  ...configClientSurface,
  ...moduleDatabaseBoundary,
  // Après `moduleDatabaseBoundary`, dont il reprend les sélecteurs : le dernier
  // bloc qui matche décide de `no-restricted-syntax`.
  ...organizationPerimeter,
  ...testHarnessException,
]

export default config
