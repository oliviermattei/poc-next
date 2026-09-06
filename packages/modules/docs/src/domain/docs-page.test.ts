import { describe, expect, it } from 'vitest'

import {
  InvalidDocsPageError,
  MAX_DOCS_LINES,
  MAX_DOCS_LINE_LENGTH,
  documentHeadings,
  documentLinks,
  documentText,
  headingAnchor,
  parseDocsPage,
  parseDocsSection,
} from './docs-page'

/**
 * Les règles pures de la documentation : ce qu'un fichier doit déclarer, et ce
 * qu'on dérive de son corps.
 *
 * Le refus **nomme le fichier**, motif repris de `blog` (s29) et pour la même
 * raison : le frontmatter est lu à l'amorçage, donc pendant `pnpm build`. Un
 * message qui dirait seulement « champ requis » obligerait l'auteur à ouvrir les
 * pages une par une.
 */

const page = (frontmatter: string, body = '') =>
  parseDocsPage({
    source: `---\n${frontmatter}\n---\n${body}`,
    filePath: 'content/docs/fr/prise-en-main/installer.mdx',
    section: 'prise-en-main',
    slug: 'installer',
    locale: 'fr',
  })

describe('le frontmatter d’une page de documentation', () => {
  it('rend la page quand il est complet', () => {
    expect(page('title: Installer\ndescription: Poser le dépôt\norder: 2')).toMatchObject({
      section: 'prise-en-main',
      slug: 'installer',
      locale: 'fr',
      title: 'Installer',
      description: 'Poser le dépôt',
      order: 2,
    })
  })

  it('refuse un fichier sans bloc de frontmatter, en le nommant', () => {
    expect(() =>
      parseDocsPage({
        source: '# Installer\n',
        filePath: 'content/docs/fr/prise-en-main/installer.mdx',
        section: 'prise-en-main',
        slug: 'installer',
        locale: 'fr',
      }),
    ).toThrow(/content\/docs\/fr\/prise-en-main\/installer\.mdx/)
  })

  it('refuse une clé inconnue, même quand tout le requis est là', () => {
    // Le frontmatter **fermé** : une clé que le schéma ignore fait croire à son
    // auteur qu'elle produit quelque chose. Le cas se mesure avec un
    // frontmatter par ailleurs complet — sinon c'est la clé manquante qui
    // refuse, et la fermeture du schéma n'est jamais éprouvée (mutation posée
    // sur `.strict()` : verte tant que le cas était incomplet).
    expect(() => page('title: Installer\ndescription: x\norder: 1\ntags: [a]')).toThrow(
      InvalidDocsPageError,
    )
  })

  it('refuse un ordre qui n’est pas un entier', () => {
    expect(() => page('title: Installer\ndescription: x\norder: premier')).toThrow(
      /content\/docs\/fr\/prise-en-main\/installer\.mdx/,
    )
  })
})

describe('le manifeste d’une section', () => {
  const section = (source: string) =>
    parseDocsSection({
      source,
      filePath: 'content/docs/fr/prise-en-main/section.json',
      section: 'prise-en-main',
      locale: 'fr',
    })

  it('rend le titre et l’ordre de la section', () => {
    expect(section('{"title": "Prise en main", "order": 1}')).toMatchObject({
      section: 'prise-en-main',
      locale: 'fr',
      title: 'Prise en main',
      order: 1,
    })
  })

  it('refuse un JSON illisible en nommant le fichier', () => {
    expect(() => section('{ "title": ')).toThrow(/section\.json/)
  })

  it('refuse un manifeste sans titre en nommant le fichier', () => {
    expect(() => section('{"order": 1}')).toThrow(/section\.json/)
  })
})

describe('les liens internes du corps', () => {
  /*
   * **La matière de la passe croisée** (s54). Ce que cette fonction rend n'est
   * jugé nulle part ici : un fichier ne sait pas si la page qu'il cite existe.
   * Elle relève, `application/docs-catalog` croise — c'est la découpe qui rend
   * la passe possible sans un second balayage du disque.
   */
  const links = (body: string) =>
    page('title: Installer\ndescription: x\norder: 1', body).links

  it('relève les liens internes, dans l’ordre du document', () => {
    expect(
      links('Voir [le contrat](/docs/reference/modules) puis [les tarifs](/pricing).'),
    ).toEqual(['/docs/reference/modules', '/pricing'])
  })

  it('ignore ce qui ne désigne pas une page de ce site', () => {
    // Un lien sortant, une adresse électronique et une ancre de la page
    // courante ne peuvent pas être morts au sens du critère : le premier
    // n'appartient pas au dépôt, le troisième ne quitte pas la page.
    expect(
      links(
        '[amont](https://example.test/a) [courriel](mailto:a@example.test) [ici](#prerequis)',
      ),
    ).toEqual([])
  })

  it('ne relève rien dans un bloc de code', () => {
    /*
     * Le cas le plus probable, et le plus coûteux : un extrait qui montre du
     * Markdown ferait échouer le build sur une page qui n'a aucun lien. C'est
     * la même raison qui fait sauter les blocs de code au relevé des titres.
     */
    expect(links('```md\n[mort](/docs/nulle-part/jamais)\n```\n')).toEqual([])
  })

  it('garde le lien tel qu’il est écrit, fragment compris', () => {
    // Le refus doit citer **la cible telle qu'elle est écrite** : une cible
    // recomposée envoie son auteur chercher une chaîne que son fichier ne
    // contient pas.
    expect(links('[une ancre](/docs/reference/modules#quatre-couches)')).toEqual([
      '/docs/reference/modules#quatre-couches',
    ])
  })
})

