import { describe, expect, it } from 'vitest'

import { parseArticle } from './article'

/**
 * Le frontmatter d'un article est une **frontière** : il vient d'un fichier
 * qu'un humain écrit à la main, hors de tout compilateur. Le dépôt impose Zod à
 * chaque frontière (`docs/security.md` §4), et cette frontière-ci a une
 * exigence de plus, écrite dans le critère 2 de la story : le refus **nomme le
 * fichier fautif**. Un build qui échoue sur « champ requis » sans dire lequel
 * des articles est en cause laisse l'auteur les ouvrir un par un.
 */
const VALID = [
  '---',
  'title: Un test vert qui ne vérifie rien',
  'description: Comment un prédicat satisfait par un seul module devient un nom écrit en dur.',
  'date: 2026-02-28',
  'author: Olivier Mattei',
  'tags: [ingénierie, coulisses]',
  '---',
  '',
  'Le corps de l’article.',
].join('\n')

const FILE = 'content/blog/fr/test-vert.mdx'

const refusalOf = (source: string): string => {
  try {
    parseArticle({ source, filePath: FILE, slug: 'test-vert', locale: 'fr' })
  } catch (error) {
    return (error as Error).message
  }

  throw new Error('Le frontmatter fautif a été accepté.')
}

describe('le frontmatter d’un article', () => {
  it('rend les cinq champs déclarés, et le chemin qui les porte', () => {
    expect(parseArticle({ source: VALID, filePath: FILE, slug: 'test-vert', locale: 'fr' })).toEqual(
      {
        slug: 'test-vert',
        locale: 'fr',
        title: 'Un test vert qui ne vérifie rien',
        description:
          'Comment un prédicat satisfait par un seul module devient un nom écrit en dur.',
        date: '2026-02-28',
        author: 'Olivier Mattei',
        tags: ['ingénierie', 'coulisses'],
      },
    )
  })

  it.each([
    ['aucun bloc de frontmatter', 'Juste du texte, sans en-tête.'],
    ['un champ requis absent', VALID.replace('description: Comment un prédicat', 'autre: x #')],
    ['un titre vide', VALID.replace('title: Un test vert qui ne vérifie rien', 'title: ""')],
    ['une date qui n’existe pas', VALID.replace('date: 2026-02-28', 'date: 2026-02-30')],
    ['une date mal formée', VALID.replace('date: 2026-02-28', 'date: 28/02/2026')],
    ['des tags qui ne sont pas une liste', VALID.replace('tags: [ingénierie, coulisses]', 'tags: ingénierie')],
    // Une clé **en plus**, tous les champs requis présents : c'est le seul cas
    // qui éprouve `strict()`. Une faute de frappe sur un champ requis serait
    // déjà refusée pour l'absence de ce champ, et le laisserait donc passer.
    ['une clé inconnue à côté des cinq attendues', VALID.replace('---\n\n', 'auteur: Olivier\n---\n\n')],
    ['un bloc de frontmatter qui n’est pas un objet', '---\n- un\n- deux\n---\n\nCorps.'],
    ['du YAML illisible', '---\ntitle: "non fermé\n---\n\nCorps.'],
  ])('refuse %s, en nommant le fichier', (_case, source) => {
    expect(refusalOf(source)).toContain(FILE)
  })

  it('nomme le champ fautif en plus du fichier', () => {
    // Nommer le fichier sans nommer le champ oblige à relire tout l'en-tête ;
    // nommer le champ sans le fichier oblige à ouvrir tous les articles.
    expect(refusalOf(VALID.replace('author: Olivier Mattei', 'author: 12'))).toContain('author')
  })
})
