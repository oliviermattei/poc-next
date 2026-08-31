'use client'

import { Button, EmptyState, PageHeader } from '@repo/ui'
import { GeistMono } from 'geist/font/mono'
import { GeistSans } from 'geist/font/sans'
import { TriangleAlertIcon } from 'lucide-react'

import { fallbackLocale, fallbackText } from '../lib/fallback-text'
import './globals.css'

/**
 * L'écran de dernier recours : une erreur que plus aucune frontière ne rattrape.
 *
 * **Même motif que `not-found.tsx`, et même raison de sécurité.** Sans ce
 * fichier, Next sert son composant intégré — celui-là même dont la revue de s45
 * a mesuré quatre attributs `style` et un `<style>` sans nonce sur la page 404,
 * donc deux violations de la politique livrée. La revue n'avait pas pu
 * provoquer une erreur serveur : le composant est le même, la conclusion en
 * était **déduite**. Elle est mesurée ici (voir le rapport de revue).
 *
 * Trois contraintes viennent de Next, pas d'un choix (docs `error.md`, §Global
 * Error) : ce fichier doit être un composant **client**, il doit rendre ses
 * propres `<html>` et `<body>` puisqu'il remplace `app/layout.tsx`, et il
 * n'accepte aucun export `metadata` — d'où le `<title>` rendu par React.
 *
 * Ce qu'il n'a donc pas, et qui n'est pas un oubli :
 *
 * - **pas de shell** : `AppShell` résout la session et le registre, c'est-à-dire
 *   ce qui vient peut-être d'échouer ;
 * - **pas de thème** : `next-themes` vit dans le layout remplacé. Next le dit
 *   explicitement pour cet écran. L'écran s'affiche donc dans le thème clair ;
 * - **pas de locale de requête** : le texte vient du catalogue de secours
 *   (`lib/fallback-text.ts`), dans la langue du site.
 *
 * Ce qu'il a, et qui est le point : les styles de l'application — servis en
 * `<link>` depuis `/_next/static`, donc couverts par `style-src 'self'` — et
 * aucun style en ligne.
 */
export default function GlobalError({ retry }: { readonly retry: () => void }) {
  return (
    <html lang={fallbackLocale} className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <title>{fallbackText('app.error.title')}</title>
        <main className="mx-auto flex min-h-svh w-full max-w-4xl min-w-0 flex-col justify-center gap-6 px-4 py-6 md:px-8 md:py-10">
          <PageHeader title={fallbackText('app.error.title')} />
          <EmptyState
            icon={<TriangleAlertIcon />}
            title={fallbackText('app.error.empty.title')}
            description={fallbackText('app.error.empty.description')}
            action={
              <Button type="button" onClick={() => retry()}>
                {fallbackText('app.error.empty.action')}
              </Button>
            }
          />
        </main>
      </body>
    </html>
  )
}