describe('les titres du corps, et leurs ancres', () => {
  it('retient les niveaux 2 et 3, dans l’ordre du document', () => {
    const headings = documentHeadings('## Prérequis\n\ntexte\n\n### Node\n\n## Installer\n')

    expect(headings.map((heading) => [heading.depth, heading.text])).toEqual([
      [2, 'Prérequis'],
      [3, 'Node'],
      [2, 'Installer'],
    ])
  })

  it('ignore le niveau 1 : le titre de la page est celui du frontmatter', () => {
    expect(documentHeadings('# Installer\n\n## Prérequis\n')).toHaveLength(1)
  })

  it('ignore ce qui ressemble à un titre dans un bloc de code', () => {
    // `# commentaire` d'un extrait de shell est la faute la plus probable : il
    // produirait une ancre vers un fragment que la page ne rend pas.
    const headings = documentHeadings(
      '## Vrai titre\n\n```bash\n## pas un titre\n# ni celui-ci\n```\n\n### Second\n',
    )

    expect(headings.map((heading) => heading.text)).toEqual(['Vrai titre', 'Second'])
  })

  it('refuse une page où deux titres produisent la même ancre, en la nommant', () => {
    /*
     * Deux `id` identiques rendent le second inatteignable — le navigateur
     * s'arrête au premier — et surtout : le sommaire est dérivé de la **source**
     * tandis que les `id` sont posés au **rendu**, par deux passes qui ne
     * comptent pas les occurrences de la même façon. Suffixer d'un côté
     * seulement produirait un lien qui ne mène nulle part, et un fragment
     * inconnu ne casse rien : il ne fait rien. Le refus supprime la divergence
     * au lieu de la documenter.
     */
    expect(() => page('title: x\ndescription: x\norder: 1', '## Options\n\n### Options\n')).toThrow(
      /options/,
    )
  })

  it('rend le texte d’un titre **tel qu’il s’affiche**, sans son balisage en ligne', () => {
    /*
     * Deux défauts d'un seul coup, et le second est le sérieux :
     *
     * 1. le sommaire affichait les accents graves — « Le contrat de \`module\` » —,
     *    vu au navigateur ;
     * 2. surtout, l'ancre du sommaire est dérivée de la **source** et l'`id` du
     *    rendu, où le balisage a disparu. `## a\`b\`c` donnait « a-b-c » d'un côté
     *    et « abc » de l'autre : deux fragments, un lien mort, et rien à l'écran
     *    pour le dire.
     */
    const [heading] = documentHeadings('## Les quatre fichiers de `config/`\n')

    expect(heading?.text).toBe('Les quatre fichiers de config/')
  })

  it('fait coïncider l’ancre de la source et celle du rendu, balisage **collé** au mot', () => {
    /*
     * Le cas qui départage, et il est étroit : `headingAnchor` réduit toute
     * ponctuation à un tiret puis fusionne, si bien qu'un balisage **séparé par
     * des espaces** donne la même ancre des deux côtés, retiré ou non. La
     * divergence n’apparaît que quand le balisage touche un mot —
     * `` `ModuleRoute`s `` : « moduleroute-s » depuis la source,
     * « moduleroutes » depuis le rendu. Deux fragments, un lien mort, et rien
     * à l'écran pour le dire.
     */
    const [heading] = documentHeadings('## Les `ModuleRoute`s du module\n')

    // Ce que `createProseComponents` verra du même titre, une fois le MDX rendu.
    expect(heading?.id).toBe(headingAnchor('Les ModuleRoutes du module'))
  })

  it('dérive l’ancre du texte, accents et ponctuation compris', () => {
    expect(headingAnchor('Prérequis : Node 20 !')).toBe('prerequis-node-20')
  })

  it('donne quand même une ancre à un titre sans caractère utilisable', () => {
    // Un `id` vide n'est pas une ancre : `#` ramène en haut de la page.
    expect(headingAnchor('— ✳ —')).not.toBe('')
  })

  it('expose les titres du corps sur la page analysée', () => {
    expect(page('title: Installer\ndescription: x\norder: 1', '## Prérequis\n').headings).toHaveLength(
      1,
    )
  })
})

