import { headers } from 'next/headers'

import { NONCE_HEADER } from '../lib/security-headers'
import { SiteTemplate } from './(site)/site-header'
import { NotFoundScreen } from './not-found-screen'

/**
 * La 404 **racine** — son contenu, et pourquoi il existe, sont dans
 * `not-found-screen.tsx`.
 *
 * **Elle ne sert que deux cas** (ADR 072) : une URL qui ne mène à aucune route,
 * et un `notFound()` levé par un **layout** de zone (la garde de la console),
 * qui remonte à la frontière du segment parent. Dans les deux cas aucun layout
 * de zone ne l'entoure : elle rend donc son gabarit elle-même, celui du **Site**
 * (s61) — une 404 n'a pas à ressembler à l'application, ni à la console.
 *
 * Un `notFound()` levé par une **page** ne passe pas par ici : il est rendu par
 * la frontière de sa zone (`app/(site|auth|app|console)/not-found.tsx`), sous
 * le layout de la zone, qui fournit déjà le gabarit. `e2e/not-found-zones.spec.ts`
 * compte un gabarit par 404, et la 404 d'un non-superadmin sur la console ne
 * porte aucun élément du shell de la console (`e2e/admin.spec.ts`).
 */
export default async function NotFound() {
  const nonce = (await headers()).get(NONCE_HEADER)

  return (
    <SiteTemplate nonce={nonce}>
      <NotFoundScreen />
    </SiteTemplate>
  )
}
