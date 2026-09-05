import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  InvalidDocsPageError,
  parseDocsPage,
  parseDocsSection,
  type DocsPage,
  type DocsSection,
} from '../domain/docs-page'

/**
 * La lecture du dossier de documentation — la seule porte du module vers le
 * disque.
 *
 * Elle est ici et pas dans `application/` parce que c'est de l'infrastructure :
 * un accès à une ressource extérieure, exactement comme un repository Drizzle.
 * Les règles qu'elle applique, elles, vivent dans `domain/`.
 *
 * **Elle ne compile aucun MDX.** Le corps des pages est compilé par le bundler
 * de Next (ADR 053) ; ce fichier n'en lit que l'en-tête et les titres, parce que
 * la navigation doit exister sans charger le corps de chaque page.
 */
export interface ReadDocsDirectoryInput {
  /** Le dossier racine du contenu : il contient un sous-dossier par locale. */
  readonly directory: string
  /**
   * Les locales **servies**, dans l'ordre où elles doivent apparaître.
   *
   * Elles viennent de `localeRouting` : module `i18n` coupé, il n'y en a qu'une,
   * et les pages des autres langues restent sur le disque sans être servies.
   */
  readonly locales: readonly string[]
  /**
   * Les locales **de l'application** (`config/i18n.ts`).
   *
   * Elles ne servent qu'à une chose, et c'est le piège que le commentaire de
   * `config/i18n.ts` documente : distinguer un dossier légitimement non servi
   * (`en` quand `i18n` est coupé) d'un dossier que **personne** ne servira
   * jamais (`de`). Le premier est ignoré, le second est refusé en le nommant.
   */
  readonly knownLocales: readonly string[]
}

const PAGE_EXTENSION = '.mdx'

/** Le manifeste d'une section : son titre et son rang, dans la langue du dossier. */
const SECTION_MANIFEST = 'section.json'

/** Un slug de section ou de page : ce qui peut devenir un segment d'URL sans être encodé. */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

const entriesOf = (directory: string): readonly import('node:fs').Dirent[] => {
  try {
    return readdirSync(directory, { withFileTypes: true })
  } catch {
    // Un dossier absent n'est pas une panne : c'est une langue, ou un dépôt, où
    // personne n'a encore écrit.
    return []
  }
}

export interface DocsDirectoryContent {
  readonly pages: readonly DocsPage[]
  readonly sections: readonly DocsSection[]
}

export function readDocsDirectory({
  directory,
  locales,
  knownLocales,
}: ReadDocsDirectoryInput): DocsDirectoryContent {
  for (const entry of entriesOf(directory)) {
    if (entry.isDirectory() && !knownLocales.includes(entry.name)) {
      throw new InvalidDocsPageError(
        `Dossier de documentation refusé — ${join(directory, entry.name)} : « ${entry.name} » ` +
          `n’est pas une locale de l’application (${knownLocales.join(', ')}). Les pages qu’il ` +
          'contient ne seraient jamais servies.',
      )
    }
  }

  const pages: DocsPage[] = []
  const sections: DocsSection[] = []

  for (const locale of locales) {
    const localeDirectory = join(directory, locale)

    for (const entry of entriesOf(localeDirectory)) {
      if (!entry.isDirectory()) {
        // Une page posée à la racine d'une langue n'appartient à aucune section :
        // elle n'aurait ni place dans la navigation, ni fil d'Ariane, et son URL
        // ne se distinguerait pas de celle d'une section.
        if (entry.name.endsWith(PAGE_EXTENSION)) {
          throw new InvalidDocsPageError(
            `Documentation refusée — ${join(localeDirectory, entry.name)} : une page vit dans un ` +
              'dossier de section, jamais à la racine d’une langue.',
          )
        }

        continue
      }

      if (!SLUG.test(entry.name)) {
        throw new InvalidDocsPageError(
          `Documentation refusée — ${join(localeDirectory, entry.name)} : le nom du dossier porte ` +
            'le chemin de la section, il doit donc être en kebab-case (minuscules, chiffres, ' +
            'tirets simples).',
        )
      }

      readSection({ localeDirectory, section: entry.name, locale, pages, sections })
    }
  }

  return { pages, sections }
}

const readSection = ({
  localeDirectory,
  section,
  locale,
  pages,
  sections,
}: {
  readonly localeDirectory: string
  readonly section: string
  readonly locale: string
  readonly pages: DocsPage[]
  readonly sections: DocsSection[]
}): void => {
  const sectionDirectory = join(localeDirectory, section)

  for (const entry of entriesOf(sectionDirectory)) {
    if (!entry.isFile()) {
      continue
    }

    const filePath = join(sectionDirectory, entry.name)

    if (entry.name === SECTION_MANIFEST) {
      sections.push(
        parseDocsSection({ source: readFileSync(filePath, 'utf8'), filePath, section, locale }),
      )

      continue
    }

    if (!entry.name.endsWith(PAGE_EXTENSION)) {
      continue
    }

    const slug = entry.name.slice(0, -PAGE_EXTENSION.length)

    if (!SLUG.test(slug)) {
      throw new InvalidDocsPageError(
        `Documentation refusée — ${filePath} : le nom du fichier porte le chemin de la page, il ` +
          'doit donc être en kebab-case (minuscules, chiffres, tirets simples).',
      )
    }

    pages.push(
      parseDocsPage({ source: readFileSync(filePath, 'utf8'), filePath, section, slug, locale }),
    )
  }
}
