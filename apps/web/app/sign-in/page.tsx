import { Alert } from '@repo/ui'

import { authRoutePath, readOAuthFailureClass, safeRedirectPath } from '../../lib/auth'
import { appIntl } from '../../lib/i18n'
import { AuthForm } from '../auth-form'
import { OAuthProviderButtons } from '../oauth-buttons'

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
/**
 * Les deux seuls messages qu'un retour de fournisseur en échec peut produire,
 * **par clé entière** : une clé composée échapperait au contrôle d'existence
 * des clés dans chaque locale (s09).
 */
const OAUTH_ERROR_KEYS = {
  denied: 'app.auth.oauth.error.denied',
  failed: 'app.auth.oauth.error.failed',
} as const

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const { t, path } = await appIntl()
  const next = typeof params.next === 'string' ? params.next : null
  const destination = path(safeRedirectPath(next, '/'))
  // La classe d'un refus est **relue**, jamais recalculée : la route a déjà
  // replié tous les codes de la bibliothèque avant que le navigateur ne voie
  // l'URL. Un paramètre inventé (`?oauth=account_not_linked`) retombe donc sur
  // l'échec générique, au lieu de renseigner un visiteur sur l'existence d'un
  // compte (`docs/security.md` §7).
  const oauthFailure = params.oauth === undefined ? null : readOAuthFailureClass(params.oauth)

  return (
    <main>
      <h1>{t('app.signIn.title')}</h1>

      {params.verified === undefined ? null : <p role="status">{t('app.signIn.verified')}</p>}
      {params.email_changed === undefined ? null : (
        <p role="status">{t('app.signIn.emailChanged')}</p>
      )}
      {params.reset === undefined ? null : <p role="status">{t('app.signIn.reset')}</p>}

      {/*
        Le refus d'un retour de fournisseur, en **deux messages et pas plus**.
        La classe vient de la règle du module — la même que la route applique —,
        si bien qu'un paramètre inventé (`?oauth=account_not_linked`) retombe sur
        l'échec générique au lieu de renseigner un visiteur sur l'existence d'un
        compte (`docs/security.md` §7).
      */}
      {oauthFailure === null ? null : (
        <Alert variant="destructive" role="alert">
          {t(OAUTH_ERROR_KEYS[oauthFailure])}
        </Alert>
      )}

      <OAuthProviderButtons next={next === null ? undefined : safeRedirectPath(next, '/')} />

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
        // La destination est **transportée** jusqu'à l'écran de vérification :
        // le second facteur n'est pas une escale qui fait oublier où on allait.
        // Elle repasse par la même règle de liste blanche là-bas — cet écran
        // n'est pas le seul à filtrer.
        twoFactorRedirectTo={`${path('/two-factor')}?next=${encodeURIComponent(
          safeRedirectPath(next, '/'),
        )}`}
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
