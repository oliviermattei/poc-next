import { authRoutePath } from '../../lib/auth'
import { appIntl } from '../../lib/i18n'
import { AuthForm } from '../auth-form'
import { OAuthProviderButtons } from '../oauth-buttons'

export default async function SignUpPage() {
  const { t, path } = await appIntl()

  return (
    <main>
      <h1>{t('app.signUp.title')}</h1>
      {/*
        Les mêmes boutons qu'à la connexion, et c'est voulu : chez un
        fournisseur, s'inscrire et se connecter sont le même geste. Le compte
        est créé au premier retour, avec l'adresse que le fournisseur atteste.
      */}
      <OAuthProviderButtons />
      <AuthForm
        action={authRoutePath('signUp')}
        fields={[
          { name: 'email', labelKey: 'app.auth.field.email', type: 'email', autoComplete: 'email' },
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
      <p>
        <a href={path('/sign-in')}>{t('app.signUp.haveAccount')}</a>
      </p>
    </main>
  )
}
