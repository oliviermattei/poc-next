import { describe, expect, it } from 'vitest'

import {
  InvalidChangelogEntryError,
  changelogReleases,
  compareVersions,
  parseChangelogEntry,
  type ChangelogEntry,
} from './changelog-entry'

/**
 * L'entrée de changelog et son ordre — **les deux règles pures du module**.
 *
 * La première est lue à l'amorçage, donc pendant `pnpm build` : un frontmatter
 * invalide doit refuser **en nommant le fichier**, sans quoi l'auteur ouvrirait
 * les entrées une par une. C'est la forme que s29 a établie pour les articles.
 *
 * La seconde est le seul piège algorithmique de la story, et sa fixture porte
 * tout le test : **`10.0` vient après `9.0`**. Une fixture à un seul chiffre
 * laisserait verte la mutation qui remplace le tri sémantique par un tri
 * lexicographique — c'est le mode d'échec que s29 a rencontré sur son tri par
 * date.
 */

const FRONTMATTER = [
  '---',
  'version: "1.2"',
  'date: 2026-03-04',
  'category: added',
  'title: Le flux des nouveautés',
  'description: Un flux RSS annonce désormais chaque version.',
  '---',
  '',
  'Le corps de l’entrée.',
].join('\n')

const parse = (source: string) =>
  parseChangelogEntry({
    source,
    filePath: 'content/changelog/fr/flux-des-nouveautes.mdx',
    slug: 'flux-des-nouveautes',
    locale: 'fr',
  })

describe('le frontmatter d’une entrée', () => {
  it('rend l’entrée, slug et locale venant de l’emplacement du fichier', () => {
    expect(parse(FRONTMATTER)).toEqual({
      slug: 'flux-des-nouveautes',
      locale: 'fr',
      version: '1.2',
      date: '2026-03-04',
      category: 'added',
      title: 'Le flux des nouveautés',
      description: 'Un flux RSS annonce désormais chaque version.',
    })
  })

  it('refuse en nommant le fichier fautif et la raison', () => {
    const refusals: readonly [string, string][] = [
      ['Le corps sans frontmatter.', 'frontmatter'],
      [FRONTMATTER.replace('category: added', 'category: inventé'), 'category'],
      [FRONTMATTER.replace('version: "1.2"', 'version: "deux"'), 'version'],
      [FRONTMATTER.replace('date: 2026-03-04', 'date: 2026-02-30'), 'date'],
      // Une clé inconnue est le cas qui compte le plus, et l'assertion porte
      // sur **la clé fautive**, pas sur celle qui manque : sur un schéma
      // ouvert, `titre:` pour `title:` serait refusé pour un titre absent, et
      // un refus qui ne nomme pas la faute de frappe envoie l'auteur chercher
      // au mauvais endroit. Mesuré : l'assertion sur « title » restait verte
      // sans `strict()`.
      [FRONTMATTER.replace('title:', 'titre:'), 'titre'],
    ]

    for (const [source, mentioned] of refusals) {
      expect(() => parse(source), source).toThrow(InvalidChangelogEntryError)

      try {
        parse(source)
      } catch (error) {
        expect((error as Error).message, source).toContain(
          'content/changelog/fr/flux-des-nouveautes.mdx',
        )
        expect((error as Error).message, source).toContain(mentioned)
      }
    }
  })
})

const entry = (version: string, date: string, slug: string): ChangelogEntry => ({
  slug,
  locale: 'fr',
  version,
  date,
  category: 'added',
  title: slug,
  description: slug,
})

describe('les versions', () => {
  it('se comparent numériquement : 10.0 vient après 9.0', () => {
    expect(compareVersions('10.0', '9.0')).toBeGreaterThan(0)
    expect(compareVersions('9.0', '10.0')).toBeLessThan(0)
    expect(compareVersions('1.10.0', '1.9.3')).toBeGreaterThan(0)
    // Un segment absent vaut zéro : `2` et `2.0` sont la même version.
    expect(compareVersions('2', '2.0')).toBe(0)
    expect(compareVersions('2.1', '2')).toBeGreaterThan(0)
  })

  it('groupe les entrées par version, de la plus récente à la plus ancienne', () => {
    const releases = changelogReleases([
      entry('9.0', '2025-11-02', 'neuf'),
      entry('10.0', '2026-01-15', 'dix'),
      entry('10.0', '2026-01-20', 'dix-bis'),
      entry('2.0', '2024-05-01', 'deux'),
    ])

    // **Le passage à deux chiffres est ici, et il porte le test** : un tri
    // lexicographique rendrait 9.0, 2.0, 10.0 — vert sur une fixture qui
    // n'irait pas jusqu'à dix.
    expect(releases.map((release) => release.version)).toEqual(['10.0', '9.0', '2.0'])

    // La date d'une version est celle de sa dernière entrée : c'est la date à
    // laquelle cette version a fini de bouger.
    expect(releases.map((release) => release.date)).toEqual([
      '2026-01-20',
      '2025-11-02',
      '2024-05-01',
    ])

    // Dans une version, les entrées vont du plus récent au plus ancien elles
    // aussi : le critère parle d'ordre chronologique inverse, à tous les
    // étages.
    expect(releases[0]?.entries.map((found) => found.slug)).toEqual(['dix-bis', 'dix'])
  })
})
