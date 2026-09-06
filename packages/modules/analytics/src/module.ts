import { defineModule } from '@repo/core'

import { ANALYTICS_MODULE_ID } from './domain/analytics-script'
import { requireBrowserSettings, requireMonitoring } from './infrastructure/analytics-runtime'
import enMessages from './messages/en.json' with { type: 'json' }
import frMessages from './messages/fr.json' with { type: 'json' }
import { createBrowserScriptRoutes } from './presentation/browser-script-route'
import { createAnalyticsRoutes } from './presentation/client-error-routes'

/**
 * Le contrat du module `analytics` (s39), rempli — toutes les clés.
 *
 * **`requires: ['consent']`, et c'est le couplage que s36 avait annoncé.** Le
 * module `consent` ne connaît aucun fournisseur et ne requiert rien ; c'est
 * celui qui *apporte* un script tiers qui déclare avoir besoin du registre. Sans
 * ce requis, on pourrait activer l'analytique sur une installation sans
 * consentement — c'est-à-dire charger un tiers sans jamais demander.
 *
 * **Il ne persiste rien.** `schema`, `migrations`, `dataCategories` et
 * `retention` sont vides : ce module n'écrit dans aucune table. Ce qu'il envoie
 * part chez un tiers, dont la rétention est réglée chez ce tiers ; en écrire une
 * copie ici créerait la donnée personnelle que la story ne demande pas. `purge`
 * et `export` n'ont donc rien à faire.
 *
 * **Il n'a pas d'entrée de navigation** : il ne montre aucun écran. Le seul
 * réglage qui regarde le visiteur — accepter ou refuser la mesure — est celui du
 * module `consent`, et le dupliquer ici ferait deux endroits pour un choix.
 *
 * **Ce que sa coupure emporte** (critère 8) : la route de remontée d'erreur
 * client et celle qui sert le script du navigateur répondent 404, aucun script
 * n'est déclaré au registre de s36, et — la conséquence qui traverse deux
 * modules — la bannière de consentement ne s'affiche plus, faute de script non
 * essentiel à déclarer.
 */
export const analyticsModule = defineModule({
  id: ANALYTICS_MODULE_ID,
  requires: ['consent'],
  schema: {},
  migrations: null,
  routes: [
    ...createAnalyticsRoutes(requireMonitoring),
    ...createBrowserScriptRoutes(requireBrowserSettings),
  ],
  navigation: [],
  /**
   * Aucune URL publique : ce module ne publie pas de page indexable (s53).
   *
   * Déclaré vide, jamais omis — le compilateur refuse l'omission
   * (`tests/fixtures/typing/missing-public-urls.ts`).
   */
  publicUrls: () => [],
  messages: { fr: frMessages, en: enMessages },
  emails: [],
  webhooks: [],
  jobs: [],
  dataCategories: [],
  retention: {},
  purge: () => Promise.resolve(),
  export: () => Promise.resolve({}),
})
