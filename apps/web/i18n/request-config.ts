import type { RequestConfig } from 'next-intl/server'

import { messagesFor } from '../lib/messages'

/**
 * La configuration d'internationalisation d'une requête, **sans le contexte de
 * requête**.
 *
 * Séparée de `request.ts` pour une raison de preuve : la règle « une clé
 * manquante n'est jamais remplacée par elle-même » est un comportement, et un
 * comportement s'éprouve en l'exécutant. Tant qu'elle vivait dans la fermeture
 * passée à `getRequestConfig`, aucun test ne pouvait l'atteindre, et la garde
 * s'était rabattue sur une expression régulière lisant le fichier — que la
 * revue de s09 a neutralisée deux fois sans la faire rougir.
 *
 * Le type de retour est **annoté**, et voici exactement ce que cela garantit :
 * qu'à l'intérieur de cette fonction, les deux gestionnaires portent les noms
 * que `next-intl` lit — un nom mal orthographié est refusé comme propriété
 * excédentaire. Cela ne garantit **rien** sur le fait que `request.ts` appelle
 * cette fonction : la revue de s09 a ramené ce fichier au repli silencieux et
 * les six commandes sont restées vertes.
 *
 * Le câblage est donc prouvé là où il existe, c'est-à-dire dans le serveur :
 * `apps/web/app/api/i18n-probe/route.ts` demande une clé qu'aucun catalogue ne
 * livre, et `e2e/i18n.spec.ts` exige que la requête échoue. Débranché, il rend
 * 200 avec le chemin de la clé, et ce parcours rougit.
 *
 * Deux refus, et ce sont des critères :
 *
 * - `onError` **lève** au lieu de journaliser. Une clé manquante est un défaut
 *   du code, pas un aléa d'exécution. C'est aussi le seul gestionnaire appelé
 *   sur les erreurs qui n'ont pas de repli de message ;
 * - `getMessageFallback` **lève** aussi. C'est le repli que le critère
 *   interdit : `next-intl` rendrait sinon le chemin de la clé, si bien qu'un
 *   écran afficherait « app.account.title » sans que rien ne rougisse.
 *   `onError` levant en premier, ce second verrou n'est pas atteint en
 *   production — il tient le jour où le premier serait desserré.
 */
export function requestConfigFor(locale: string): RequestConfig {
  return {
    locale,
    messages: messagesFor(locale),
    onError: (error) => {
      throw error
    },
    getMessageFallback: ({ key, namespace }) => {
      throw new Error(
        `Traduction manquante : « ${[namespace, key].filter(Boolean).join('.')} ». ` +
          'Toute chaîne affichée vient des catalogues ; aucune ne se replie sur sa clé.',
      )
    },
  }
}
