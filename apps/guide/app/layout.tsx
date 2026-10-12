import type { ReactNode } from 'react'

/**
 * Racine transparente : la balise `<html>` et sa langue sont posées par
 * `app/[lang]/layout.tsx`, qui seul sait dans quelle langue la page est servie.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return children
}
