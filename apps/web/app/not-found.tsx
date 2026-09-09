import { currentNonce } from '../lib/nonce'
import { AppShell } from './app-shell'
import { NotFoundScreen } from './not-found-screen'

/**
 * L'écran servi sur une URL qui ne correspond à **aucune** route.
 *
 * Elle n'appartient à aucun groupe — ni `(app)`, ni `(admin)` —, donc aucune
 * layout de groupe ne monte de châssis pour elle : celui-ci le monte lui-même,
 * sans quoi la page introuvable serait servie nue. Le `notFound()` levé
 * **dans** le groupe du produit, lui, est servi par `(app)/not-found.tsx`, qui
 * ne monte rien : sa layout l'a déjà fait.
 *
 * **C'est aussi ce que voit qui n'administre pas.** Un compte ordinaire qui
 * demande `/admin/users` reçoit 404 (`docs/security.md` §3), et le groupe
 * `(admin)` ne pose aucune layout : il obtient donc cet écran-ci, châssis du
 * produit compris — exactement ce qu'il verrait sur une adresse inventée. Le
 * back-office ne se laisse pas deviner par sa page d'erreur.
 */
export default async function NotFound() {
  const [nonce, screen] = await Promise.all([currentNonce(), NotFoundScreen()])

  // **La coquille est appelée, pas rendue en balise** : `AppShell` est un
  // composant asynchrone, et une balise `<AppShell>` suspendrait à l'intérieur
  // de l'arbre rendu. Appelée et attendue, elle rend un arbre déjà résolu — ce
  // que Next sert, et ce qu'un rendu synchrone sait mesurer.
  return await AppShell({ nonce, children: screen })
}
