import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  EMPTY_DOCS_CATALOG,
  docsModule,
  provideDocsContent,
  docsSearchIndex,
  readDocsDirectory,
  resolveDocsCatalog,
  type DocsCatalog,
  type DocsSearchEntry,
} from '@repo/module-docs'

import { appLocales, defaultLocale } from '../../../config/i18n'
import { localeRouting } from './locale-routing'
import { moduleRegistry } from './module-registry'

/**
 * Le point de composition de la documentation — le même modèle que
 * `lib/blog.ts` (quel catalogue d'articles) et `lib/marketing.ts` (quel site
 * public).
 *
 * C'est **le seul fichier de l'application** qui connaisse `@repo/module-docs`,
 * et le seul qui regarde si ce module est monté. Ailleurs — les deux écrans —
 * on lit `docsCatalog`, dont la **forme est la même dans les deux états** :
 * `index` vaut `null` quand le module est coupé, et les écrans répondent alors
 * 404. Aucune ligne d'écran ne nomme un module.
 *
 * | | module activé | module coupé |
 * |---|---|---|
 * | `/docs` | la première page, par redirection | 404 |
 * | `/docs/<section>/<page>` | la page, servie dans la langue par défaut si elle n'est pas traduite | 404 |
 * | entrée de navigation | « Documentation » | absente, avec le module |
 * | `sitemap.xml` | une entrée par page | aucune |
 */

/**
 * Le dossier de documentation, résolu depuis le répertoire d'appel.
 *
 * **Deux répertoires d'appel existent, et c'est mesuré** (s29) : Next travaille
 * dans `apps/web` (`next dev`, `next build`, et `.next/standalone/apps/web`
 * pour la sortie autonome), Vitest à la racine du dépôt. Une seule des deux
 * formes suffirait à l'un et laisserait l'autre lire un dossier vide —
 * c'est-à-dire une documentation silencieusement sans page, ce qu'aucune
 * commande ne signalerait.
 */
const CONTENT_CANDIDATES = ['content/docs', '../../content/docs'] as const

const contentDirectory = (): string => {
  const candidates = CONTENT_CANDIDATES.map((candidate) => resolve(process.cwd(), candidate))
  const found = candidates.find((candidate) => existsSync(candidate))

  if (found === undefined) {
    throw new Error(
      `Dossier de documentation introuvable depuis ${process.cwd()} : aucun de ${candidates.join(', ')} n’existe.`,
    )
  }

  return found
}

/**
 * Le catalogue lu **une fois**, au chargement du module.
 *
 * C'est aussi ce qui fait échouer `pnpm build` sur un frontmatter invalide, un
 * manifeste de section manquant ou une page écrite dans une seule traduction :
 * les trois lèvent ici, en nommant le fautif. Une lecture paresseuse ne ferait
 * échouer que la première requête, en production.
 */
export const docsCatalog: DocsCatalog = moduleRegistry.moduleIds.includes(docsModule.id)
  ? resolveDocsCatalog({
      ...readDocsDirectory({
        directory: contentDirectory(),
        // Les locales **servies** : une seule quand le module `i18n` est coupé,
        // et l'application sert alors tout dans la langue par défaut.
        locales: localeRouting.locales,
        // Les locales **de l'application**, qui ne servent qu'à refuser un
        // dossier que personne ne servira jamais (`config/i18n.ts:5-7`).
        knownLocales: [...appLocales],
      }),
      // La langue de l'arbre **canonique** : celle sur laquelle une page non
      // traduite retombe. C'est `config/i18n.ts` qui la fixe, pas le routage —
      // module `i18n` coupé, les deux coïncident de toute façon.
      defaultLocale,
    })
  : EMPTY_DOCS_CATALOG

/**
 * L'index de recherche, **une fois par langue servie, au chargement du module**.
 *
 * C'est ce que « construit au build et servi statiquement » veut dire ici : la
 * même lecture qui fait échouer `pnpm build` sur un frontmatter invalide
 * construit l'index, et c'est aussi ici que son **plafond de taille** refuse.
 * Construit à la requête, il serait recalculé pour chaque visiteur ; servi par
 * une route, il tomberait sous la limitation de débit d'une route publique
 * (ADR 050), ce qui est absurde pour une frappe au clavier.
 *
 * Module coupé, le catalogue est vide : chaque langue rend un index vide, et
 * l'écran n'affiche aucune palette.
 */
export const docsSearchIndexes: Readonly<Record<string, readonly DocsSearchEntry[]>> =
  Object.fromEntries(
    localeRouting.locales.map((locale) => [locale, docsSearchIndex(docsCatalog, locale)]),
  )

/**
 * L'index de la langue servie, ou celui de la langue par défaut.
 *
 * Le repli n'invente rien : `localeRouting.locales` porte exactement les langues
 * servies, et une locale hors de cette liste n'atteint pas cet écran.
 */
export const docsSearchIndexFor = (locale: string): readonly DocsSearchEntry[] =>
  docsSearchIndexes[locale] ?? []

/**
 * Donne au module son catalogue.
 *
 * C'est **ici** que le module est nommé — le rôle de ce fichier —, si bien que
 * le plan de site et le `robots.txt` n'ont personne à connaître.
 *
 * Idempotente : chaque appel remplace la fabrique précédente par la même.
 */
export function prepareDocsContent(): void {
  provideDocsContent(() => ({ catalog: docsCatalog }))
}
