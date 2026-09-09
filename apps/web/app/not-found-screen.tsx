import { Button, EmptyState, PageHeader } from '@repo/ui'
import { SearchXIcon } from 'lucide-react'

import { appIntl } from '../lib/i18n'

/**
 * **Le contenu de la page introuvable**, sans châssis — écrit une fois, monté
 * à deux endroits.
 *
 * **Il est ici pour une raison de sécurité autant que de produit.** Sans écran
 * à nous, Next sert son composant intégré, qui émet quatre attributs `style` et
 * un `<style>` sans nonce : mesuré en revue de s45, deux violations de la
 * politique livrée sur une page qu'un visiteur atteint. Un socle dont la page
 * introuvable contredit sa propre politique n'est pas livrable, et une console
 * bruyante est précisément ce qui pousse l'agent suivant à ajouter
 * `'unsafe-inline'` (le mode d'échec dont l'ADR 012 met en garde).
 *
 * Rien d'inventé : `PageHeader` et `EmptyState` du design system. L'action est
 * dans la signature d'`EmptyState`, pas dans la bonne volonté de l'appelant —
 * « un état vide sans action est un écran cassé ».
 *
 * ## Pourquoi il est séparé du fichier de route (s60)
 *
 * Depuis que la racine ne monte plus de coquille, **deux** chemins mènent à cet
 * écran, et ils n'ont pas la même enveloppe :
 *
 * | Chemin | Enveloppe | Fichier |
 * |---|---|---|
 * | une URL qui ne correspond à **aucune** route | la racine seule | `app/not-found.tsx`, qui monte le châssis |
 * | un `notFound()` levé **dans** `(app)` | la layout du groupe, donc le châssis | `app/(app)/not-found.tsx`, qui ne monte rien |
 *
 * **Mesuré, pas déduit** : la première version montait le châssis dans le seul
 * fichier racine, et `pnpm test:socle` a rendu deux coquilles imbriquées sur
 * `/organizations` (module coupé, donc `notFound()` levé dans le groupe) — deux
 * navigations, deux bandeaux d'emprunt de session. Playwright l'a vu avant
 * qu'un humain ne le voie.
 */
export async function NotFoundScreen() {
  const { t, path } = await appIntl()

  return (
    <>
      <PageHeader title={t('app.notFound.title')} />
      <EmptyState
        icon={<SearchXIcon />}
        title={t('app.notFound.empty.title')}
        description={t('app.notFound.empty.description')}
        action={
          <Button asChild>
            <a href={path('/')}>{t('app.notFound.empty.action')}</a>
          </Button>
        }
      />
    </>
  )
}
