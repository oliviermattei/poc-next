import { CONSENT_SETTINGS_SCREEN_PATH } from '@repo/module-consent'
import { ConsentSettingsCard } from '@repo/module-consent/presentation'
import { notFound, redirect } from 'next/navigation'

import { currentViewer } from '../../../../../lib/auth'
import { consent } from '../../../../../lib/consent'
import { appIntl } from '../../../../../lib/i18n'

/**
 * **La rubrique Cookies** des réglages (s62b) : la carte de consentement de
 * l'ancien écran Compte, **déplacée** telle quelle. Elle mène à l'écran public
 * de préférences (`/cookies`), qu'elle ne recopie pas : le réglage vit sur un
 * écran, pas dans deux formulaires qui divergeraient.
 *
 * Deux refus, et aucun ne nomme un module :
 *
 * | Qui | Ce qu'il obtient |
 * |---|---|
 * | le produit n'a pas de consentement | **404** — la rubrique n'existe pas |
 * | un visiteur anonyme | redirection vers la connexion, avec son retour |
 *
 * `consent.available` est une **donnée** rendue par le point de composition, la
 * même que celle qui conditionnait la carte sur l'écran Compte (F57).
 */
export default async function CookiesSettingsPage() {
  if (!consent.available) {
    notFound()
  }

  const { session } = await currentViewer()
  const { t, path } = await appIntl()

  if (session === null) {
    // Le chemin **interne** part dans `next` : c'est l'écran de connexion qui le
    // met dans la forme publique de sa locale, une seule fois.
    redirect(`${path('/sign-in')}?next=${encodeURIComponent(CONSENT_SETTINGS_SCREEN_PATH)}`)
  }

  return (
    <>
      <div className="min-w-0 space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">{t('app.settings.cookies.title')}</h2>
      </div>

      <ConsentSettingsCard intl={{ t, path }} />
    </>
  )
}
