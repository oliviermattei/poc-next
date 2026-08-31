import {
  INVITATION_REFUSALS,
  ORGANIZATION_REFUSALS,
  refusalMessageKey,
} from '@repo/module-organizations'
import { OrganizationsScreen } from '@repo/module-organizations/presentation'
import { notFound, redirect } from 'next/navigation'
import { z } from 'zod'

import { currentViewer } from '../../lib/auth'
import { appIntl } from '../../lib/i18n'
import { organizationRoutePath, organizations } from '../../lib/organizations'

/**
 * L'écran des organisations.
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

/**
 * Le motif de refus rapporté par la redirection d'une route du module.
 *
 * Zod à **chaque** frontière (`docs/security.md` §4), y compris un paramètre
 * d'URL : un code inconnu — donc sans traduction — ferait tomber l'écran en 500
 * puisque aucune clé absente ne se replie (s09). L'énumération vient du module,
 * elle n'est pas recopiée ici.
 */
const REFUSAL = z.enum([...ORGANIZATION_REFUSALS, ...INVITATION_REFUSALS])

const refusalKeyOf = (value: string | string[] | undefined): string | null => {
  const parsed = REFUSAL.safeParse(value)

  return parsed.success ? refusalMessageKey(parsed.data) : null
}

export default async function OrganizationsPage({
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
    redirect(`${path('/sign-in')}?next=${encodeURIComponent('/organizations')}`)
  }

  const view = await organizations.view(session.userId)
  const parameters = (await searchParams) ?? {}

  return (
    <OrganizationsScreen
      view={view}
      intl={{ t }}
      actions={{
        create: organizationRoutePath('create'),
        switch: organizationRoutePath('switch'),
        update: organizationRoutePath('update'),
        invite: organizationRoutePath('invite'),
        resendInvitation: organizationRoutePath('resendInvitation'),
        revokeInvitation: organizationRoutePath('revokeInvitation'),
        removeMember: organizationRoutePath('removeMember'),
      }}
      viewerId={session.userId}
      refusalKey={refusalKeyOf(parameters['error'])}
    />
  )
}
