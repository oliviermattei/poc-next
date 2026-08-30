import { defineModule } from '@repo/core'

import { createDemoItemUseCases } from './application/demo-items'
import { welcomeEmail } from './emails/welcome'
import {
  createInMemoryDemoItemRepository,
  createSequentialIdGenerator,
} from './infrastructure/in-memory-demo-item-repository'
import enMessages from './messages/en.json'
import frMessages from './messages/fr.json'
import { createDemoItemRoutes, demoItemNavigation } from './presentation/demo-item-routes'
import { createDemoWebhookHandlers } from './presentation/demo-webhooks'
import { demoItems } from './schema'

/**
 * Le point de composition du module : le seul endroit qui connaît les quatre
 * couches à la fois. Il vit à la racine de `src/`, hors des couches, parce que
 * câbler `infrastructure` dans `presentation` depuis l'une d'elles serait
 * exactement la traversée que la règle de dépendance interdit.
 */
export const demoItemUseCases = createDemoItemUseCases({
  repository: createInMemoryDemoItemRepository(),
  generateId: createSequentialIdGenerator('demo-item'),
})

/**
 * Le contrat, rempli.
 *
 * Toutes les clés sont là — y compris `webhooks`, `emails`, `purge`, `export` et
 * `retention`, que rien n'oblige à remplir aujourd'hui. C'est le prix à payer
 * une fois pour ne pas rouvrir vingt modules le jour où s34 et s35 en auront
 * besoin.
 */
export const demoEnabledModule = defineModule({
  id: 'demo-enabled',
  requires: [],
  schema: { demoItems },
  // s04 : ce module n'a pas encore de migrations, et le contrat le dit au lieu
  // de le laisser deviner.
  migrations: null,
  routes: createDemoItemRoutes(demoItemUseCases),
  navigation: demoItemNavigation,
  messages: { fr: frMessages, en: enMessages },
  emails: [welcomeEmail],
  webhooks: createDemoWebhookHandlers(demoItemUseCases),
  dataCategories: ['demo-items'],
  retention: { 'demo-items': 'erase' },
  purge: demoItemUseCases.purgeDemoItems,
  export: demoItemUseCases.exportDemoItems,
})
