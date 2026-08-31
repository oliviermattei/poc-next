import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui'

import type { InvitationPreview } from '../application/organization-use-cases'
import { ORGANIZATIONS_KEYS as K } from '../domain/message-keys'
import type { OrganizationsIntl } from './organizations-intl'

/**
 * L'écran d'atterrissage d'un lien d'invitation.
 *
 * **Le lien ne déclenche rien en `GET`.** L'acceptation est une soumission, et
 * c'est le point qui compte : un aperçu de lien — client de messagerie,
 * antivirus, proxy — suit les `GET`, et consommerait le jeton à usage unique
 * avant que l'invité ne l'ouvre. C'est la même raison qui fait de la bascule
 * d'organisation une soumission et non un lien (`OrgSwitcher`).
 *
 * Quatre états, un seul rendu à la fois :
 *
 * | Ce qui arrive | Ce qui s'affiche |
 * |---|---|
 * | lien vivant, visiteur connecté | le nom de l'organisation et le bouton |
 * | lien vivant, visiteur anonyme | le nom, et deux liens : connexion, inscription |
 * | lien inutilisable | une alerte avec **le motif**, et un retour |
 * | aucun jeton | la même alerte |
 *
 * Le motif est affiché tel quel : qui lit ce message détient déjà le lien, donc
 * l'email. Le refus qui doit rester indistinguable est celui d'une **adresse**
 * (`docs/security.md` §7), et il l'est ailleurs — inviter ne dit jamais si un
 * compte existe.
 */
export interface InvitationScreenProps {
  /** Ce que le module sait de l'invitation, ou `null` si le lien ne mène nulle part. */
  readonly invitation: InvitationPreview | null
  readonly intl: OrganizationsIntl
  /** Le jeton, reposté tel quel : c'est lui qui autorise, et rien d'autre. */
  readonly token: string
  /** L'URL de la route d'acceptation, résolue par l'application. */
  readonly acceptAction: string
  /** `null` quand personne n'est connecté : l'écran propose alors de le devenir. */
  readonly signedIn: boolean
  readonly signInHref: string
  readonly signUpHref: string
  readonly homeHref: string
  /** La clé de catalogue du refus, ou `null`. Validée par l'écran appelant. */
  readonly refusalKey: string | null
}

export function InvitationScreen({
  invitation,
  intl,
  token,
  acceptAction,
  signedIn,
  signInHref,
  signUpHref,
  homeHref,
  refusalKey,
}: InvitationScreenProps) {
  const usable = invitation !== null && invitation.status === 'pending'

  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle>
          {usable
            ? intl.t(K.acceptTitle, { organization: invitation.organizationName })
            : intl.t(K.acceptRefusedTitle)}
        </CardTitle>
        {usable ? <CardDescription>{intl.t(K.acceptDescription)}</CardDescription> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {refusalKey === null ? null : (
          <Alert variant="destructive" role="alert">
            {intl.t(refusalKey)}
          </Alert>
        )}

        {usable && signedIn ? (
          <form
            method="post"
            action={acceptAction}
            aria-label={intl.t(K.acceptTitle, { organization: invitation.organizationName })}
          >
            {/* Le jeton **est** l'autorisation : il est reposté, jamais relu
                d'un état serveur, et la route le compare sous sa forme hachée. */}
            <input type="hidden" name="token" value={token} />
            <Button type="submit">{intl.t(K.acceptSubmit)}</Button>
          </form>
        ) : null}

        {usable && !signedIn ? (
          <>
            <p className="text-sm text-muted-foreground">{intl.t(K.acceptAnonymous)}</p>
            <div className="flex flex-wrap items-center gap-3">
              <Button asChild>
                <a href={signInHref}>{intl.t(K.acceptSignIn)}</a>
              </Button>
              <Button asChild variant="ghost">
                <a href={signUpHref}>{intl.t(K.acceptSignUp)}</a>
              </Button>
            </div>
          </>
        ) : null}

        {usable ? null : (
          <div>
            <Button asChild variant="ghost">
              <a href={homeHref}>{intl.t(K.acceptBack)}</a>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
