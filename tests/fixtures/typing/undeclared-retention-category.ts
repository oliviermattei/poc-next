import { defineModule } from '@repo/core'

/**
 * **Doit échouer** : une politique de rétention pour une catégorie que le
 * module ne déclare pas.
 *
 * C'est l'autre sens du même mensonge. Sans le `NoInfer` du contrat, cette
 * ligne élargirait l'union des catégories au lieu de la contredire : la
 * politique serait acceptée, et `dataCategories` cesserait d'être la source de
 * vérité de ce que le module détient.
 */
export const moduleWithUndeclaredCategory = defineModule({
  id: 'fixture-undeclared-category',
  requires: [],
  schema: {},
  migrations: null,
  routes: [],
  navigation: [],
  messages: { fr: {}, en: {} },
  emails: [],
  webhooks: [],
  jobs: [],
  dataCategories: ['content'],
  retention: { content: 'erase', identity: 'anonymize' },
  purge: () => Promise.resolve(),
  export: () => Promise.resolve({}),
})
