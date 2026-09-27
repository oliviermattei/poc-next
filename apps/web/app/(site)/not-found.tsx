import { NotFoundScreen } from '../not-found-screen'

/**
 * La 404 d'un `notFound()` levé par une **page** de la zone (s66, ADR 072) :
 * elle est rendue sous le layout de la zone, qui fournit déjà le shell — ce
 * fichier n'en rend donc aucun. Sans lui, la frontière racine
 * (`app/not-found.tsx`, qui rend l'`AppShell` pour les URL sans route) serait
 * rendue **dans** le layout de la zone : shell doublé.
 */
export default function SiteNotFound() {
  return <NotFoundScreen />
}
