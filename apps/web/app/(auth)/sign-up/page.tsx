import { Card, CardContent, PageHeader } from '@repo/ui'
import { redirect } from 'next/navigation'

import {
  authRoutePath,
  currentViewer,
  DEFAULT_SIGNED_IN_PATH,
  safeRedirectPath,
} from '../../../lib/auth'
import { appIntl } from '../../../lib/i18n'
import { AuthForm } from '../../auth-form'
import { OAuthProviderButtons } from '../../oauth-buttons'

/**
 * L'écran d'inscription.
 *
 * **Un visiteur déjà connecté n'a rien à faire ici** (s61, critère 10) : il
 * part vers son `?next=` s'il passe le filtre de `safeRedirectPath`, sinon vers
 * le tableau de bord — la constante du module, comme après une connexion.
 */
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const { t, path } = await appIntl()

  if ((await currentViewer()).session !== null) {
    const next = typeof params.next === 'string' ? params.next : null

    redirect(path(safeRedirectPath(next, DEFAULT_SIGNED_IN_PATH)))
  }

  return (
    <main className="mx-auto flex w-full max-w-md min-w-0 flex-col gap-6">
      <PageHeader title={t('app.signUp.title')} />
      <Card className="min-w-0">
        <CardContent className="flex min-w-0 flex-col gap-6">
          {/*
            Les mêmes boutons qu'à la connexion, et c'est voulu : chez un
            fournisseur, s'inscrire et se connecter sont le même geste. Le
            compte est créé au premier retour, avec l'adresse que le fournisseur
            atteste.
          */}
          <OAuthProviderButtons />
          <AuthForm
            action={authRoutePath('signUp')}
            fields={[
              {
                name: 'email',
                labelKey: 'app.auth.field.email',
                type: 'email',
                autoComplete: 'email',
              },
              {
                name: 'password',
                labelKey: 'app.auth.field.password',
                type: 'password',
                autoComplete: 'new-password',
              },
            ]}
            submitLabelKey="app.signUp.submit"
            successMessageKey="app.signUp.done"
          />
        </CardContent>
      </Card>
      {/*
        Le lien secondaire porte les classes de `CookieBanner` — même rang, même
        traitement : souligné, atténué, et un anneau de focus visible.
      */}
      <p className="text-sm text-muted-foreground">
        <a
          className="rounded-sm underline underline-offset-4 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          href={path('/sign-in')}
        >
          {t('app.signUp.haveAccount')}
        </a>
      </p>
    </main>
  )
}
