import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'

import { ModuleNavigation } from './navigation'

export const metadata: Metadata = {
  title: 'Application',
  description: 'Application',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <ModuleNavigation />
        {children}
      </body>
    </html>
  )
}
