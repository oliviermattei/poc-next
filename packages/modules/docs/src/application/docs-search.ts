import { docsNavigationTree, docsPageView, type DocsCatalog } from './docs-catalog'

/**
 * La recherche de la documentation — **un index statique, aucune route**.
 *
 * Le critère l'impose (« construit au build et servi statiquement »), mais
 * l'argument décisif n'est pas le temps de réponse : `routeIsRateLimited`
 * (ADR 050) rend `true` pour **toute** route `public` sans qu'elle le déclare,
 * et le répartiteur est fail-closed. Une route de recherche serait donc limitée
 * à 120 requêtes par minute et par appelant — raisonnable pour un formulaire,
 * absurde pour une frappe au clavier. Un index dérivé du catalogue et interrogé
 * côté client échappe entièrement à la question, et laisse le module à
 * `routes: []`.
 */

/** Une page, telle que la palette de recherche la propose. */
export interface DocsSearchEntry {
  readonly href: string
  /** Le titre de la section, dans la langue servie quand elle le porte. */
  readonly section: string
  readonly title: string
  readonly description: string
  /** Le corps en texte simple : ce qui fait de cette recherche une recherche plein texte. */
  readonly text: string
  /**
   * `false` quand la page proposée est celle de la langue par défaut faute de
   * traduction.
   *
   * **C'est le critère 4**, et il ne se tient pas en cachant la page : s30 la
   * sert, avec sa mention. La cacher priverait le lecteur d'une page qui
   * répond ; la proposer sans rien dire la ferait passer pour traduite. Le
   * drapeau porte la troisième réponse, et la palette l'affiche.
   */
  readonly translated: boolean
}

/**
 * Le plafond de l'index, **en octets sérialisés**.
 *
 * Aucun critère de la story n'en fixe, et c'est exactement pourquoi il en faut
 * un : l'index n'est pas servi à la demande, il est **téléchargé par chaque
 * visiteur** avec la page. Sans plafond mesuré, la promesse « sans service
 * externe » se paierait en silence sur le réseau du lecteur.
 *
 * 64 Kio : de l'ordre de ce qu'une image de vignette coûte, pour une
 * documentation de plusieurs dizaines de pages. Le dépassement **refuse**
 * plutôt que de dégrader — un index tronqué rendrait une recherche qui ne
 * trouve pas, sans que rien ne le dise.
 */
export const DOCS_SEARCH_INDEX_MAX_BYTES = 65_536

/** Le refus du plafond, **avec sa mesure** : « trop gros » n'aide personne à décider. */
export class DocsSearchIndexTooLargeError extends Error {
  constructor(bytes: number, locale: string) {
    super(
      `Index de recherche refusé — langue « ${locale} » : ${bytes} octets sérialisés pour un ` +
        `plafond de ${DOCS_SEARCH_INDEX_MAX_BYTES}. Cet index part avec la page, chez chaque ` +
        'visiteur : réduisez le contenu indexé ou relevez le plafond en connaissance de cause.',
    )
    this.name = 'DocsSearchIndexTooLargeError'
  }
}

/**
 * L'index d'une langue — **une entrée par page servie**, dans l'ordre de
 * l'arbre.
 *
 * Dérivé du catalogue, jamais du disque : `resolveDocsCatalog` a déjà lu et
 * validé le contenu, et un second balayage divergerait du premier au premier
 * changement de règle.
 *
 * Le titre, la description et le corps viennent **du même fichier**, celui que
 * la page servirait : un titre traduit au-dessus d'un corps de la langue par
 * défaut serait un mensonge de plus, pas un repli.
 *
 * Module coupé, le catalogue est vide et l'index l'est aussi. La décision se lit
 * sur la donnée, jamais sur l'identifiant d'un module.
 */
export function docsSearchIndex(
  catalog: DocsCatalog,
  locale: string,
): readonly DocsSearchEntry[] {
  const entries = docsNavigationTree(catalog, locale).flatMap((section) =>
    section.pages.flatMap((entry): readonly DocsSearchEntry[] => {
      const resolved = docsPageView(catalog, {
        locale,
        section: entry.section,
        slug: entry.slug,
      })

      // L'arbre est dérivé du même catalogue : `null` n'est pas atteignable.
      // Sauter plutôt que lever garde la propriété « l'index n'invente rien ».
      return resolved === null
        ? []
        : [
            {
              href: entry.href,
              section: section.title,
              title: resolved.page.title,
              description: resolved.page.description,
              text: resolved.page.text,
              translated: resolved.translated,
            },
          ]
    }),
  )

  const bytes = new TextEncoder().encode(JSON.stringify(entries)).length

  if (bytes > DOCS_SEARCH_INDEX_MAX_BYTES) {
    throw new DocsSearchIndexTooLargeError(bytes, locale)
  }

  return entries
}

/** Sans accent ni casse : « prerequis » au clavier doit trouver « Prérequis ». */
const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

/**
 * Les mots d'une requête — **découpés sur ce qui n'est ni lettre ni chiffre**,
 * dans n'importe quel alphabet.
 *
 * Une découpe sur `[^a-z0-9]` rendait zéro jeton pour du cyrillique, du grec ou
 * du japonais, et une requête sans jeton est traitée plus bas comme une requête
 * vide : l'index **entier** revenait. « Tout correspond » est une pire réponse
 * que « rien ne correspond », et l'alphabet du lecteur ne peut pas décider du
 * sens de la réponse dans un dépôt destiné à être localisé.
 *
 * Les propriétés Unicode gardent aussi les lettres latines que `normalize` ne
 * décompose pas (`ø`, `ß`, `đ`) : elles étaient des séparateurs, elles sont
 * maintenant des lettres, et la correspondance reste un `includes` sur des
 * champs normalisés de la même façon.
 */
const tokensOf = (query: string): readonly string[] =>
  normalize(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token !== '')

/** Combien vaut un mot trouvé, selon l'endroit où il l'est. */
const FIELD_WEIGHTS = [3, 2, 1] as const

const fieldsOf = (entry: DocsSearchEntry): readonly string[] => [
  normalize(entry.title),
  normalize(`${entry.section} ${entry.description}`),
  normalize(entry.text),
]

/**
 * Les pages qui correspondent, les plus pertinentes d'abord.
 *
 * **Tous les mots, pas un seul** : un « ou » rendrait toute la documentation
 * dès que deux mots courants se croisent, et une liste qui rend tout ne
 * cherche rien.
 *
 * Le classement met le **titre** avant la description et le corps : à
 * correspondance égale, la page qui porte le mot dans son titre est celle qu'on
 * cherchait. À score égal, l'ordre de l'arbre tranche — un ordre instable
 * ferait bouger la liste entre deux frappes identiques.
 *
 * Une requête vide rend l'index (borné) plutôt que rien : c'est l'état
 * d'ouverture de la palette, et un « aucun résultat » y serait faux.
 */
export function searchDocsIndex(
  index: readonly DocsSearchEntry[],
  query: string,
  limit = 8,
): readonly DocsSearchEntry[] {
  const tokens = tokensOf(query)

  if (tokens.length === 0) {
    return index.slice(0, limit)
  }

  return index
    .flatMap((entry, rank) => {
      const fields = fieldsOf(entry)
      let score = 0

      for (const token of tokens) {
        const found = fields.findIndex((field) => field.includes(token))

        if (found === -1) {
          return []
        }

        score += FIELD_WEIGHTS[found] ?? 0
      }

      return [{ entry, score, rank }]
    })
    .sort((left, right) => right.score - left.score || left.rank - right.rank)
    .slice(0, limit)
    .map((scored) => scored.entry)
}
