import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, PageHeader } from '@repo/ui'
import { LayoutDashboardIcon } from 'lucide-react'

import { currentViewer } from '../lib/auth'
import { appIntl } from '../lib/i18n'

/**
 * Le tableau de bord.
 *
 * Il n'affiche rien d'inventé : le socle ne produit aucune donnée métier, et un
 * graphique factice serait une promesse que le boilerplate ne tient pas. C'est
 * donc un **état vide**, avec l'action qui en sort — ce que le design system
 * exige d'un écran sans contenu.
 *
 * Le nom de l'utilisateur est **un paramètre du message**, pas une
 * concaténation : « Bonjour {name}. » et « Hello {name}. » ne se composent pas
 * de la même façon, et une phrase coupée en trois morceaux est intraduisible.
 */
export default async function HomePage() {
  const { account } = await currentViewer()
  const { t, path } = await appIntl()

  if (account === null) {
    return (
      <>
        <PageHeader
          title={t('app.dashboard.anonymous.title')}
          description={t('app.dashboard.anonymous.description')}
        />
        <Card>
          <CardHeader>
            <CardTitle>{t('app.dashboard.anonymous.cardTitle')}</CardTitle>
            <CardDescription>{t('app.dashboard.anonymous.cardDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild>
              <a href={path('/sign-in')}>{t('app.dashboard.anonymous.signIn')}</a>
            </Button>
            <Button variant="outline" asChild>
              <a href={path('/sign-up')}>{t('app.dashboard.anonymous.signUp')}</a>
            </Button>
          </CardContent>
        </Card>
      </>
    )
  }

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
