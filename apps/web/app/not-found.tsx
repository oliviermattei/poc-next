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
 * exactement comme le tableau de bord vide de `app/page.tsx`. L'action est dans
 * la signature d'`EmptyState`, pas dans la bonne volonté de l'appelant — « un
 * état vide sans action est un écran cassé ».
 *
 * Cet écran est **rendu dans le shell** : il hérite donc de la navigation, du
 * thème et du sélecteur de langue, comme tous les autres.
 */
export default async function NotFound() {
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
