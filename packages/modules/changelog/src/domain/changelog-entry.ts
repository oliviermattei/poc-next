import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

/**
 * Une entrée de changelog, telle que le reste du module la manipule.
 *
 * `slug` et `locale` ne viennent **pas** du frontmatter : ils viennent de
 * l'emplacement du fichier (`content/changelog/<locale>/<slug>.mdx`), pour les
 * deux raisons que s29 a écrites pour les articles — une entrée non traduite
 * est alors un **fichier absent**, et les locales balayées sont celles de
 * **l'application**, transmises par le point de composition.
 *
 * Un troisième point est propre au changelog : la **version** appartient au
 * frontmatter, pas au chemin. Deux entrées de la même version se rejoignent par
 * ce champ, y compris quand elles sont écrites des semaines après.
 */
export interface ChangelogEntry {
  readonly slug: string
  readonly locale: string
  /** La version du produit, en segments numériques : `1`, `1.2`, `1.2.3`. */
  readonly version: string
  /** Date de publication, `AAAA-MM-JJ`. Comparée telle quelle : ce format se trie. */
  readonly date: string
  readonly category: ChangelogCategory
  readonly title: string
  readonly description: string
}

/**
 * Les catégories, **fermées**.
 *
 * La recherche laissait la question ouverte — énumération ou chaîne libre. Une
 * chaîne libre rendrait le regroupement instable (« Ajout », « Ajouts »,
 * « ajout » seraient trois catégories) et interdirait de traduire le libellé,
 * qui deviendrait le texte du frontmatter, donc du texte non traduit à l'écran.
 * Ces quatre-là sont celles de *Keep a Changelog* que le boilerplate emploie ;
 * en ajouter une est une ligne ici **et** une clé dans chaque catalogue. La
 * commande qui échoue est `pnpm test`, sur `tests/changelog.test.ts` (« le
 * catalogue de traductions du module »), qui consomme `changelogMessageKeys()`.
 * **Pas `tests/i18n.test.ts`** : son balayage est statique et ne voit pas une
 * clé composée — la revue de s31 a mesuré qu'une cinquième catégorie sans
 * traduction y laissait 102 cas verts.
 */
export const CHANGELOG_CATEGORIES = ['added', 'changed', 'fixed', 'removed'] as const

export type ChangelogCategory = (typeof CHANGELOG_CATEGORIES)[number]

/**
 * Le refus d'une entrée, **nommant le fichier**.
 *
 * Ce n'est pas décoratif : le frontmatter est lu à l'amorçage, donc pendant
 * `pnpm build` (critère 1 de la story). Un message qui dirait seulement « champ
 * requis » obligerait l'auteur à ouvrir les entrées une par une.
 */
export class InvalidChangelogEntryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidChangelogEntryError'
  }
}

/**
 * Une date de calendrier réelle, en `AAAA-MM-JJ`.
 *
 * Le format seul ne suffit pas : `2026-02-30` le respecte et n'existe pas.
 * L'aller-retour par `Date` est ce qui départage les deux.
 */
const isoDate = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }

  const parsed = new Date(`${value}T00:00:00Z`)

  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}, 'attendu : une date de calendrier réelle au format AAAA-MM-JJ')

/**
 * Une version : des segments numériques séparés par des points.
 *
 * Quatre au plus, ce qui couvre `major.minor.patch.build`. Le format est
 * contraint ici parce que c'est lui qui rend la comparaison numérique possible :
 * `compareVersions` ne saurait pas ordonner `1.2-beta` face à `1.2`, et le
 * laisser entrer produirait un ordre arbitraire à l'écran.
 */
const version = z
  .string()
  .regex(/^\d+(\.\d+){0,3}$/, 'attendu : des segments numériques séparés par des points (1.2.3)')

/**
 * Le frontmatter, au complet et **fermé**.
 *
 * `strict()` refuse une clé inconnue, et c'est le cas qui compte le plus : une
 * faute de frappe (`titre:` pour `title:`) sur un schéma ouvert produirait une
 * entrée dont le titre manque, sans que rien ne le dise.
 */
const frontmatterSchema = z
  .object({
    version,
    date: isoDate,
    category: z.enum(CHANGELOG_CATEGORIES),
    title: z.string().min(1),
    description: z.string().min(1),
  })
  .strict()

/** Le type que le frontmatter déclare — dérivé du schéma, jamais recopié. */
export type ChangelogFrontmatter = z.infer<typeof frontmatterSchema>

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/

const refuse = (filePath: string, reason: string): never => {
  throw new InvalidChangelogEntryError(`Entrée de changelog refusée — ${filePath} : ${reason}`)
}

export interface ParseChangelogEntryInput {
  /** Le contenu brut du fichier `.mdx`, frontmatter compris. */
  readonly source: string
  /** Le chemin du fichier, tel qu'il sera **nommé** dans le refus. */
  readonly filePath: string
  readonly slug: string
  readonly locale: string
}

