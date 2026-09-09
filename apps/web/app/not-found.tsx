import { Button, EmptyState, PageHeader } from '@repo/ui'
import { SearchXIcon } from 'lucide-react'

import { appIntl } from '../lib/i18n'
import { currentNonce } from '../lib/nonce'
import { AppShell } from './app-shell'

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
 * Cet écran **monte le châssis du produit lui-même**, et c'est le prix du
 * découpage en deux surfaces : la racine ne monte plus de coquille, et une URL
 * qui ne mène à aucune route n'appartient à aucun groupe — ni `(app)`, ni
 * `(admin)`. Sans ce montage, la page introuvable serait servie nue.
 *
 * **C'est aussi ce que voit qui n'administre pas.** Un compte ordinaire qui
 * demande `/admin/users` reçoit 404 (`docs/security.md` §3), donc cet écran-ci :
 * exactement ce qu'il verrait sur une adresse inventée, châssis du produit
 * compris. Le back-office ne se laisse pas deviner par sa page d'erreur.
 */
export default async function NotFound() {
  const [{ t, path }, nonce] = await Promise.all([appIntl(), currentNonce()])

  // **La coquille est appelée, pas rendue en balise**, et c'est délibéré :
  // `AppShell` est un composant asynchrone, et une balise `<AppShell>` posée
  // ici suspendrait à l'intérieur de l'arbre rendu. Appelée et attendue, elle
  // rend un arbre déjà résolu — ce que Next sert, et ce qu'un rendu synchrone
  // sait mesurer.
  return await AppShell({
    nonce,
    children: (
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
    ),
  })
}
