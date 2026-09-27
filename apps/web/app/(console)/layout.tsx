import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'

import { admin } from '../../lib/admin'
import { currentViewer } from '../../lib/auth'
import { NONCE_HEADER } from '../../lib/security-headers'
import { ConsoleShell } from './console-shell'

/**
 * **La zone Console** (s60, ADR 070 et 071) : le back-office du superadmin.
 *
 * **La garde passe avant tout rendu.** Quatre refus, un seul statut — 404 —,
 * et aucun ne nomme de module :
 *
 * | Qui | Pourquoi |
 * |---|---|
 * | tout le monde, module `admin` coupé | la zone n'existe pas (`admin.available` est une donnée) |
 * | un visiteur anonyme | une redirection vers la connexion révélerait la zone |
 * | une session empruntée | un emprunt n'administre jamais, quel que soit le rôle (s37b1) |
 * | un compte qui n'est pas superadmin | 404 et jamais 403 (`docs/security.md` §3) |
 *
 * Elle **s'ajoute** à la garde de chaque lecture (`lib/admin.ts`), elle ne la
 * remplace pas : un écran reste gardé même rendu hors de ce layout. Le
 * `notFound()` levé ici est rendu par `app/not-found.tsx`, **au-dessus** de ce
 * layout — le 404 ne porte donc aucun élément du shell de la console.
 *
 * Aucun `loading.tsx` sous ce dossier : il ferait répondre 200 avant cette
 * décision (lacune « Chargement », s29).
 */
export default async function ConsoleLayout({ children }: { readonly children: ReactNode }) {
  // Le module coupé décide **avant** la session : aucune connexion n'est
  // ouverte pour refuser une zone qui n'existe pas.
  if (!admin.available) {
    notFound()
  }

  const { session, impersonatedBy } = await currentViewer()

  if (session === null || impersonatedBy !== null || !(await admin.isSuperadmin(session.userId))) {
    notFound()
  }

  // Le nonce est relu ici, comme le font les layouts des autres zones : le
  // shell rend les scripts non essentiels de s36.
  const nonce = (await headers()).get(NONCE_HEADER)

  return <ConsoleShell nonce={nonce}>{children}</ConsoleShell>
}
