import { defineModule, type ModuleJob } from '@repo/core'

import { createAccountPurgeJob } from './application/account-purge-job'
import { accountDeletedEmail } from './emails/account-deleted'
import { accountDeletionBlockedEmail } from './emails/account-deletion-blocked'
import {
  DATA_EXPORT_JOB,
  DATA_EXPORT_JOB_FIELD,
  DATA_EXPORT_SWEEP_SCHEDULE,
} from './domain/data-export'
import { dataExportReadyEmail } from './emails/data-export'
import { magicLinkEmail } from './emails/magic-link'
import { passwordResetEmail } from './emails/password-reset'
import { verificationEmail } from './emails/verification'
import { requireAuthService } from './infrastructure/auth-runtime'
import enMessages from './messages/en.json' with { type: 'json' }
import frMessages from './messages/fr.json' with { type: 'json' }
import { authNavigation, createAuthRoutes } from './presentation/auth-routes'
import { authSchema } from './schema'

/**
 * Le contrat du module `auth`, rempli.
 *
 * Le point de composition du module — le seul fichier qui connaît les quatre
 * couches — vit ici, hors des couches, comme dans tout module de ce dépôt.
 *
 * Une différence avec les modules de démonstration, et elle est structurelle :
 * les cas d'usage ne sont **pas** construits à l'import. Ce fichier est chargé
 * par `config/features.ts`, donc par `pnpm ks list` et par `pnpm db:generate`,
 * qui n'ont ni base ni mailer. Les routes reçoivent donc un **accès différé**
 * au service (`requireAuthService`), posé par le point de composition de
 * l'application (`apps/web/lib/auth.ts`). Une route appelée avant cette
 * configuration échoue en le disant, elle ne sert rien à moitié.
 */
/**
 * **La tâche d'export de données** (s35), et elle a deux emplois.
 *
 * Appelée **avec** un `requestId` — c'est ce que la demande émet —, elle
 * construit l'archive de cette demande hors du temps de réponse. Appelée
 * **sans**, c'est-à-dire par l'ordonnanceur, elle balaie : elle oublie les
 * archives échues et reprend les demandes restées en cours.
 *
 * **Restées en cours pour quelle raison ?** Pas parce que la mise en file a
 * échoué : ce cas-là est **clos** sur place (`markFailed`, réponse 503), donc
 * `listPending` ne le rend jamais — la rédaction précédente promettait une
 * reprise que le code interdit, exactement le défaut que cette story corrigeait
 * dans `apps/web/lib/jobs.ts`. Ce que le balayage reprend est une demande
 * **mise en file avec succès** et jamais exécutée : le fournisseur a perdu
 * l'événement, ou le processus est tombé entre la revendication et l'émission.
 * D'où le seuil d'âge (`DATA_EXPORT_SWEEP_MIN_AGE_SECONDS`) : en deçà, la
 * demande est probablement en cours d'exécution, et la reprendre construirait
 * l'archive deux fois.
 *
 * Le second emploi n'est pas un prétexte à remplir la clé `schedule` du
 * contrat : c'est **qui efface l'archive expirée quand un ordonnanceur
 * existe**. Il n'en est pas le seul responsable, et il ne pouvait pas l'être :
 * module `jobs` coupé, cette tâche n'est jamais appelée sans `requestId`, donc
 * cette branche ne s'exécute pas du tout. C'est pourquoi l'oubli est **aussi**
 * accroché à la demande d'export elle-même (`requestDataExport`), qui existe
 * dans toutes les configurations.
 *
 * Module `jobs` coupé, donc : la construction a lieu dans la requête (repli de
 * `apps/web/lib/jobs.ts`), les demandes perdues ne sont reprises par personne,
 * et l'oubli des archives échues se fait à la prochaine demande d'export, quel
 * qu'en soit le périmètre. Le refus d'un lien expiré, lui, ne dépend d'aucune
 * tâche — il est décidé à la lecture.
 */
const dataExportJob: ModuleJob = {
  id: DATA_EXPORT_JOB,
  // **Dérivée**, jamais recopiée : la période et le seuil d'âge du balayage
  // sortent du même nombre (`domain/data-export.ts`). Écrits séparément, la
  // justification « le seuil vaut une période d'ordonnancement » vieillissait
  // en silence.
  schedule: DATA_EXPORT_SWEEP_SCHEDULE,
  run: async ({ data }) => {
    const dataExport = requireAuthService().useCases.dataExport

    if (dataExport === null) {
      return
    }

    const requestId = data[DATA_EXPORT_JOB_FIELD]

    if (requestId === undefined || requestId === '') {
      await dataExport.sweepDataExports()

      return
    }

    await dataExport.buildDataExport({ requestId })
  },
}

export const authModule = defineModule({
  id: 'auth',
  requires: [],
  schema: authSchema,
  migrations: 'packages/modules/auth/migrations',
  routes: createAuthRoutes(requireAuthService),
  navigation: authNavigation,
  /**
   * Aucune URL publique : ce module ne publie pas de page indexable (s53).
   *
   * Déclaré vide, jamais omis — le compilateur refuse l'omission
   * (`tests/fixtures/typing/missing-public-urls.ts`).
   */
  publicUrls: () => [],
  messages: { fr: frMessages, en: enMessages },
  emails: [
    verificationEmail,
    magicLinkEmail,
    passwordResetEmail,
    accountDeletedEmail,
    accountDeletionBlockedEmail,
    dataExportReadyEmail,
  ],
  webhooks: [],
  // s34 : l'effacement d'un compte est une tâche déclarée. Elle s'exécute dans
  // la requête quand le module `jobs` est coupé — le repli livré par s33.
  //
  // Elle appelle la purge de tous les modules activés, et elle n'est **pas** la
  // seule à le faire : la suppression d'organisation l'appelle aussi
  // (`apps/web/lib/organizations.ts`), sur le chemin de sa propre requête.
  //
  // s35 : la construction d'une archive d'export est la seconde, et elle a le
  // même repli — un export est une obligation légale du socle, il ne disparaît
  // pas avec un module optionnel.
  jobs: [createAccountPurgeJob(requireAuthService), dataExportJob],
  dataCategories: ['account', 'session', 'data-export'],
  // Un compte est **effacé**, jamais anonymisé : un compte anonyme resterait
  // un moyen de connexion.
  //
  // `data-export` est la trace des demandes d'export **et l'archive qu'elles
  // portent** (s35). Effacée : une demande anonyme ne veut rien dire, et
  // l'archive est la copie complète des données du périmètre — la garder après
  // l'effacement du compte serait le trou que s34 a fermé trois fois.
  retention: { account: 'erase', session: 'erase', 'data-export': 'erase' },
  purge: (scope) => requireAuthService().useCases.purgeAccount(scope),
  export: (scope) => requireAuthService().useCases.exportAccount(scope),
})
