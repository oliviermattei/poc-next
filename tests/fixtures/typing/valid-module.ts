import { defineModule, type ModuleIdOf } from '@repo/core'

import type { availableModules, AvailableModuleId } from '../../../config/features'

/**
 * Le témoin : ce fichier **doit** compiler.
 *
 * Sans lui, les trois fixtures voisines pourraient échouer pour une raison qui
 * n'a rien à voir avec ce qu'elles prétendent prouver — un chemin cassé, un
 * export renommé — et le test resterait vert.
 */
export const completeModule = defineModule({
  id: 'fixture-complete',
  requires: [],
  schema: {},
  migrations: null,
  routes: [],
  navigation: [],
  publicUrls: () => [],
  messages: {
    fr: { 'nav.title': 'Titre' },
    en: { 'nav.title': 'Title' },
  },
  emails: [
    {
      id: 'welcome',
      locales: {
        fr: { subject: 'Bienvenue', body: 'Bonjour' },
        en: { subject: 'Welcome', body: 'Hello' },
      },
    },
  ],
  webhooks: [],
  jobs: [],
  dataCategories: ['content', 'identity'],
  retention: { content: 'erase', identity: 'anonymize' },
  purge: () => Promise.resolve(),
  export: () => Promise.resolve({}),
})

/** Un identifiant connu passe. */
export const enabled = ['demo-enabled'] as const satisfies readonly AvailableModuleId[]

/**
 * Gardes d'inertie.
 *
 * Si `AvailableModuleId` s'élargissait à `string` — un `as string[]` de
 * complaisance dans `config/features.ts`, une annuaire annotée au lieu d'être
 * inférée — les trois fixtures voisines cesseraient d'échouer et le test
 * deviendrait vert en ne vérifiant plus rien. Ces deux lignes échouent à leur
 * place : `string extends T` n'est vrai que si `T` est exactement `string`.
 */
type IsExactlyString<T> = string extends T ? true : false

export const idsStayNarrow: IsExactlyString<AvailableModuleId> = false
export const directoryStaysTyped: IsExactlyString<ModuleIdOf<typeof availableModules>> = false
