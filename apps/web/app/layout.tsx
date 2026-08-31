import { ThemeProvider } from '@repo/ui'
import { GeistMono } from 'geist/font/mono'
import { GeistSans } from 'geist/font/sans'
import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'

import { AppShell } from './app-shell'
import './globals.css'

export const metadata: Metadata = {
  title: 'Application',
  description: 'Application',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

/**
 * La racine de l'application : polices, thème, shell.
 *
 * **Les polices sont servies par l'application** (`next/font` les copie dans
 * l'artefact de build). Aucune requête vers un domaine externe : une police
 * servie par un CDN serait un script tiers, donc soumise au registre de
 * consentement (s36), et elle ferait fuiter l'adresse IP de chaque visiteur
 * avant qu'il n'ait rien accepté.
 *
 * `suppressHydrationWarning` est **nécessaire** et borné à `<html>` : le script
 * de `next-themes` pose la classe `.dark` avant le premier rendu du navigateur —
 * c'est ce qui évite le clignotement —, si bien que l'attribut `class` du
 * serveur et celui du client diffèrent par construction. React signalerait cet
 * écart-là ; l'attribut ne masque que celui de cet élément, jamais celui de
 * l'arbre.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="fr"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <ThemeProvider>
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  )
}
