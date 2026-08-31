import { HOME_DESCRIPTION_KEY, HOME_TITLE_KEY } from '@repo/module-marketing'
import { MarketingHome } from '@repo/module-marketing/presentation'
import { Button, EmptyState, PageHeader } from '@repo/ui'
import { LayoutDashboardIcon } from 'lucide-react'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { currentViewer } from '../lib/auth'
import { NewsletterForm } from './public-form'
import { appIntl } from '../lib/i18n'
import { marketingSite } from '../lib/marketing'

/**
 * La racine du site — **trois lecteurs, une seule page**.
 *
 * | Qui | Ce qu'il obtient |
 * |---|---|
 * | un visiteur connecté | son tableau de bord (critère 1 de s08, inchangé) |
 * | un visiteur anonyme, site public activé | l'accueil marketing |
 * | un visiteur anonyme, site public coupé | une redirection vers la connexion |
 *
 * Aucune de ces trois branches ne nomme un module : la seconde et la troisième
 * se départagent sur `marketingSite.sections`, c'est-à-dire sur une **donnée**.
 * C'est la même discipline que le sélecteur de langue, qui apparaît quand
 * l'application sert plusieurs langues et non quand un module s'appelle `i18n`
 * (`apps/web/lib/navigation.ts`).
 *
 * **Aucune requête base de données pour un visiteur anonyme**, et ce n'est pas
 * une intention : `currentViewer()` résout la session par la signature du
 * cookie, sans cookie valide il n'y a rien à lire. `tests/marketing.test.ts`
 * **rend cette page** — et la page légale, et le shell — avec un compteur posé
 * sur les prototypes de `pg` : une requête émise ici, par quelque chemin que ce
 * soit, fait rougir la suite.
 *
 * La destination de la redirection est une **constante du code**, jamais un
 * paramètre d'URL : une redirection pilotée par l'extérieur est exactement ce
 * que `docs/security.md` §4 refuse.
 */
export async function generateMetadata(): Promise<Metadata> {
  if (marketingSite.sections.length === 0) {
    // Site public coupé : les clés du module ont disparu du catalogue avec lui,
    // et en demander une ferait tomber la page. Les métadonnées de
    // `app/layout.tsx` restent en place.
    return {}
  }

  const { locale, t } = await appIntl()
  const title = t(HOME_TITLE_KEY)
  const description = t(HOME_DESCRIPTION_KEY)

  return {
    title,
    description,
    openGraph: { title, description, type: 'website', locale },
  }
}

export default async function HomePage() {
  const { account } = await currentViewer()
  const { locale, t, path } = await appIntl()

  if (account !== null) {
    return (
      <>
        <PageHeader
          title={t('app.dashboard.title')}
          description={t('app.dashboard.description', { name: account.name })}
        />
        <EmptyState
          icon={<LayoutDashboardIcon />}
          title={t('app.dashboard.empty.title')}
          description={t('app.dashboard.empty.description')}
          action={
            <Button asChild>
              <a href={path('/account')}>{t('app.dashboard.empty.action')}</a>
            </Button>
          }
        />
      </>
    )
  }

  if (marketingSite.sections.length === 0) {
    redirect(path('/sign-in'))
  }

  return (
    <MarketingHome
      site={marketingSite}
      intl={{ t, path }}
      newsletterForm={<NewsletterForm locale={locale} />}
    />
  )
}
