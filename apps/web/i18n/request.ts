import { getRequestConfig } from 'next-intl/server'

import { currentLocale } from '../lib/current-locale'
import { requestConfigFor } from './request-config'

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
 * Ce fichier ne fait plus que deux choses : lire la locale de la requête, et
 * demander la configuration. Le refus d'une clé manquante vit dans
 * `request-config.ts`, où un test l'exécute au lieu de le lire.
 */
export default getRequestConfig(async () => requestConfigFor(await currentLocale()))
