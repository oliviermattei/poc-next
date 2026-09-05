import type { ModuleJob } from '@repo/core'

import {
  ACCOUNT_PURGE_JOB,
  ACCOUNT_PURGE_JOB_FIELD,
  ACCOUNT_PURGE_JOB_LOCALE,
} from '../domain/account-deletion'
import type { AuthService } from './auth-service'

/**
 * **La tâche qui efface un compte** (s34, critère 9).
 *
 * Elle est déclarée au contrat, comme toute tâche de ce dépôt : c'est la clé
 * `jobs` qui décide qu'un traitement existe, jamais un enregistrement à
 * l'import (ADR 059). Le répartiteur du socle la retrouve par son identifiant
 * qualifié — `auth.purge-account` — que le module `jobs` soit activé ou non ;
 * coupé, le port l'exécute dans la requête appelante, et l'appelant ne voit pas
 * la différence.
 *
 * **L'accès au service est différé**, comme pour les routes : `module.ts` est
 * chargé par `config/features.ts`, donc par `pnpm ks list` et `pnpm
 * db:generate`, qui n'ont ni base ni mailer.
 *
 * **Ce que `schedule` vaut ici, et pourquoi il faut le lire.** Le contrat rend
 * `schedule` obligatoire (s33) : une tâche **à la demande** n'a donc pas de
 * forme propre, et l'adaptateur Inngest arme les deux déclencheurs de chaque
 * tâche — l'événement *et* l'échéance cron. Cette tâche-ci est donc appelée
 * périodiquement **sans charge utile**, et c'est le seul cas qu'elle traite
 * sans rien faire : aucune charge utile ne nomme de compte, il n'y a donc aucun
 * compte à effacer. Le sens fermé, écrit plutôt que subi — l'alternative aurait
 * été d'effacer quelque chose faute de savoir quoi.
 */
export function createAccountPurgeJob(service: () => AuthService): ModuleJob {
  return {
    id: ACCOUNT_PURGE_JOB,
    // Une fois par jour, à une heure creuse : l'échéance ne sert à rien ici
    // (voir ci-dessus), elle borne seulement le coût du déclencheur que le
    // contrat impose.
    schedule: '17 4 * * *',
    run: async ({ data }) => {
      const userId = data[ACCOUNT_PURGE_JOB_FIELD]

      if (userId === undefined || userId.trim() === '') {
        return
      }

      await service().useCases.runAccountPurge({
        userId,
        // Absente — une échéance cron ne porte aucune charge utile —, la règle
        // du module rend la langue du site.
        knownLocale: data[ACCOUNT_PURGE_JOB_LOCALE] ?? null,
      })
    },
  }
}
