import { describe, expect, it } from 'vitest'

import type { ChangelogEntry } from '../domain/changelog-entry'
import {
  EMPTY_CHANGELOG_CATALOG,
  changelogListView,
  resolveChangelogCatalog,
} from './changelog-catalog'

/**
 * **La page, langue par langue** — la moitié « écran » du critère 4.
 *
 * La moitié « flux » vit dans `tests/changelog.test.ts`, où le document servi
 * est analysé. Celle-ci manquait, et la revue de s31 l'a mesuré : remplacer le
 * filtre de `changelogListView` par `catalog.entries` laissait toute la suite
 * verte, c'est-à-dire une page française qui listerait les entrées anglaises.
 *
 * **Les attentes sont écrites, jamais dérivées de la fonction mesurée.**
 * `tests/rendered-text.test.ts` construit son attendu en **appelant**
 * `changelogListView` : son attente suit donc la mutation, et c'est
 * structurellement ce qui l'empêche d'attraper ce défaut-là. Un second test de
 * cette forme n'aurait rien ajouté.
 */

const entry = (over: Partial<ChangelogEntry> = {}): ChangelogEntry => ({
  slug: 'flux-des-nouveautes',
  locale: 'fr',
  version: '1.1',
  date: '2026-02-18',
  category: 'added',
  title: 'Un flux RSS des nouveautés',
  description: 'Les nouvelles versions se suivent depuis un agrégateur.',
  ...over,
})

const slugsOf = (
  view: ReturnType<typeof changelogListView>,
): readonly string[] => view.releases.flatMap((release) => release.entries.map((found) => found.slug))

describe('la page des nouveautés', () => {
  it('ne montre que les entrées de la langue demandée', () => {
    const catalog = resolveChangelogCatalog({
      entries: [
        entry({ slug: 'francaise' }),
        entry({ slug: 'anglaise', locale: 'en' }),
        entry({ slug: 'francaise-bis', date: '2026-02-20' }),
      ],
    })

    expect(slugsOf(changelogListView(catalog, { locale: 'fr' }))).toEqual([
      'francaise-bis',
      'francaise',
    ])
    expect(changelogListView(catalog, { locale: 'fr' }).total).toBe(2)

    // L'autre langue, mesurée elle aussi : une page qui montrerait tout serait
    // verte sur la seule première attente si les entrées y étaient majoritaires.
    expect(slugsOf(changelogListView(catalog, { locale: 'en' }))).toEqual(['anglaise'])
    expect(changelogListView(catalog, { locale: 'en' }).total).toBe(1)

    // Une langue que personne n'a écrite ne rend rien — pas un repli sur une
    // autre : une page vide se distingue d'une page dans la mauvaise langue.
    expect(changelogListView(catalog, { locale: 'de' })).toEqual({ releases: [], total: 0 })
  })

  it('ne produit pas de groupe de version vide dans la langue où elle n’existe pas', () => {
    const catalog = resolveChangelogCatalog({
      entries: [
        entry({ slug: 'seulement-en-francais', version: '2.0' }),
        entry({ slug: 'traduite', version: '1.0' }),
        entry({ slug: 'traduite-en', version: '1.0', locale: 'en' }),
      ],
    })

    // Le filtre vient **avant** le regroupement : la version 2.0 n'existe qu'en
    // français, et l'anglais n'en montre donc pas un groupe sans entrée.
    expect(changelogListView(catalog, { locale: 'fr' }).releases.map((r) => r.version)).toEqual([
      '2.0',
      '1.0',
    ])
    expect(changelogListView(catalog, { locale: 'en' }).releases.map((r) => r.version)).toEqual([
      '1.0',
    ])
  })

  it('rend un catalogue non monté comme une page sans rien à montrer', () => {
    expect(changelogListView(EMPTY_CHANGELOG_CATALOG, { locale: 'fr' })).toEqual({
      releases: [],
      total: 0,
    })
  })
})
