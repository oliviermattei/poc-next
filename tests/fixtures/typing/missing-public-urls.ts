import { defineModule } from '@repo/core'

/**
 * **Doit échouer** : « un module qui ne déclare pas ses URL publiques ne
 * compile pas » (s53, critère 5).
 *
 * Les quatorze autres clés sont là ; seule `publicUrls` manque. C'est
 * exactement la faute qu'un module écrit après cette story commettrait — et le
 * prix de la rendre facultative serait un module de contenu absent du plan de
 * site sans qu'aucune commande ne le dise.
 */
export const moduleWithoutPublicUrls = defineModule({
  id: 'fixture-missing-public-urls',
  requires: [],
  schema: {},
  migrations: null,
  routes: [],
  navigation: [],
  messages: { fr: {}, en: {} },
  emails: [],
  webhooks: [],
  jobs: [],
  dataCategories: [],
  retention: {},
  purge: () => Promise.resolve(),
  export: () => Promise.resolve({}),
})
