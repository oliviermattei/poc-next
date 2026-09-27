import { headers } from 'next/headers'

import { NONCE_HEADER } from '../lib/security-headers'
import { AppShell } from './app-shell'
import { NotFoundScreen } from './not-found-screen'

/**
 * L'écran servi sur une URL qui ne mène à aucune route — son contenu, et
 * pourquoi il existe, sont dans `not-found-screen.tsx`.
 *
 * Il **rend le shell lui-même** (s60, ADR 071). Il est rendu par la frontière
 * racine, **au-dessus** des layouts de zone : il n'hérite donc plus de
 * l'`AppShell`, et sans lui toute URL inconnue perdrait la navigation, le
 * sélecteur de langue et la bannière de consentement. La contrepartie est
 * voulue : un `notFound()` levé dans la console ne rend **aucun** élément du
 * shell de la console (`e2e/admin.spec.ts` le mesure).
 */
export default async function NotFound() {
  const nonce = (await headers()).get(NONCE_HEADER)

  return (
    <AppShell nonce={nonce}>
      <NotFoundScreen />
    </AppShell>
  )
}
