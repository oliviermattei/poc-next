/**
 * Le flux du blog — **RSS 2.0**, écrit ici et nulle part ailleurs (s53).
 *
 * Pure : des articles entrent, un document entre. Aucune lecture de disque,
 * aucune URL absolue construite ici — l'appelant fournit les liens, comme le
 * plan de site reçoit les siens.
 *
 * **Pourquoi RSS 2.0 et pas Atom** : c'est le format qu'un lecteur de flux, un
 * agrégateur ou une lettre d'information sait consommer sans exception, et le
 * seul que la story nomme. Un second format serait une seconde surface à tenir.
 *
 * **Pourquoi aucune bibliothèque de génération** : le document tient en une
 * douzaine de balises, et une dépendance d'exécution de plus dans un module en
 * est une de plus dans l'image de production. Le prix de ce choix est
 * l'échappement, qui est la seule chose qu'un générateur ferait mieux — il est
 * donc mesuré : `tests/blog.test.ts` passe le flux **servi** à un analyseur de
 * flux tiers (`@rowanmanning/feed-parser`), avec un article dont le titre porte
 * `&`, `<` et des guillemets.
 *
 * **Ce que cette mesure prouve, et ce qu'elle ne prouve pas.** L'analyseur se
 * décrit lui-même comme *resilient* : il **lève** sur un document qui n'est pas
 * un flux, et il **accepte** un `<channel>` sans titre, sans lien et sans
 * description. Il établit donc « analysable comme flux », pas « valide au sens
 * d'un validateur » — le dépôt n'embarque aucun validateur, et cette limite est
 * elle-même un cas de `tests/blog.test.ts` pour qu'aucune relecture ne la
 * regonfle. La conformité au format, elle, se vérifie en lisant la
 * spécification : c'est ce qui a fait choisir `dc:creator` ci-dessous.
 */

export interface FeedArticle {
  readonly title: string
  readonly description: string
  /** L'URL absolue de l'article, dans la langue du flux. */
  readonly url: string
  /** Date de publication, `AAAA-MM-JJ`. */
  readonly date: string
  readonly author: string
}

export interface BlogFeedInput {
  readonly title: string
  readonly description: string
  readonly locale: string
  /** L'URL absolue de la liste, dans la langue du flux. */
  readonly siteUrl: string
  /** L'URL absolue du flux lui-même : RSS demande qu'il se désigne (`atom:link`). */
  readonly feedUrl: string
  readonly articles: readonly FeedArticle[]
}

/**
 * L'échappement XML, appliqué à **toute** valeur du document.
 *
 * Les cinq entités prédéfinies de XML 1.0 §4.6. Un titre d'article est du texte
 * libre écrit dans un fichier `.mdx` : un `&` non échappé suffit à rendre le
 * document illisible pour tout analyseur, et un `<` y ouvrirait une balise.
 */
const escapeXml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')

/**
 * La date au format que RSS 2.0 exige (RFC 822, via RFC 1123).
 *
 * `toUTCString()` de la plateforme rend exactement cette forme. La date d'un
 * article est un **jour de calendrier** : elle est lue à midi UTC pour qu'aucun
 * décalage horaire de lecteur ne la fasse basculer sur la veille.
 */
const rfc822 = (date: string): string => new Date(`${date}T12:00:00Z`).toUTCString()

/**
 * Le flux, articles du plus récent au plus ancien.
 *
 * L'ordre n'est pas cosmétique : un lecteur de flux affiche le document tel
 * qu'il le reçoit, et un flux qui commence par l'article le plus ancien montre
 * du vieux contenu en tête à chaque visite.
 */
export function renderBlogFeed(input: BlogFeedInput): string {
  const items = [...input.articles]
    .sort((left, right) => right.date.localeCompare(left.date))
    .map((article) =>
      [
        '    <item>',
        `      <title>${escapeXml(article.title)}</title>`,
        `      <link>${escapeXml(article.url)}</link>`,
        // `isPermaLink="true"` : l'identifiant **est** l'adresse. Un lecteur
        // dédoublonne dessus, et une valeur qui changerait d'une lecture à
        // l'autre republierait chaque article à chaque fois.
        `      <guid isPermaLink="true">${escapeXml(article.url)}</guid>`,
        `      <description>${escapeXml(article.description)}</description>`,
        // **`dc:creator`, et non `<author>`** : RSS 2.0 définit
        // `<item><author>` comme l'**adresse email** de l'auteur
        // (`<author>lawyer@boyer.net (Lawyer Boyer)</author>`), et un nom nu y
        // vaut `InvalidContact` au validateur de flux du W3C. Le frontmatter
        // d'un article porte un nom d'affichage ; la seule façon de tenir
        // `<author>` serait d'inventer une adresse, c'est-à-dire de publier une
        // boîte aux lettres dans un document que des robots moissonnent.
        // `dc:creator` est la convention prévue pour un nom seul, et son espace
        // de noms est déclaré sur `<rss>`.
        `      <dc:creator>${escapeXml(article.author)}</dc:creator>`,
        `      <pubDate>${rfc822(article.date)}</pubDate>`,
        '    </item>',
      ].join('\n'),
    )

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    '  <channel>',
    `    <title>${escapeXml(input.title)}</title>`,
    `    <link>${escapeXml(input.siteUrl)}</link>`,
    `    <description>${escapeXml(input.description)}</description>`,
    `    <language>${escapeXml(input.locale)}</language>`,
    `    <atom:link href="${escapeXml(input.feedUrl)}" rel="self" type="application/rss+xml"/>`,
    ...items,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n')
}
