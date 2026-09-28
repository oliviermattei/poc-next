import { Button, EmptyState, PageHeader } from '@repo/ui'
import { SearchXIcon } from 'lucide-react'

import { appIntl } from '../lib/i18n'

/**
 * L'écran servi sur une URL qui ne mène à aucune route.
 *
 * **Il est ici pour une raison de sécurité autant que de produit.** Sans ce
 * fichier, Next sert son composant intégré, qui émet quatre attributs `style`
 * et un `<style>` sans nonce : mesuré en revue de s45, deux violations de la
 * politique livrée sur une page qu'un visiteur atteint — et zéro sans la
 * politique. Un socle dont la page introuvable contredit sa propre politique
 * n'est pas livrable, et une console bruyante est précisément ce qui pousse
 * l'agent suivant à ajouter `'unsafe-inline'` (le mode d'échec dont l'ADR 012
 * met en garde). `e2e/security-headers.spec.ts` juge désormais le HTML servi
 * sur une URL inexistante comme sur une page existante.
 *
 * Rien d'inventé : `PageHeader` et `EmptyState` du design system, composés
 * exactement comme le tableau de bord vide de `app/(app)/app/page.tsx`. L'action
 * est dans la signature d'`EmptyState`, pas dans la bonne volonté de l'appelant
 * — « un état vide sans action est un écran cassé ».
 *
 * Le **contenu** seulement, jamais un gabarit (ADR 072). Deux sortes de
 * frontières le rendent : les frontières de zone
 * (`app/(site|auth|app|console)/not-found.tsx`), pour un `notFound()` levé par
 * une page, le rendent **sans** gabarit — le layout de leur zone l'entoure
 * déjà ; la frontière racine (`app/not-found.tsx`), qui ne sert que l'URL sans
 * route et le refus d'un layout de zone, l'entoure du gabarit Site (s61).
 * Séparé aussi pour que `tests/rendered-text.test.ts` le rende comme les autres
 * écrans — un composant serveur asynchrone imbriqué ne se rend pas hors de Next.
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
