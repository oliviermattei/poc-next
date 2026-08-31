import { Button, Separator } from '@repo/ui'
import { useTranslations } from 'next-intl'

import { authRoutePath, oauthProviders } from '../lib/auth'

/**
 * Les boutons de connexion par fournisseur externe (s12).
 *
 * **Un formulaire par fournisseur, et pas une ligne de JavaScript.** La route
 * du module répond une redirection 302 vers le fournisseur : le bouton
 * fonctionne donc avant l'hydratation, contrairement aux formulaires
 * d'identifiants qui, eux, doivent attendre React (`useHydrated`). La
 * différence n'est pas un oubli : ces formulaires **n'envoient aucun secret**,
 * il n'y a rien à perdre dans une URL si le navigateur les soumet nativement.
 *
 * `method="post"` reste écrit en toutes lettres, comme partout
 * (`docs/security.md` §5, règle de lint).
 *
 * Le composant est **synchrone** : il lit ses textes par `useTranslations`,
 * comme les composants du shell, et non par `appIntl()`. Un composant serveur
 * asynchrone imbriqué dans un écran suspendrait le rendu statique, et le filet
 * des textes rendus (`tests/rendered-text.test.ts`) ne pourrait plus le voir.
 *
 * Aucun fournisseur configuré : le composant ne rend **rien**, séparateur
 * compris. Il n'y a pas de bouton masqué — il n'y a pas de bouton.
 */
export interface OAuthProviderButtonsProps {
  /** Destination interne après connexion, déjà filtrée par l'écran appelant. */
  readonly next?: string
}

/**
 * Les libellés, **par clé entière**.
 *
 * Écrites en toutes lettres et non composées (`app.auth.oauth.provider.` + id) :
 * une clé construite par concaténation échappe au contrôle qui vérifie que
 * chaque clé citée existe dans **chaque** locale livrée (s09), et le fragment
 * laissé en littéral est exactement ce que le détecteur de texte en dur refuse.
 */
const PROVIDER_LABEL_KEYS = {
  google: 'app.auth.oauth.provider.google',
  github: 'app.auth.oauth.provider.github',
  local: 'app.auth.oauth.provider.local',
} as const

export function OAuthProviderButtons({ next }: OAuthProviderButtonsProps) {
  const providers = oauthProviders()
  const t = useTranslations()

  if (providers.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col gap-3">
      {providers.map((provider) => (
        <form key={provider} method="post" action={authRoutePath('signInSocial')}>
          {next === undefined ? null : <input type="hidden" name="next" value={next} />}
          <input type="hidden" name="provider" value={provider} />
          <Button type="submit" variant="outline" className="w-full">
            {t('app.auth.oauth.continueWith', { provider: t(PROVIDER_LABEL_KEYS[provider]) })}
          </Button>
        </form>
      ))}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <Separator className="flex-1" />
        {t('app.auth.oauth.separator')}
        <Separator className="flex-1" />
      </div>
    </div>
  )
}
