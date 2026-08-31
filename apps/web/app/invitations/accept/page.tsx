import {
  ACCEPT_REFUSALS,
  refusalForStatus,
  refusalMessageKey,
} from '@repo/module-organizations'
import { InvitationScreen } from '@repo/module-organizations/presentation'
import { notFound } from 'next/navigation'
import { z } from 'zod'

import { currentViewer } from '../../../lib/auth'
import { appIntl } from '../../../lib/i18n'
import {
  INVITATION_SCREEN_PATH,
  organizationRoutePath,
  organizations,
} from '../../../lib/organizations'

/**
 * L'écran d'atterrissage d'un lien d'invitation.
 *
 * Il est servi à un visiteur **anonyme comme connecté** — c'est le critère 2 :
 * « par un nouvel utilisateur, elle enchaîne sur l'inscription puis l'ajoute ».
 * Un anonyme y voit le nom de l'organisation et deux chemins, connexion ou
 * inscription ; la connexion emporte le retour vers cette même URL, jeton
 * compris, si bien qu'il retombe ici une fois son compte créé et vérifié.
 *
 * **Rien n'est accepté en `GET`.** L'acceptation est un `<form method="post">` :
 * un aperçu de lien — client de messagerie, antivirus, proxy — suit les `GET` et
 * consommerait le jeton à usage unique avant l'invité.
 *
 * Module coupé, l'écran répond **404** : le même arbitrage que `/organizations`,
 * et `organizations.available` est une **donnée**, pas un `if (module activé)`.
 */

/**
 * Le jeton reçu en paramètre d'URL.
 *
 * Zod à **chaque** frontière (`docs/security.md` §4), y compris un paramètre
 * d'URL : une chaîne sans borne serait hachée avant d'être jugée.
 */
const TOKEN = z.string().trim().min(1).max(256)

/**
 * Le motif de refus rapporté par la route d'acceptation.
 *
 * L'énumération est **celle de l'écran d'acceptation**, pas la liste entière des
 * refus du module : un code venu d'un autre parcours n'affiche donc rien ici.
 * Une clé absente ferait tomber l'écran en 500, puisque aucune clé manquante ne
 * se replie (s09).
 */
const REFUSAL = z.enum(ACCEPT_REFUSALS)

export default async function AcceptInvitationPage({
  searchParams,
}: {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  if (!organizations.available) {
    notFound()
  }

  const parameters = (await searchParams) ?? {}
  const parsedToken = TOKEN.safeParse(parameters['token'])
  const token = parsedToken.success ? parsedToken.data : ''

  const [{ session }, { t, path }] = await Promise.all([currentViewer(), appIntl()])
  const invitation = token === '' ? null : await organizations.invitation(token)
  const parsedRefusal = REFUSAL.safeParse(parameters['error'])

  /**
   * Le motif affiché, dans cet ordre :
   *
   * 1. celui que la route vient de rapporter — c'est le seul qui puisse dire
   *    « ce lien a été envoyé à une autre adresse », que l'état de la ligne ne
   *    dit pas ;
   * 2. « lien inconnu » quand le jeton ne mène nulle part. L'écran ne distingue
   *    pas « mal formé » d'« inconnu » : la distinction n'apprendrait rien à qui
   *    tient le lien ;
   * 3. **le statut de la ligne**, sans quoi rouvrir un lien déjà accepté ou
   *    révoqué n'afficherait rien du tout — mesuré au navigateur, l'écran
   *    restait muet.
   */
  const statusRefusal = invitation === null ? null : refusalForStatus(invitation.status)
  const refusalKey = parsedRefusal.success
    ? refusalMessageKey(parsedRefusal.data)
    : invitation === null
      ? refusalMessageKey('invitation_unknown')
      : statusRefusal === null
        ? null
        : refusalMessageKey(statusRefusal)

  // Le retour de connexion est le chemin **interne** de cet écran, jeton
  // compris : c'est l'écran de connexion qui le met dans la forme publique de sa
  // locale, une seule fois, et sa règle de destination le juge.
  const back = `${INVITATION_SCREEN_PATH}?token=${encodeURIComponent(token)}`

  return (
    <main>
      <InvitationScreen
        invitation={invitation}
        intl={{ t }}
        token={token}
        acceptAction={organizationRoutePath('acceptInvitation')}
        signedIn={session !== null}
        signInHref={`${path('/sign-in')}?next=${encodeURIComponent(back)}`}
        signUpHref={path('/sign-up')}
        homeHref={path('/')}
        refusalKey={refusalKey}
      />
    </main>
  )
}
