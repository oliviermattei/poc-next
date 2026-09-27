import { headers } from 'next/headers'
import type { ReactNode } from 'react'

import { NONCE_HEADER } from '../../lib/security-headers'
import { AppShell } from '../app-shell'

/**
 * La zone **Hors zone** : les écrans de l'authentification, servis avant
 * qu'une session existe.
 *
 * En s60 il rend l'`AppShell` **à l'identique** des autres zones (ADR 071) : le
 * gabarit propre de chaque zone est le travail de s61. Le nonce est relu ici,
 * comme le layout racine le lisait : le shell rend les scripts non essentiels de
 * s36, et `script-src` porte `'strict-dynamic'` — un `<script src>` sans nonce
 * est refusé, même depuis notre propre origine.
 */
export default async function AuthLayout({ children }: { readonly children: ReactNode }) {
  const nonce = (await headers()).get(NONCE_HEADER)

  return <AppShell nonce={nonce}>{children}</AppShell>
}
