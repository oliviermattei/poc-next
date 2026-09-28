import { MembersScreen } from '@repo/module-organizations/presentation'
import { notFound, redirect } from 'next/navigation'

import { currentViewer } from '../../../../../lib/auth'
import { appIntl } from '../../../../../lib/i18n'
import {
  MEMBERS_SCREEN_PATH,
  organizationRefusalKey,
  organizationRoutePath,
  organizations,
  ORGANIZATIONS_SCREEN_PATH,
} from '../../../../../lib/organizations'

/**
 * **La rubrique Membres** des réglages (s62b) : les membres de l'organisation
 * courante, leurs rôles, leur retrait, et les invitations. Issue de l'écran
 * unique des organisations ; l'organisation elle-même est dans la rubrique
 * Organisation (`../organization/page.tsx`).
 *
 * Trois refus, dans cet ordre, et aucun ne nomme un module :
 *
 * | Qui | Ce qu'il obtient |
 * |---|---|
 * | le produit n'a pas d'organisations | **404** — l'écran n'existe pas |
 * | un visiteur anonyme | redirection vers la connexion, avec son retour |
 * | un compte | son écran, et **seulement ses** organisations |
 *
 * Le premier se départage sur `organizations.available`, c'est-à-dire sur une
 * **donnée** rendue par le point de composition — la même discipline que la
 * racine du site, qui distingue accueil marketing et redirection sur
 * `sections.length` (`apps/web/AGENTS.md`).
 *
 * L'écran est protégé **côté serveur** : sans session il redirige, et la vue
 * qu'il lit est celle du compte de cette session-là, jamais d'un identifiant
 * reçu en paramètre (`docs/security.md` §3).
 *
 * `notFound()` plutôt qu'une page absente : le fichier de route existe toujours
 * sur le disque — c'est le même arbitrage que `legal/[document]`, dont la page
 * est servie ou non selon la configuration.
 */

export default async function MembersPage({
  searchParams,
}: {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  if (!organizations.available) {
    notFound()
  }

  const { session } = await currentViewer()
  const { t, path } = await appIntl()

  if (session === null) {
    // Le chemin **interne** part dans `next` : c'est l'écran de connexion qui le
    // met dans la forme publique de sa locale, une seule fois.
    redirect(`${path('/sign-in')}?next=${encodeURIComponent(MEMBERS_SCREEN_PATH)}`)
  }

  const view = await organizations.view(session.userId)
  const parameters = (await searchParams) ?? {}

  return (
    <MembersScreen
      view={view}
      intl={{ t }}
      actions={{
        invite: organizationRoutePath('invite'),
        resendInvitation: organizationRoutePath('resendInvitation'),
        revokeInvitation: organizationRoutePath('revokeInvitation'),
        removeMember: organizationRoutePath('removeMember'),
        setMemberRole: organizationRoutePath('setMemberRole'),
      }}
      viewerId={session.userId}
      organizationHref={path(ORGANIZATIONS_SCREEN_PATH)}
      refusalKey={organizationRefusalKey(parameters['error'])}
    />
  )
}
