import { Alert, Card, CardContent, cn, PageHeader, Separator } from '@repo/ui'

import { authRoutePath, readOAuthFailureClass, safeRedirectPath } from '../../lib/auth'
import { appIntl } from '../../lib/i18n'
import { AuthForm } from '../auth-form'
import { OAuthProviderButtons } from '../oauth-buttons'
import { PasskeyButton } from './passkey-button'

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
 *
 * **Une carte, deux moyens** (s46). Le mot de passe, la passkey et les
 * fournisseurs mènent à la même session : ils tiennent dans la même carte,
 * séparés par le `Separator` du système. Le lien de connexion est en dessous,
 * après le séparateur, parce qu'il ne se termine pas ici — il se termine dans
 * une boîte email.
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

/**
 * Les classes d'un lien secondaire, écrites une fois pour les trois liens de
 * bas d'écran. Ce sont celles de `CookieBanner` : même rang, même traitement.
 */
const LINK_CLASSNAME = cn(
  'rounded-sm underline underline-offset-4',
  'hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
)

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
  // La destination de l'écran de vérification, écrite **une fois** : le
  // formulaire de mot de passe et le bouton de passkey mènent au même endroit
  // quand un second facteur attend (ADR 031).
  const twoFactorDestination = `${path('/two-factor')}?next=${encodeURIComponent(
    safeRedirectPath(next, '/'),
  )}`

  return (
    <main className="mx-auto flex w-full max-w-md min-w-0 flex-col gap-6">
      <PageHeader title={t('app.signIn.title')} />

      {/*
        Les trois retours d'un parcours qui vient d'aboutir ailleurs. `success`
        et `role="status"` : une confirmation ne coupe pas la lecture d'un
        lecteur d'écran, contrairement à `role="alert"`.
      */}
      {params.verified === undefined ? null : (
        <Alert variant="success" role="status">
          {t('app.signIn.verified')}
        </Alert>
      )}
      {params.email_changed === undefined ? null : (
        <Alert variant="success" role="status">
          {t('app.signIn.emailChanged')}
        </Alert>
      )}
      {params.reset === undefined ? null : (
        <Alert variant="success" role="status">
          {t('app.signIn.reset')}
        </Alert>
      )}

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

      <Card className="min-w-0">
        <CardContent className="flex min-w-0 flex-col gap-6">
          {/*
            La passkey en premier : c'est le moyen le plus rapide quand il est
            disponible, et le placer en bas en ferait un dernier recours. Aucune
            adresse n'est demandée — le point d'entrée du serveur ne prend aucun
            paramètre (`docs/security.md` §7). Le bouton n'est rendu que si le
            navigateur sait faire ; sinon, tout ce qui suit reste servi.
          */}
          <PasskeyButton
            optionsAction={authRoutePath('passkeyAuthenticateOptions')}
            verifyAction={authRoutePath('passkeyAuthenticate')}
            destination={destination}
            twoFactorDestination={twoFactorDestination}
          />

          <OAuthProviderButtons next={next === null ? undefined : safeRedirectPath(next, '/')} />

          <AuthForm
            action={authRoutePath('signIn')}
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
                autoComplete: 'current-password',
              },
            ]}
            submitLabelKey="app.signIn.submit"
            redirectTo={destination}
            // La destination est **transportée** jusqu'à l'écran de
            // vérification : le second facteur n'est pas une escale qui fait
            // oublier où on allait. Elle repasse par la même règle de liste
            // blanche là-bas — cet écran n'est pas le seul à filtrer.
            twoFactorRedirectTo={twoFactorDestination}
          />

          <Separator />

          <div className="flex min-w-0 flex-col gap-4">
            {/*
              `h2` du **document**, à la taille d'un titre de sous-section
              (`h3` du design system, `text-xl`) : c'est une section de la
              carte, pas une seconde page. `/two-factor` écrit son second
              formulaire exactement ainsi.
            */}
            <h2 className="text-xl font-semibold">{t('app.signIn.magicLink.title')}</h2>
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
          </div>
        </CardContent>
      </Card>

      <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <a className={LINK_CLASSNAME} href={path('/forgot-password')}>
          {t('app.signIn.links.forgotPassword')}
        </a>
        <a className={LINK_CLASSNAME} href={path('/verify-email')}>
          {t('app.signIn.links.unverified')}
        </a>
        <a className={LINK_CLASSNAME} href={path('/sign-up')}>
          {t('app.signIn.links.signUp')}
        </a>
      </p>
    </main>
  )
}
