import type { ReactNode } from 'react'

import { currentNonce } from '../../lib/nonce'
import { AppShell } from '../app-shell'

/**
 * Le châssis du **produit** : tout ce qui n'est pas le back-office.
 *
 * Il est ici, et non à la racine, parce que la racine sert deux surfaces qui
 * n'ont pas le même public. Une layout enfant ne sait pas défaire ce que sa
 * racine a monté : mettre `AppShell` en haut obligerait le back-office à vivre
 * dedans, ou à le masquer par une condition — c'est-à-dire à dépendre d'un
 * `if` que personne ne mesure. Deux groupes de routes, deux châssis, aucune
 * condition.
 *
 * **Le nonce est relu ici**, à l'en-tête que le proxy pose. C'est la même
 * valeur que la racine lit pour `InlineStyleNonce` : elle vient d'une seule
 * écriture, en amont de la requête, et deux lectures d'un en-tête immuable ne
 * peuvent pas diverger. Le faire descendre en propriété depuis la racine
 * l'obligerait à connaître ce que ses enfants rendent.
 */
export default async function ProductLayout({ children }: { readonly children: ReactNode }) {
  const nonce = await currentNonce()

  return <AppShell nonce={nonce}>{children}</AppShell>
}