/**
 * **Un corps hostile coûte-t-il plus cher qu'un corps normal ?**
 *
 * CodeQL a signalé `js/polynomial-redos` en sévérité haute sur les deux
 * balayages de liens de ce fichier, et la mesure confirme le motif : sur
 * `'['.repeat(n)`, chaque `[` ouvre une tentative dont la classe `[^\]]*`
 * parcourt le reste de la ligne. **Mesuré avant le correctif** : 20 000
 * caractères → 0,75 s ; 50 000 → 4,7 s ; 100 000 → 19,0 s de processeur.
 *
 * **L'exposition, sans l'enfler ni la nier.** L'entrée n'est pas un corps HTTP
 * anonyme comme celui de s39 : c'est un fichier de `content/`, écrit par
 * l'auteur du dépôt et lu au build. Un inconnu ne fait donc pas pendre la
 * production — un contributeur fait pendre **son propre build**, sans message.
 * Mais ce dépôt est un boilerplate : ses utilisateurs écrivent leur propre
 * `content/`, et livrer un build qui pend en silence sur un `.mdx` collé de
 * travers est un défaut qu'on leur transmettrait. La requête du visiteur, elle,
 * ne traverse jamais ces motifs (`application/docs-search`, classes simples).
 *
 * L'assertion porte sur le **temps**, parce que le défaut *est* le temps ; le
 * budget est grossier exprès — deux ordres de grandeur sous la mesure — pour
 * qu'une machine chargée ne le rende pas capricieux.
 */
describe('un corps hostile ne coûte pas plus qu’un corps normal', () => {
  /** Large exprès : ce qui est refusé est la seconde, pas la milliseconde. */
  const BUDGET_MS = 250

  const budgeted = (name: string, run: () => unknown): void => {
    const started = performance.now()
    run()
    const elapsed = performance.now() - started

    expect(elapsed, `${name} : ${elapsed.toFixed(0)} ms`).toBeLessThan(BUDGET_MS)
  }

  it('rend la main sur la forme adverse au lieu de partir en temps quadratique', () => {
    const hostile = '['.repeat(50_000)

    expect(documentLinks(hostile)).toEqual([])
    budgeted('documentLinks', () => documentLinks(hostile))
    budgeted('documentText', () => documentText(hostile))
    budgeted('documentHeadings', () => documentHeadings(`## ${hostile}`))
  })

  /**
   * **La borne, qui est la moitié qui ne vieillira pas.** Les motifs d'à côté
   * sont linéaires aujourd'hui ; celui qu'un prochain agent écrira à leur place
   * ne le sera peut-être pas. Ce qui protège alors est que rien de démesuré
   * n'atteigne le balayage, quelle qu'en soit l'écriture — s39 a mesuré que
   * cette moitié-là suffit à désamorcer l'ancien motif à elle seule.
   *
   * Les deux plafonds sont **dérivés** des constantes, jamais recopiés : une
   * valeur écrite ici resterait verte après qu'on l'ait desserrée là-bas.
   */
  it('refuse une ligne plus longue que le plafond en nommant le fichier, et garde la même en deçà', () => {
    const body = (length: number) => `Voir [x](/docs/a/b) ${'y'.repeat(length)}`
    const overhead = body(0).length

    expect(() => page('title: T\ndescription: x\norder: 1', body(MAX_DOCS_LINE_LENGTH - overhead + 1)))
      .toThrow(/installer\.mdx.*ligne 1.*2001/s)
    expect(
      page('title: T\ndescription: x\norder: 1', body(MAX_DOCS_LINE_LENGTH - overhead)).links,
    ).toEqual(['/docs/a/b'])
  })

  it('refuse un corps qui compte plus de lignes que le plafond, et garde le même en deçà', () => {
    const body = (lines: number) => 'x\n'.repeat(lines)

    expect(() => page('title: T\ndescription: x\norder: 1', body(MAX_DOCS_LINES + 1))).toThrow(
      InvalidDocsPageError,
    )
    expect(() => page('title: T\ndescription: x\norder: 1', body(MAX_DOCS_LINES - 1))).not.toThrow()
  })

  it('borne aussi les balayeuses exportées, qu’un appelant peut joindre sans passer par le refus', () => {
    /*
     * `documentLinks`, `documentText` et `documentHeadings` sont exportées par
     * le baril du module : la borne ne peut pas dépendre de l'ordre dans lequel
     * on les traverse. Une ligne trop longue est **jetée** là — elles ne
     * connaissent pas le fichier et ne peuvent nommer personne —, là où
     * `parseDocsPage` **refuse en nommant**.
     */
    const long = `[x](/docs/a/b)${' '.repeat(MAX_DOCS_LINE_LENGTH)}`

    expect(documentLinks(long)).toEqual([])
    expect(documentLinks(`${long}\n[y](/docs/c/d)`)).toEqual(['/docs/c/d'])
    expect(documentLinks(`${'\n'.repeat(MAX_DOCS_LINES)}[z](/docs/e/f)`)).toEqual([])
  })
})
