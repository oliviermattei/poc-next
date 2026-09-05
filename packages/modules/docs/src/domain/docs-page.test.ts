import { describe, expect, it } from 'vitest'

import {
  InvalidDocsPageError,
  documentHeadings,
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
