import { safeRedirectPath } from '../../../lib/auth'
import { appIntl } from '../../../lib/i18n'

/**
 * **Le rebond du retour de fournisseur**, et la raison pour laquelle il existe.
 *
 * Le cookie de session est `SameSite=Strict` (`docs/security.md` §1). Le rappel
 * OAuth le pose correctement, mais la redirection qui suit appartient encore à
 * une chaîne de navigation **venue d'un autre site** : le navigateur n'envoie
 * pas un cookie `Strict` sur cette requête-là, et la destination s'affiche
 * déconnectée alors que la session existe. Le défaut ne se voit dans aucun test
 * de nœud — il n'existe que dans un navigateur.
 *
 * Cette page publique ne lit rien du compte et rebondit d'elle-même : la
 * seconde navigation est initiée par **notre** document, donc same-site, donc
 * porteuse du cookie. Le rebond passe par un `meta http-equiv="refresh"`, qui
 * ne demande pas de JavaScript ; React 19 remonte cette balise dans l'en-tête.
 *
 * La destination est **revalidée ici** par la même liste blanche que l'écran de
 * connexion : elle arrive dans l'URL, donc elle n'est jamais de confiance
 * (`docs/security.md` §4).
 */
export default async function OAuthReturnPage({
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
      <meta httpEquiv="refresh" content={`0; url=${destination}`} />
      <h1>{t('app.oauthReturn.title')}</h1>
      <p>{t('app.oauthReturn.description')}</p>
      <p>
        <a href={destination}>{t('app.oauthReturn.continue')}</a>
      </p>
    </main>
  )
}
