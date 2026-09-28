import { headers } from 'next/headers'
import type { ReactNode } from 'react'

import { NONCE_HEADER } from '../../lib/security-headers'
import { SiteTemplate } from './site-header'

/**
 * La zone **Site** : les pages publiques du site (accueil, contenus, tarifs,
 * pages légales).
 *
 * Son gabarit est l'en-tête du site (s61, ADR 073) — **sans** barre latérale,
 * **sans** pied de page (chaque page rend le sien). Le nonce est relu ici,
 * comme le layout racine le lisait : le gabarit rend les scripts non essentiels
 * de s36, et `script-src` porte `'strict-dynamic'` — un `<script src>` sans
 * nonce est refusé, même depuis notre propre origine.
 */
export default async function SiteLayout({ children }: { readonly children: ReactNode }) {
  const nonce = (await headers()).get(NONCE_HEADER)

  return <SiteTemplate nonce={nonce}>{children}</SiteTemplate>
}