/**
 * Valide le frontmatter d'une entrée et rend l'entrée.
 *
 * Pure : elle ne lit aucun fichier, ne connaît ni Next, ni MDX. Le corps de
 * l'entrée ne la traverse jamais — il est compilé par le bundler (ADR 053), et
 * cette fonction n'en voit que la présence.
 */
export function parseChangelogEntry({
  source,
  filePath,
  slug,
  locale,
}: ParseChangelogEntryInput): ChangelogEntry {
  const matched = FRONTMATTER.exec(source)

  if (matched === null) {
    return refuse(filePath, 'aucun bloc de frontmatter « --- » en tête du fichier')
  }

  let raw: unknown

  try {
    raw = parseYaml(matched[1] ?? '')
  } catch (error) {
    return refuse(filePath, `frontmatter YAML illisible : ${(error as Error).message}`)
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return refuse(filePath, 'le frontmatter doit être un ensemble de clés')
  }

  const parsed = frontmatterSchema.safeParse(raw)

  if (!parsed.success) {
    return refuse(
      filePath,
      parsed.error.issues
        .map((issue) => `« ${issue.path.join('.') || '(racine)'} » ${issue.message}`)
        .join(' ; '),
    )
  }

  return { slug, locale, ...parsed.data }
}

/**
 * L'ordre des versions, **numérique et non lexicographique**.
 *
 * C'est le seul piège algorithmique de la story, et la story le nomme :
 * `'10.0' < '9.0'` en comparaison de chaînes, parce que `'1' < '9'`. Un
 * `Array.sort()` nu passerait toutes les fixtures d'un produit qui n'a pas
 * encore atteint sa dixième version, et casserait le jour où il l'atteint —
 * c'est-à-dire au moment où plus personne ne regarde.
 *
 * Un segment absent vaut zéro : `2` et `2.0` sont la même version, et les
 * écrire différemment dans deux entrées ne doit pas produire deux groupes.
 */
export function compareVersions(left: string, right: string): number {
  const segments = (value: string): readonly number[] => value.split('.').map(Number)
  const a = segments(left)
  const b = segments(right)

  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)

    if (difference !== 0) {
      return difference
    }
  }

  return 0
}

/**
 * Une version du produit, avec ce qu'elle a apporté.
 *
 * `date` est celle de la **dernière** entrée de la version : c'est le jour où
 * cette version a fini de bouger, et c'est ce qu'un lecteur lit comme sa date
 * de publication.
 */
export interface ChangelogRelease {
  readonly version: string
  readonly date: string
  readonly entries: readonly ChangelogEntry[]
}

/**
 * Les entrées, **groupées par version et de la plus récente à la plus ancienne**
 * (critère 2 de la story).
 *
 * Elle reçoit des entrées **déjà filtrées par langue** : le regroupement se fait
 * donc par locale, et c'est la réponse à la question ouverte de la recherche —
 * une version traduite dans une seule langue n'apparaît que dans celle-là.
 * L'alternative, fusionner les langues puis filtrer, produirait un groupe de
 * version vide dans l'autre langue.
 *
 * L'ordre des groupes est celui de `compareVersions`, **jamais celui des
 * dates** : deux versions publiées le même jour ont un ordre malgré tout, et
 * c'est le numéro qui le donne.
 */
export function changelogReleases(
  entries: readonly ChangelogEntry[],
): readonly ChangelogRelease[] {
  const byVersion = new Map<string, ChangelogEntry[]>()

  for (const entry of entries) {
    // La clé est la version **normalisée** : `2` et `2.0` sont la même version,
    // et deux groupes pour elle seraient deux titres identiques à l'écran.
    const key = entry.version.split('.').map(Number).join('.')
    const group = byVersion.get(key)

    if (group === undefined) {
      byVersion.set(key, [entry])

      continue
    }

    group.push(entry)
  }

  return [...byVersion.values()]
    .map((group) => {
      const sorted = [...group].sort(
        (left, right) =>
          right.date.localeCompare(left.date) || left.slug.localeCompare(right.slug),
      )

      return {
        version: sorted[0]?.version ?? '',
        date: sorted[0]?.date ?? '',
        entries: sorted,
      }
    })
    .sort((left, right) => compareVersions(right.version, left.version))
}

/**
 * La date d'une version, dans la langue de la version.
 *
 * Elle est formatée ici, et pas par l'appelant : la locale de l'entrée est une
 * propriété de l'entrée, pas de la requête.
 *
 * `timeZone: 'UTC'` : la date est un jour de calendrier, pas un instant. Sans
 * elle, un serveur à l'ouest de Greenwich rendrait la veille.
 */
export function formatChangelogDate(locale: string, date: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  )
}
