import { authRoutePath, safeRedirectPath } from '../../lib/auth'
import { appIntl } from '../../lib/i18n'
import { AuthForm } from '../auth-form'

/**
 * L'écran de connexion.
 *
 * La destination de retour est filtrée **côté serveur**, une seule fois, par la
 * règle du module : `?next=https://evil.test` retombe sur le tableau de bord
 * (`docs/security.md` §4). Le composant client ne reçoit qu'un chemin déjà jugé,
 * puis mis dans la forme publique de la locale — module `i18n` coupé, cette
 * mise en forme est l'identité.
 *
 * Ce repli est le **tableau de bord**, et pas l'écran de compte : c'est le
 * critère 1 de s08 — « une fois connecté, l'utilisateur atteint un tableau de
 * bord avec navigation latérale et menu de compte ». s07 repliait sur
 * `/account` faute de tableau de bord ; s08 en livre un, et le commentaire
 * ci-dessus redevient vrai. Une demande explicite (`?next=/account`) reste
 * respectée : c'est le repli qui change, pas la règle.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const { t, path } = await appIntl()
  const next = typeof params.next === 'string' ? params.next : null
  const destination = path(safeRedirectPath(next, '/'))

  return (
    <main>
      <h1>{t('app.signIn.title')}</h1>

      {params.verified === undefined ? null : <p role="status">{t('app.signIn.verified')}</p>}
      {params.email_changed === undefined ? null : (
        <p role="status">{t('app.signIn.emailChanged')}</p>
      )}
      {params.reset === undefined ? null : <p role="status">{t('app.signIn.reset')}</p>}

      <AuthForm
        action={authRoutePath('signIn')}
        fields={[
          { name: 'email', labelKey: 'app.auth.field.email', type: 'email', autoComplete: 'email' },
          {
            name: 'password',
            labelKey: 'app.auth.field.password',
            type: 'password',
            autoComplete: 'current-password',
          },
        ]}
        submitLabelKey="app.signIn.submit"
        redirectTo={destination}
      />

      <h2>{t('app.signIn.magicLink.title')}</h2>
      <AuthForm
        action={authRoutePath('magicLink')}
        fields={[
          {
            name: 'email',
            labelKey: 'app.auth.field.magicLinkEmail',
            type: 'email',
            autoComplete: 'email',
          },
        ]}
        hiddenValues={{ callbackURL: destination }}
        submitLabelKey="app.signIn.magicLink.submit"
        successMessageKey="app.signIn.magicLink.sent"
      />

      <p>
        <a href={path('/forgot-password')}>{t('app.signIn.links.forgotPassword')}</a> ·{' '}
        <a href={path('/verify-email')}>{t('app.signIn.links.unverified')}</a> ·{' '}
        <a href={path('/sign-up')}>{t('app.signIn.links.signUp')}</a>
      </p>
    </main>
  )
}
