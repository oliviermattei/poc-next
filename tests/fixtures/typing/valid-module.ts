import { defineModule, type ModuleIdOf } from '@repo/core'
import type { Jobs } from '@repo/ports'

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

/**
 * Le port de jobs (s33), employé **correctement** : la branche d'échec est
 * écartée avant la lecture du succès.
 *
 * Témoin du témoin : si `EmitJobResult` cessait d'être discriminé — ou si le
 * port disparaissait — c'est ici que la compilation casserait, et le cas
 * « refuse un échec du port de jobs non traité » cesserait de prouver quoi que
 * ce soit.
 */
export const emitHandlingFailure = async (jobs: Jobs): Promise<string> => {
  const result = await jobs.emit({
    job: 'rate-limit.sweep-closed-windows',
    key: 'sweep:2026-09-05T10:00',
    data: {},
  })

  return result.ok ? result.id : result.error.code
}
