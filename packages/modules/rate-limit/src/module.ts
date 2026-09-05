import { defineModule, type ModuleJob } from '@repo/core'

import enMessages from './messages/en.json' with { type: 'json' }
import frMessages from './messages/fr.json' with { type: 'json' }
import { rateLimitSchema } from './schema'

/**
 * Le contrat du module `rate-limit` (s28, ADR 050).
 *
 * **Un module sans route, sans navigation et sans message** — et c'est délibéré.
 * Ce qu'il apporte n'est pas une fonctionnalité du produit : c'est une table et
 * la règle qui la lit. Il est ici parce que le dépôt n'a **qu'un** mécanisme
 * pour qu'une table ait un propriétaire, une migration et un journal de
 * migration : le contrat de module. Écrire la table ailleurs aurait demandé un
 * second chemin de migration, non éprouvé, à côté de celui qui l'est.
 *
 * **Il est du socle** (`requiredModules` de `config/features.ts`). Optionnel, il
 * laisserait toute installation par défaut exposée sur la connexion,
 * l'inscription et la réinitialisation de mot de passe — c'est-à-dire
 * exactement ce que la story existe pour fermer. La conséquence est assumée :
 * le propriétaire du boilerplate ne peut pas le couper.
 *
 * **Aucune catégorie de données.** La clé de seau est un condensat (voir
 * `schema.ts`) : aucune requête ne peut relier une de ces lignes à un compte, et
 * les lignes d'une fenêtre close sont effacées. Il n'y a donc rien à purger ni à
 * exporter — les fonctions sont là, vides, parce que le contrat les exige de
 * tous (ADR 007).
 */
/**
 * **Le balayage des fenêtres closes, déclaré comme tâche planifiée.**
 *
 * Le garde balaie déjà de manière opportuniste, ce qui suffit tant que du trafic
 * arrive ; une application au repos n'en produit pas. Cette déclaration est ce
 * que l'ordonnanceur de s33 prendra — le contrat porte `jobs` depuis le premier
 * module, précisément pour qu'une tâche n'ait pas à s'enregistrer elle-même à
 * l'import.
 *
 * `run` est **vide ici** et le dit : ce module ne construit rien: il reçoit sa
 * connexion de son point de composition (ADR 020), et c'est donc l'application
 * qui remplacera ce corps quand l'ordonnanceur existera. Une tâche qui
 * ouvrirait la base à l'import s'exécuterait pour `pnpm ks list` et
 * `pnpm db:generate`, qui n'en ont pas.
 */
const sweepClosedWindows: ModuleJob = {
  id: 'sweep-closed-windows',
  // Toutes les dix minutes : le même rythme que le balayage opportuniste du
  // garde, et la plus courte fenêtre qu'une politique livrée déclare.
  schedule: '*/10 * * * *',
  run: async () => {},
}

export const rateLimitModule = defineModule({
  id: 'rate-limit',
  requires: [],
  schema: rateLimitSchema,
  migrations: 'packages/modules/rate-limit/migrations',
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
  jobs: [sweepClosedWindows],
  dataCategories: [],
  retention: {},
  purge: async () => {},
  export: async () => ({}),
})
