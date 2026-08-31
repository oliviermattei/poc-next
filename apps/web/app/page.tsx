import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, PageHeader } from '@repo/ui'
import { LayoutDashboardIcon } from 'lucide-react'

import { currentViewer } from '../lib/auth'

/**
 * Le tableau de bord.
 *
 * Il n'affiche rien d'inventé : le socle ne produit aucune donnée métier, et un
 * graphique factice serait une promesse que le boilerplate ne tient pas. C'est
 * donc un **état vide**, avec l'action qui en sort — ce que le design system
 * exige d'un écran sans contenu.
 */
export default async function HomePage() {
  const { account } = await currentViewer()

  if (account === null) {
    return (
      <>
        <PageHeader
          title="Application"
          description="Le socle démarre. Connectez-vous pour accéder à votre espace."
        />
        <Card>
          <CardHeader>
            <CardTitle>Commencer</CardTitle>
            <CardDescription>
              Créez un compte ou connectez-vous pour atteindre le tableau de bord.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild>
              <a href="/sign-in">Se connecter</a>
            </Button>
            <Button variant="outline" asChild>
              <a href="/sign-up">Créer un compte</a>
            </Button>
          </CardContent>
        </Card>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Tableau de bord"
        description={`Bonjour ${account.name}. Les modules activés apparaissent dans la navigation.`}
      />
      <EmptyState
        icon={<LayoutDashboardIcon />}
        title="Rien à afficher pour l’instant"
        description="Ce tableau de bord se remplira avec les modules que vous activerez. En attendant, vos paramètres de compte sont accessibles ici."
        action={
          <Button asChild>
            <a href="/account">Paramètres du compte</a>
          </Button>
        }
      />
    </>
  )
}
