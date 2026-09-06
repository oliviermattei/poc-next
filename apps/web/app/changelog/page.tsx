import {
  CHANGELOG_KEYS,
  changelogFeedPath,
  changelogListView,
} from '@repo/module-changelog'
import { ChangelogList } from '@repo/module-changelog/presentation'
import { MarketingFooter } from '@repo/module-marketing/presentation'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'

import { changelogBody } from '../../lib/changelog-body'
import { changelogCatalog } from '../../lib/changelog'
import { publicFooterLinks } from '../../lib/footer'
import { appIntl } from '../../lib/i18n'
import { marketingFormsAvailable, marketingSite } from '../../lib/marketing'
import { defaultLocale } from '../../../../config/i18n'

/**
 * Les nouveautés du produit — **une seule page**, groupée par version.
 *
 * **Module coupé, elle répond 404**, comme une page légale dont le slug n'est
 * pas déclaré : la décision se lit sur `changelogCatalog.index`, c'est-à-dire
 * sur une **donnée**, jamais sur l'identifiant d'un module
 * (`apps/web/AGENTS.md`). Un changelog monté sans aucune entrée, lui, rend un
 * état vide — les deux situations ne se confondent pas.
 *
 * Aucun `loading.tsx`, ici comme ailleurs : mesuré en s29, une frontière de
 * chargement vide la coquille avant que la page ne décide, et le `notFound()`
 * arrive alors en 200.
 */
export async function generateMetadata(): Promise<Metadata> {
  if (changelogCatalog.index === null) {
    // Module coupé : les clés du changelog ont disparu du catalogue avec lui, et
    // en demander une ferait tomber la page.
    return {}
  }

  const { locale, t, path } = await appIntl()
  const title = t(CHANGELOG_KEYS.listTitle)
  const description = t(CHANGELOG_KEYS.listDescription)

  return {
    title,
    description,
    openGraph: { title, description, type: 'website', locale },
    alternates: {
      canonical: path(changelogCatalog.index.path),
      // Le flux, **découvrable** : c'est ce qui le fait exister pour un
      // agrégateur. Un flux servi que rien n'annonce est introuvable.
      types: {
        'application/rss+xml':
          locale === defaultLocale
            ? changelogFeedPath()
            : `${changelogFeedPath()}?locale=${locale}`,
      },
    },
  }
}

export default async function ChangelogPage() {
  if (changelogCatalog.index === null) {
    notFound()
  }

  const { locale, t, path } = await appIntl()
  const view = changelogListView(changelogCatalog, { locale })

  /**
   * Les corps, chargés **avant** le rendu et indexés par entrée.
   *
   * Un composant qui suspendrait au milieu de l'arbre ne pourrait pas être rendu
   * par `renderToStaticMarkup`, dont `tests/rendered-text.test.ts` se sert pour
   * balayer tous les écrans. L'arbre est donc complet quand il part au rendu.
   */
  const bodies: Record<string, ReactNode> = Object.fromEntries(
    await Promise.all(
      view.releases
        .flatMap((release) => release.entries)
        .map(async (entry) => [entry.slug, await changelogBody({ locale, slug: entry.slug })]),
    ),
  )

  return (
    <>
      <ChangelogList view={view} intl={{ t, path }} bodies={bodies} />
      {marketingFormsAvailable ? (
        <MarketingFooter
          site={marketingSite}
          intl={{ t, path }}
          extraLinks={publicFooterLinks(t)}
        />
      ) : null}
    </>
  )
}
