/**
 * Le contenu du squelette généré par `ks scaffold <id>` (s41).
 *
 * Gabarit : `packages/modules/demo-enabled`, qui se présente lui-même comme
 * tel (`packages/modules/demo-enabled/AGENTS.md`) — quatre couches, le
 * contrat au complet (ADR 007), rien omis même vide — **toutes** ses clés,
 * quel qu'en soit le nombre : l'écrire ici vieillirait à la prochaine ajoutée,
 * comme le « 13 » qui y a survécu jusqu'à ce que le contrat en porte 15. Ce squelette
 * n'a ni schéma, ni route, ni migration : ajouter la première table ou la
 * première route reste le travail du développeur, mais le contrat, lui,
 * compile dès la génération — un générateur qui produit du code qui ne
 * compile pas est pire qu'aucun générateur.
 *
 * Pur : reçoit un identifiant déjà validé (`planScaffold`), ne touche pas au
 * disque. `apply-scaffold.ts` s'en charge, avec sa propre transaction.
 */
export interface ScaffoldFile {
  /** Chemin relatif à la racine du paquet du module. */
  readonly path: string
  readonly content: string
}

const pascalCase = (id: string): string =>
  id
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')

const camelCase = (id: string): string => {
  const pascal = pascalCase(id)

  return pascal.charAt(0).toLowerCase() + pascal.slice(1)
}

export function scaffoldFiles(moduleId: string): readonly ScaffoldFile[] {
  const camel = camelCase(moduleId)

  return [
    {
      path: 'package.json',
      content: `${JSON.stringify(
        {
          name: `@repo/module-${moduleId}`,
          version: '0.0.0',
          private: true,
          type: 'module',
          exports: { '.': './src/index.ts' },
          scripts: { typecheck: 'tsc --noEmit' },
          dependencies: { '@repo/core': 'workspace:*' },
          devDependencies: {
            '@repo/typescript-config': 'workspace:*',
            '@types/node': '^22',
            typescript: '^7.0.2',
          },
        },
        null,
        2,
      )}\n`,
    },
    {
      path: 'tsconfig.json',
      content: [
        '{',
        '  "extends": "@repo/typescript-config/base.json",',
        '  "compilerOptions": {',
        '    "types": ["node"]',
        '  },',
        '  "include": ["src"],',
        '  "exclude": ["node_modules"]',
        '}',
        '',
      ].join('\n'),
    },
    {
      path: 'AGENTS.md',
      content: [
        `# packages/modules/${moduleId} — règles locales`,
        '',
        `Squelette généré par \`ks scaffold ${moduleId}\` (s41). Le contrat de module (ADR 007)`,
        'est rempli et compile déjà : toutes les clés du contrat sont là, la plupart vides.',
        'Ce fichier reste à',
        'compléter une fois que le module porte une vraie règle métier — décrire ici ce qu\'il',
        'importe, ce qu\'il ne doit jamais contenir, où vivent ses tests, comme le fait',
        '`packages/modules/demo-enabled/AGENTS.md`, son gabarit.',
        '',
        '## Imports autorisés',
        '',
        '- `@repo/core` pour le contrat de module ;',
        "- `@repo/typescript-config` pour la configuration du compilateur (`tsconfig.json`).",
        '',
        '## Ne doit jamais contenir',
        '',
        '- de règle métier hors de `domain/` ;',
        "- d'import d'un autre module : la seule dépendance inter-modules déclarée est `requires`.",
        '',
        '## Tests',
        '',
        '`src/**/*.test.ts`, à côté du code qu\'ils couvrent.',
        '',
      ].join('\n'),
    },
    {
      path: 'src/domain/index.ts',
      content: `/** Règles métier pures de « ${moduleId} ». Aucun framework, aucun ORM, aucun SDK. */\nexport {}\n`,
    },
    {
      path: 'src/application/index.ts',
      content: `/** Cas d'usage et ports de « ${moduleId} ». Dépend de \`domain\` uniquement. */\nexport {}\n`,
    },
    {
      path: 'src/infrastructure/index.ts',
      content: `/** Repositories et appels aux adapters de « ${moduleId} ». Ne connaît pas \`presentation\`. */\nexport {}\n`,
    },
    {
      path: 'src/presentation/index.ts',
      content: `/** Routes, contrats et navigation de « ${moduleId} ». Ne connaît pas \`infrastructure\`. */\nexport {}\n`,
    },
    {
      path: 'src/messages/fr.json',
      content: '{}\n',
    },
    {
      path: 'src/messages/en.json',
      content: '{}\n',
    },
    {
      path: 'src/module.ts',
      content: [
        "import { defineModule } from '@repo/core'",
        '',
        "import enMessages from './messages/en.json' with { type: 'json' }",
        "import frMessages from './messages/fr.json' with { type: 'json' }",
        '',
        '/**',
        ` * Le contrat de « ${moduleId} », généré par \`ks scaffold\` (s41).`,
        ' *',
        ' * Toutes les clés sont là, la plupart vides : ADR 007 les veut obligatoires dès le',
        ' * premier module, quitte à l’être. Ajouter un schéma, une route ou une catégorie de',
        ' * données reste le travail du développeur — ce squelette ne le devine pas.',
        ' */',
        `export const ${camel}Module = defineModule({`,
        `  id: '${moduleId}',`,
        '  requires: [],',
        '  schema: {},',
        '  migrations: null,',
        '  routes: [],',
        '  navigation: [],',
        '  publicUrls: () => [],',
        '  messages: { fr: frMessages, en: enMessages },',
        '  emails: [],',
        '  webhooks: [],',
        '  jobs: [],',
        '  dataCategories: [],',
        '  retention: {},',
        '  purge: async () => {},',
        '  export: async () => ({}),',
        '})',
        '',
      ].join('\n'),
    },
    {
      path: 'src/index.ts',
      content: `export { ${camel}Module } from './module'\n`,
    },
  ]
}
