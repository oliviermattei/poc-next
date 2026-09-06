import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { carriesLocalePrefix } from '@repo/core'
import {
  EMPTY_CHANGELOG_CATALOG,
  changelogModule,
  provideChangelogContent,
  readChangelogDirectory,
  resolveChangelogCatalog,
  type ChangelogCatalog,
} from '@repo/module-changelog'

import { appLocales } from '../../../config/i18n'
import { localeRouting } from './locale-routing'
import { moduleRegistry } from './module-registry'
import { absoluteUrl, resolveSiteUrl } from './site-url'

/**
 * Le point de composition des nouveautés — le même modèle que `lib/blog.ts`.
 *
 * C'est **le seul fichier de l'application** qui connaisse
 * `@repo/module-changelog`, et le seul qui regarde si ce module est monté.
 * Ailleurs — l'écran — on lit `changelogCatalog`, dont la **forme est la même
 * dans les deux états** : `index` vaut `null` quand le module est coupé, et la
 * page répond alors 404. Aucune ligne d'écran ne nomme un module.
 *
 * | | module activé | module coupé |
 * |---|---|---|
 * | `/changelog` | les versions, de la plus récente à la plus ancienne | 404 |
 * | `/api/modules/changelog/feed.xml` | le flux RSS | 404, par le répartiteur |
 * | lien du pied de page | « Nouveautés » | absent, avec le module |
 *
 * Le lien du pied de page n'est **pas** ici : il est déclaré au contrat du
 * module (`surface: 'footer'`, s31) et dérivé du registre par
 * `lib/footer.ts`. C'est ce qui fait qu'un module de plus n'ouvre aucun écran.
 */

/**
 * Le dossier des entrées, résolu depuis le répertoire d'appel.
 *
 * **Deux répertoires d'appel existent, et c'est mesuré** : Next travaille dans
 * `apps/web` (`next dev`, `next build`, et `.next/standalone/apps/web` pour la
 * sortie autonome), Vitest à la racine du dépôt. Une seule des deux formes
 * suffirait à l'un et laisserait l'autre lire un dossier vide — c'est-à-dire un
 * changelog silencieusement sans entrée, ce qu'aucune commande ne signalerait.
 */
const CONTENT_CANDIDATES = ['content/changelog', '../../content/changelog'] as const

const contentDirectory = (): string => {
  const candidates = CONTENT_CANDIDATES.map((candidate) => resolve(process.cwd(), candidate))
  const found = candidates.find((candidate) => existsSync(candidate))

  if (found === undefined) {
    throw new Error(
      `Dossier des nouveautés introuvable depuis ${process.cwd()} : aucun de ${candidates.join(', ')} n’existe.`,
    )
  }

  return found
}

/**
 * Le catalogue lu **une fois**, au chargement du module.
 *
 * C'est aussi ce qui fait tenir le critère 1 : un frontmatter invalide lève ici,
 * donc pendant `pnpm build`, en nommant le fichier fautif. Une lecture
 * paresseuse ne ferait échouer que la première requête, en production.
 */
export const changelogCatalog: ChangelogCatalog = moduleRegistry.moduleIds.includes(
  changelogModule.id,
)
  ? resolveChangelogCatalog({
      entries: readChangelogDirectory({
        directory: contentDirectory(),
        // Les locales **servies** : une seule quand le module `i18n` est coupé.
        locales: localeRouting.locales,
        // Les locales **de l'application**, qui ne servent qu'à refuser un
        // dossier que personne ne servira jamais (`config/i18n.ts:5-7`).
        knownLocales: [...appLocales],
      }),
    })
  : EMPTY_CHANGELOG_CATALOG

/**
 * Donne au module son catalogue et de quoi construire une URL absolue.
 *
 * C'est **ici** que le module est nommé — le rôle de ce fichier —, si bien que
 * le flux et le plan de site n'ont personne à connaître.
 *
 * `url` est une **fonction** : elle appelle `resolveSiteUrl()` à l'invocation, et
 * `APP_URL` n'est validée qu'à l'exécution. Une URL de site capturée ici serait
 * celle du build, où l'intégration continue n'en pose aucune.
 */
export function prepareChangelogContent(): void {
  provideChangelogContent(() => ({
    catalog: changelogCatalog,
    locales: localeRouting.locales,
    defaultLocale: localeRouting.defaultLocale,
    url: (pathname, locale) =>
      absoluteUrl(
        carriesLocalePrefix(pathname) ? localeRouting.publicPath(pathname, locale) : pathname,
        resolveSiteUrl(),
      ),
  }))
}
