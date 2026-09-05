import { defineModule } from '@repo/core'

import enMessages from './messages/en.json' with { type: 'json' }
import frMessages from './messages/fr.json' with { type: 'json' }

/**
 * Le contrat de « mcp-server » (s41) : un module comme un autre au sens du
 * registre (ADR 007), mais qui ne sert **aucune** route web. Le serveur MCP
 * est un process à part, lancé en `stdio` par le client qui le pilote (Claude
 * Desktop, un agent…) — pas monté dans Hono, donc `routes` et `navigation`
 * restent vides sans que ce soit un oubli.
 *
 * C'est ce contrat, et lui seul, qui rend le critère 7 vérifiable : « module
 * non activé » se lit dans `enabledModules`, exactement comme pour n'importe
 * quel autre module, et `src/bin.ts` (composition root du serveur, pas de ce
 * fichier) refuse de démarrer quand il n'y est pas.
 */
export const mcpServerModule = defineModule({
  id: 'mcp-server',
  requires: [],
  schema: {},
  migrations: null,
  routes: [],
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
  purge: async () => {},
  export: async () => ({}),
})
