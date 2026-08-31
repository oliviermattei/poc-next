import { getRequestConfig } from 'next-intl/server'

import { currentLocale } from '../lib/current-locale'
import { messagesFor } from '../lib/messages'

/**
 * La configuration de requête de `next-intl`.
 *
 * **Aucun segment `[locale]` dans l'arborescence**, et c'est le point qui
 * décide de la story. Mesuré dans le paquet installé (4.14.1) : seul
 * `next-intl/middleware` impose ce segment — il réécrit chaque requête vers
 * `/<locale><chemin>` (`getLocaleAsPrefix`). Le reste de la bibliothèque est
 * agnostique du routage : `getRequestConfig` rend la locale qu'il veut, et
 * `requestLocale` n'est même pas lu ici. L'arborescence des routes est donc
 * intacte, `/api/modules/…` compris, et les **mêmes URL** répondent que le
 * module `i18n` soit activé ou non.
 *
 * Deux refus, et ce sont des critères :
 *
 * - `onError` **lève** au lieu de journaliser. Une clé manquante est un défaut
 *   du code, pas un aléa d'exécution ;
 * - `getMessageFallback` **lève** aussi. C'est le repli que le critère
 *   interdit : `next-intl` rendrait sinon le chemin de la clé, si bien qu'un
 *   écran afficherait « app.account.title » sans que rien ne rougisse. Le
 *   silence est exactement ce qu'on ne veut pas.
 */
export default getRequestConfig(async () => {
  const locale = await currentLocale()

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
})
