import { defineModule } from '@repo/core'

import { createDemoNoteUseCases } from './application/demo-notes'
import {
  createInMemoryDemoNoteRepository,
  createSequentialIdGenerator,
} from './infrastructure/in-memory-demo-note-repository'
import enMessages from './messages/en.json'
import frMessages from './messages/fr.json'
import { createDemoNoteRoutes, demoNoteNavigation } from './presentation/demo-note-routes'
import { demoNotes } from './schema'

export const demoNoteUseCases = createDemoNoteUseCases({
  repository: createInMemoryDemoNoteRepository(),
  generateId: createSequentialIdGenerator('demo-note'),
})

/**
 * Le second module de démonstration : celui qu'on n'active pas.
 *
 * Il déclare `requires: ['demo-enabled']`, ce qui en fait aussi la preuve de la
 * validation du graphe : l'activer seul échoue en nommant le module manquant.
 *
 * `emails` et `webhooks` sont vides, et **déclarés** vides : le contrat n'a pas
 * de clé facultative. C'est ce qui permet à `s34`, `s35` ou `s09` de compter sur
 * la présence de chaque clé sans rouvrir un seul module.
 */
export const demoDisabledModule = defineModule({
  id: 'demo-disabled',
  requires: ['demo-enabled'],
  schema: { demoNotes },
  migrations: null,
  routes: createDemoNoteRoutes(demoNoteUseCases),
  navigation: demoNoteNavigation,
  messages: { fr: frMessages, en: enMessages },
  emails: [],
  webhooks: [],
  dataCategories: ['demo-notes'],
  // L'autre politique de rétention : la note reste, son rattachement disparaît.
  retention: { 'demo-notes': 'anonymize' },
  purge: demoNoteUseCases.purgeDemoNotes,
  export: demoNoteUseCases.exportDemoNotes,
})
