import { DOCS_KEYS, firstDocsPage } from '@repo/module-docs'
import { EmptyState, Button } from '@repo/ui'
import { MarketingFooter } from '@repo/module-marketing/presentation'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'

import { consentFooterLinks } from '../../lib/consent'
import { docsCatalog } from '../../lib/docs'
import { appIntl } from '../../lib/i18n'
import { marketingFormsAvailable, marketingSite } from '../../lib/marketing'

/**
 * L'entrée de la documentation.
 *
 * **La documentation n'a pas de « liste » au sens du blog** : l'arborescence
 * *est* la navigation. Cette adresse mène donc à la première page plutôt que
 * d'en répéter le contenu sous une seconde URL — deux URL pour un même texte
 * feraient de la page un doublon pour un moteur, ce que la canonique de
 * l'article de blog évite déjà par un autre chemin.
 *
 * **Module coupé, elle répond 404**, comme une page légale dont le slug n'est
 * pas déclaré : la décision se lit sur `docsCatalog.index`, c'est-à-dire sur une
 * **donnée**, jamais sur l'identifiant d'un module (`apps/web/AGENTS.md`). Une
 * documentation montée sans aucune page, elle, rend un état vide — les deux
 * situations ne se confondent pas.
 */
export async function generateMetadata(): Promise<Metadata> {
  if (docsCatalog.index === null) {
    // Module coupé : les clés de la documentation ont disparu du catalogue avec
    // lui, et en demander une ferait tomber la page.
    return {}
  }

  const { locale, t, path } = await appIntl()
  const title = t(DOCS_KEYS.navigation)
  const description = t(DOCS_KEYS.emptyDescription)

  return {
    title,
    description,
    openGraph: { title, description, type: 'website', locale },
    alternates: { canonical: path(docsCatalog.index.path) },
  }
}

export default async function DocsIndexPage() {
  if (docsCatalog.index === null) {
    notFound()
  }

  const { locale, t, path } = await appIntl()
  const first = firstDocsPage(docsCatalog, locale)

  if (first !== null) {
    redirect(path(first.href))
  }

  return (
    <>
      <EmptyState
        title={t(DOCS_KEYS.emptyTitle)}
        description={t(DOCS_KEYS.emptyDescription)}
        action={
          <Button variant="outline" asChild>
            <a href={path('/')}>{t(DOCS_KEYS.emptyAction)}</a>
          </Button>
        }
      />
      {marketingFormsAvailable ? (
        <MarketingFooter
          site={marketingSite}
          intl={{ t, path }}
          extraLinks={consentFooterLinks(t)}
        />
      ) : null}
    </>
  )
}
