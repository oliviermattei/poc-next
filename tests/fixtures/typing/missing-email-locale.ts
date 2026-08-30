import { defineModule } from '@repo/core'

/**
 * **Doit échouer** : un template d'email livré sans version dans chacune des
 * locales livrées.
 *
 * Le module livre `fr` et `en` ; le template ne connaît que `fr`. Le critère de
 * la story n'exige qu'un test — le contrat fait mieux et l'attrape à la
 * compilation, avant qu'un email puisse partir dans une langue qui n'existe pas.
 */
export const moduleWithIncompleteEmail = defineModule({
  id: 'fixture-missing-email-locale',
  requires: [],
  schema: {},
  migrations: null,
  routes: [],
  navigation: [],
  messages: {
    fr: { 'nav.title': 'Titre' },
    en: { 'nav.title': 'Title' },
  },
  emails: [
    {
      id: 'welcome',
      locales: {
        fr: { subject: 'Bienvenue', body: 'Bonjour' },
      },
    },
  ],
  webhooks: [],
  jobs: [],
  dataCategories: [],
  retention: {},
  purge: () => Promise.resolve(),
  export: () => Promise.resolve({}),
})
