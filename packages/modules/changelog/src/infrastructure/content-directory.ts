import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  InvalidChangelogEntryError,
  parseChangelogEntry,
  type ChangelogEntry,
} from '../domain/changelog-entry'

/**
 * La lecture du dossier des entrées — la seule porte du module vers le disque.
 *
 * Elle est ici et pas dans `application/` parce que c'est de l'infrastructure :
 * un accès à une ressource extérieure, exactement comme un repository Drizzle.
 * La règle qu'elle applique, elle, vit dans `domain/`.
 *
 * **Elle ne compile aucun MDX.** Le corps des entrées est compilé par le
 * bundler de Next (ADR 053) ; ce fichier ne lit que l'en-tête.
 *
 * C'est le troisième balayage de contenu par locale du dépôt, après ceux du
 * blog (s29) et de la documentation (s30). Il n'est **pas** partagé, et c'est
 * un choix : les trois refusent des choses différentes (un slug d'article, une
 * arborescence de sections, une version), et le peu qui leur est commun — lire
 * un dossier par locale — ne vaut pas une abstraction qui devrait porter les
 * trois. Ce qui **est** partagé est le constructeur de flux (ADR 065), parce
 * que celui-là est identique au caractère près.
 */
export interface ReadChangelogDirectoryInput {
  /** Le dossier racine du contenu : il contient un sous-dossier par locale. */
  readonly directory: string
  /**
   * Les locales **servies**, dans l'ordre où elles doivent apparaître.
   *
   * Elles viennent de `localeRouting` : module `i18n` coupé, il n'y en a qu'une,
   * et les entrées des autres langues restent sur le disque sans être servies.
   */
  readonly locales: readonly string[]
  /**
   * Les locales **de l'application** (`config/i18n.ts`).
   *
   * Elles distinguent un dossier légitimement non servi (`en` quand `i18n` est
   * coupé) d'un dossier que **personne** ne servira jamais (`de`). Le premier
   * est ignoré, le second est refusé en le nommant — sans quoi un auteur
   * écrirait dans un dossier que rien n'affiche.
   */
  readonly knownLocales: readonly string[]
}

const ENTRY_EXTENSION = '.mdx'

/** Un slug d'entrée : ce qui peut devenir un identifiant d'ancre sans être encodé. */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

const entriesOf = (directory: string): readonly import('node:fs').Dirent[] => {
  try {
    return readdirSync(directory, { withFileTypes: true })
  } catch {
    // Un dossier absent n'est pas une panne : c'est une langue, ou un dépôt, où
    // personne n'a encore publié de nouveauté.
    return []
  }
}

export function readChangelogDirectory({
  directory,
  locales,
  knownLocales,
}: ReadChangelogDirectoryInput): readonly ChangelogEntry[] {
  for (const entry of entriesOf(directory)) {
    if (entry.isDirectory() && !knownLocales.includes(entry.name)) {
      throw new InvalidChangelogEntryError(
        `Dossier de nouveautés refusé — ${join(directory, entry.name)} : « ${entry.name} » n’est ` +
          `pas une locale de l’application (${knownLocales.join(', ')}). Les entrées qu’il ` +
          'contient ne seraient jamais servies.',
      )
    }
  }

  const found: ChangelogEntry[] = []

  for (const locale of locales) {
    const localeDirectory = join(directory, locale)

    for (const entry of entriesOf(localeDirectory)) {
      if (!entry.isFile() || !entry.name.endsWith(ENTRY_EXTENSION)) {
        continue
      }

      const filePath = join(localeDirectory, entry.name)
      const slug = entry.name.slice(0, -ENTRY_EXTENSION.length)

      if (!SLUG.test(slug)) {
        throw new InvalidChangelogEntryError(
          `Entrée de changelog refusée — ${filePath} : le nom du fichier porte l’identifiant de ` +
            'l’entrée, il doit donc être en kebab-case (minuscules, chiffres, tirets simples).',
        )
      }

      found.push(
        parseChangelogEntry({ source: readFileSync(filePath, 'utf8'), filePath, slug, locale }),
      )
    }
  }

  // **Aucun tri ici**, à la différence du blog : l'ordre du changelog est celui
  // des versions, et il est calculé par `changelogReleases` (domaine). Trier
  // par date ici donnerait un second ordre, qui divergerait du premier au jour
  // où une correction d'une vieille version est publiée après une nouvelle.
  return found
}
