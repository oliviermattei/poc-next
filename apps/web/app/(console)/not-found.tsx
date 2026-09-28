import { NotFoundScreen } from '../not-found-screen'

/**
 * La 404 d'un `notFound()` levé par une **page** de la zone (s66, ADR 072) :
 * elle est rendue sous le layout de la zone, qui fournit déjà le shell — ce
 * fichier n'en rend donc aucun. Sans lui, la frontière racine
 * (`app/not-found.tsx`, qui rend le gabarit Site pour les URL sans route, s61) serait
 * rendue **dans** le layout de la zone : shell doublé.
 *
 * **Elle ne capte pas le refus de la garde du layout** : un `notFound()` levé
 * par `layout.tsx` remonte à la frontière du parent, placée au-dessus de ce
 * layout — la 404 d'un non-superadmin ne porte aucun élément du shell de la
 * console (`e2e/admin.spec.ts` le mesure). Seul le superadmin, sur un
 * identifiant inconnu, voit cette 404-ci, dans le shell de la console.
 */
export default function ConsoleNotFound() {
  return <NotFoundScreen />
}
