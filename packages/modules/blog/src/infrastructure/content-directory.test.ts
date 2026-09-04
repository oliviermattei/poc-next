import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readArticleDirectory } from './content-directory'

/**
 * La lecture du dossier des articles.
 *
 * C'est ici que tombe le critère 1 de la story — « un fichier déposé apparaît
 * dans la liste, sans inscription dans un index ». Il n'y a donc rien à
 * enregistrer : le test dépose un fichier et relit.
 *
 * Les fixtures sont écrites dans un dossier temporaire plutôt que versionnées :
 * un jeu de fichiers versionné à côté de son test finit par diverger de ce que
 * le test prétend éprouver, et « déposer un fichier » ne se démontre pas avec
 * des fichiers déjà là.
 */
const article = (title: string, date: string, tags: readonly string[]): string =>
  [
    '---',
    `title: ${title}`,
    `description: La description de « ${title} ».`,
    `date: ${date}`,
    'author: Olivier Mattei',
    `tags: [${tags.join(', ')}]`,
    '---',
    '',
    'Le corps.',
  ].join('\n')

let root = ''

const write = (relative: string, contents: string): void => {
  const path = join(root, relative)

  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, contents, 'utf8')
}

const read = (locales: readonly string[], knownLocales: readonly string[] = ['fr', 'en']) =>
  readArticleDirectory({ directory: root, locales, knownLocales })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'blog-content-'))
  // **L'ordre alphabétique des noms contredit l'ordre des dates**, exprès :
  // `readdirSync` rend les noms triés, si bien qu'un jeu où les deux coïncident
  // laisse passer un tri absent (mesuré — la mutation « tri retiré » restait
  // verte).
  write('fr/un-test-vert.mdx', article('Un test vert', '2026-03-12', ['ingénierie', 'coulisses']))
  write('fr/facturer-au-siege.mdx', article('Facturer au siège', '2026-02-28', ['produit']))
  write('en/un-test-vert.mdx', article('A green test', '2026-03-12', ['engineering']))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('le dossier des articles', () => {
  it('rend les articles de la locale servie, du plus récent au plus ancien', () => {
    expect(read(['fr']).map((found) => found.slug)).toEqual(['un-test-vert', 'facturer-au-siege'])
  })

  it('fait apparaître un fichier déposé, sans l’inscrire nulle part', () => {
    write('fr/supprimer-la-file.mdx', article('Supprimer la file', '2026-02-14', ['ingénierie']))

    expect(read(['fr']).map((found) => found.title)).toContain('Supprimer la file')
  })

  it('lit chaque locale servie dans son propre dossier', () => {
    expect(read(['fr', 'en']).map((found) => `${found.locale}/${found.slug}`)).toEqual([
      'fr/un-test-vert',
      'fr/facturer-au-siege',
      'en/un-test-vert',
    ])
  })

  it('ne sert pas la locale qu’on ne lui demande pas', () => {
    // Le module `i18n` coupé, une seule locale est servie. Les articles écrits
    // dans les autres restent sur le disque et ne sont **pas** servis : c'est
    // le critère « tout est servi dans la langue par défaut ».
    expect(read(['fr']).some((found) => found.locale === 'en')).toBe(false)
  })

  it('accepte une locale servie qui n’a encore aucun article', () => {
    // Un dossier absent n'est pas une panne : c'est une langue où personne n'a
    // encore publié.
    rmSync(join(root, 'en'), { recursive: true })

    expect(read(['fr', 'en']).map((found) => found.locale)).toEqual(['fr', 'fr'])
  })

  it('ignore ce qui n’est pas un article', () => {
    write('fr/notes.txt', 'Des notes de travail.')
    write('fr/.DS_Store', 'binaire')

    expect(read(['fr'])).toHaveLength(2)
  })

  it('refuse un dossier qu’aucune locale de l’application ne déclare, en le nommant', () => {
    // **Le piège que `config/i18n.ts:5-7` documente.** Les locales servies
    // (`localeRouting`) sont un sous-ensemble de celles de l'application : `en`
    // existe sur le disque et n'est pas servie quand `i18n` est coupé, et c'est
    // légitime. `de` n'est déclarée nulle part : l'ignorer en silence ferait
    // écrire des articles que rien n'affichera jamais.
    write('de/gruen.mdx', article('Ein grüner Test', '2026-02-28', ['technik']))

    expect(() => read(['fr'])).toThrow(/de/)
  })

  it('refuse un frontmatter invalide en nommant le fichier', () => {
    write('fr/casse.mdx', '---\ntitle: Sans date\n---\n\nLe corps.')

    expect(() => read(['fr'])).toThrow(/fr\/casse\.mdx/)
  })

  it('refuse un nom de fichier qui ne peut pas être un chemin d’URL', () => {
    write('fr/Un Titre.mdx', article('Un titre', '2026-01-01', ['produit']))

    expect(() => read(['fr'])).toThrow(/Un Titre\.mdx/)
  })
})
