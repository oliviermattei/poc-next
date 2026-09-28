import { headers } from 'next/headers'
import type { ReactNode } from 'react'

import { NONCE_HEADER } from '../../lib/security-headers'
import { AppShell } from '../app-shell'

/**
 * La zone **Application** : les écrans du produit, derrière une session.
 *
 * Son gabarit est l'`AppShell` (s61) : barre latérale de la surface `app`,
 * barre du haut, menu de compte. Le nonce est relu ici, comme le layout racine
 * le lisait : le shell rend les scripts non essentiels de s36, et `script-src`
 * porte `'strict-dynamic'` — un `<script src>` sans nonce est refusé, même
 * depuis notre propre origine.
 */
export default async function ApplicationLayout({ children }: { readonly children: ReactNode }) {
  const nonce = (await headers()).get(NONCE_HEADER)

  return <AppShell nonce={nonce}>{children}</AppShell>
}
