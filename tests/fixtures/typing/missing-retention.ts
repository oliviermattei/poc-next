import { defineModule } from '@repo/core'

/**
 * **Doit échouer** : « un module déclarant une catégorie de données sans
 * politique de rétention fait échouer la compilation ».
 *
 * `identity` est déclarée dans `dataCategories` et absente de `retention` : le
 * module dirait détenir une donnée personnelle sans dire ce qu'elle devient à
 * la suppression du compte.
 */
export const moduleWithoutRetentionPolicy = defineModule({
  id: 'fixture-missing-retention',
  requires: [],
  schema: {},
  migrations: null,
  routes: [],
  navigation: [],
  messages: { fr: {}, en: {} },
  emails: [],
  webhooks: [],
  jobs: [],
  dataCategories: ['content', 'identity'],
  retention: { content: 'erase' },
  purge: () => Promise.resolve(),
  export: () => Promise.resolve({}),
})
