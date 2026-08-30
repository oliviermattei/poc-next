import { defineModule } from '@repo/core'

import { createDemoItemUseCases } from './application/demo-items'
import { welcomeEmail } from './emails/welcome'
import {
  createInMemoryDemoItemRepository,
  createSequentialIdGenerator,
} from './infrastructure/in-memory-demo-item-repository'
import enMessages from './messages/en.json' with { type: 'json' }
import frMessages from './messages/fr.json' with { type: 'json' }
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
 * Toutes les clés sont là — y compris `webhooks`, `emails`, `jobs`, `purge`,
 * `export` et `retention`, que rien n'oblige à remplir aujourd'hui. C'est le
 * prix à payer une fois pour ne pas rouvrir vingt modules le jour où s33, s34
 * et s35 en auront besoin.
 */
export const demoEnabledModule = defineModule({
  id: 'demo-enabled',
  requires: [],
  schema: { demoItems },
  // Dossier des migrations SQL du module, relatif à la racine du dépôt : c'est
  // la seule forme qui ne dépende ni du répertoire courant, ni d'un
  // `import.meta.url` que le bundler du serveur Next réécrit. `pnpm db:generate`
  // y écrit, `pnpm db:migrate` y lit, et le journal appliqué porte le nom du
  // module.
  migrations: 'packages/modules/demo-enabled/migrations',
  routes: createDemoItemRoutes(demoItemUseCases),
  navigation: demoItemNavigation,
  messages: { fr: frMessages, en: enMessages },
  emails: [welcomeEmail],
  webhooks: createDemoWebhookHandlers(demoItemUseCases),
  jobs: [],
  dataCategories: ['demo-items'],
  retention: { 'demo-items': 'erase' },
  purge: demoItemUseCases.purgeDemoItems,
  export: demoItemUseCases.exportDemoItems,
})
