import { SCREEN_DESCRIPTION_KEY, SCREEN_TITLE_KEY } from '@repo/module-consent'
import { ConsentPreferences } from '@repo/module-consent/presentation'
import { PageHeader } from '@repo/ui'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { consent, currentConsent } from '../../lib/consent'
import { appIntl } from '../../lib/i18n'

/**
 * L'écran de préférences de cookies — **la destination des deux points
 * d'accès** (finding F57 de la revue des stories).
 *
 * Il est servi par l'application et **public** : un visiteur anonyme a
 * exactement le même droit qu'un compte à retirer son consentement. Le lier au
 * module `marketing` — donc au site public — le ferait disparaître sur une
 * installation qui coupe ce module tout en gardant un script d'analyse, c'est
 * la non-conformité que ce module existe pour empêcher.
 *
 * Module `consent` coupé, l'écran répond **404** : le même arbitrage que
 * `/organizations` et `/legal/<slug>`, et il se départage sur une **donnée**
 * (`consent.available`), jamais sur un identifiant de module écrit ici.
 *
 * Aucun `searchParams` n'est lu : le retour de succès est l'état affiché — le
 * badge de chaque catégorie porte la décision retenue —, pas un drapeau d'URL
 * qu'un partage de lien rendrait faux.
 */
export async function generateMetadata(): Promise<Metadata> {
  if (!consent.available) {
    // Module coupé : ses clés ont disparu du catalogue avec lui, et en demander
    // une ferait tomber la page (aucune traduction ne se replie sur sa clé).
    return {}
  }

  const { t } = await appIntl()

  return { title: t(SCREEN_TITLE_KEY), description: t(SCREEN_DESCRIPTION_KEY) }
}

export default async function CookiesPage() {
  if (!consent.available) {
    notFound()
  }

  const { t, path } = await appIntl()
  const state = await currentConsent()

  return (
    <>
      <PageHeader title={t(SCREEN_TITLE_KEY)} description={t(SCREEN_DESCRIPTION_KEY)} />
      <ConsentPreferences state={state} intl={{ t, path }} />
    </>
  )
}
