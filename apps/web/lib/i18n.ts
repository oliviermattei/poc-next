import type { Locale } from '@repo/core'
import { getTranslations } from 'next-intl/server'

import { currentLocale } from './current-locale'
import { localeRouting } from './locale-routing'

/**
 * Ce qu'un écran serveur demande pour s'afficher : sa langue, ses textes, et
 * la forme de ses liens.
 *
 * Les trois ensemble, en un seul appel, parce que les trois viennent de la même
 * décision : un écran qui résoudrait la locale deux fois pourrait afficher un
 * texte français dans un lien anglais.
 *
 * **La signature ne change pas d'un état à l'autre.** Module `i18n` coupé,
 * `path` est l'identité et `locale` est celle du site ; l'écran ne le sait pas,
 * et c'est ce qui rend le même scénario de test valide dans les deux
 * configurations.
 */
export interface AppIntl {
  readonly locale: Locale
  /** Le traducteur de `next-intl`, sur le catalogue complet (clés qualifiées). */
  readonly t: Awaited<ReturnType<typeof getTranslations>>
  /** L'URL publique d'un chemin interne, dans la langue de la requête. */
  readonly path: (pathname: string) => string
}

export async function appIntl(): Promise<AppIntl> {
  const [locale, t] = await Promise.all([currentLocale(), getTranslations()])

  return {
    locale,
    t,
    path: (pathname) => localeRouting.publicPath(pathname, locale),
  }
}
