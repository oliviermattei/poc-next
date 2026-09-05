import { carriesLocalePrefix, indexableUrls, type IndexableUrl } from '@repo/core'

import { localeRouting } from './locale-routing'
import { prepareModuleContent } from './module-content'
import { moduleRegistry } from './module-registry'

/**
 * **Ce que l'application donne à indexer** — le point de composition de la
 * syndication (s53, ADR 054).
 *
 * `app/sitemap.ts` et `app/robots.ts` lisent ce fichier et rien d'autre : ils
 * ne nomment aucun module, et un module de contenu ajouté demain y entre par sa
 * déclaration, pas par une ligne dans les deux fichiers de métadonnées. C'est le
 * critère 4 de la story, et un `grep '@repo/module-'` sur ces deux fichiers doit
 * revenir vide.
 *
 * La liste est **rendue à l'appel**, jamais figée à l'import : les deux fichiers
 * portent `force-dynamic` parce qu'ils sont évalués pendant `next build`, où
 * `APP_URL` n'est pas validée et où le catalogue d'articles n'a pas à être gelé.
 */
export function publicUrls(): readonly IndexableUrl[] {
  // Les modules ne peuvent pas connaître les données que l'application détient
  // (chemins validés, articles lus sur le disque) : elle les leur remet ici.
  prepareModuleContent()

  return indexableUrls(moduleRegistry, {
    // Les langues **servies**, jamais celles que le projet déclare : module
    // `i18n` coupé, l'application n'en sert qu'une, et annoncer les autres
    // publierait des URL qui redirigent.
    locales: localeRouting.locales,
    defaultLocale: localeRouting.defaultLocale,
  })
}

/**
 * Le chemin public d'une URL indexable, dans une langue.
 *
 * `carriesLocalePrefix` avant `publicPath`, et ce n'est pas une précaution :
 * `publicPath` préfixe **sans condition**, `/api…` compris, alors que
 * `apps/web/proxy.ts` ne préfixe jamais ces chemins (constat M3 de la revue de
 * s29). Un module qui contribuerait l'URL d'une route montée produirait sinon
 * `/fr/api/…` — une URL que rien ne sert, annoncée au plan de site et autorisée
 * dans le `robots.txt` pour rien.
 */
export const servedPath = (pathname: string, locale: string): string =>
  carriesLocalePrefix(pathname) ? localeRouting.publicPath(pathname, locale) : pathname
