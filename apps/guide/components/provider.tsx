'use client'
import { RootProvider } from 'fumadocs-ui/provider/next'
import type { ComponentProps, ReactNode } from 'react'

import GuideSearchDialog from './search'

/** Le fournisseur de Fumadocs : thème, langue, et la recherche statique. */
export function Provider({
  i18n,
  children,
}: {
  i18n: ComponentProps<typeof RootProvider>['i18n']
  children: ReactNode
}) {
  return (
    <RootProvider i18n={i18n} search={{ SearchDialog: GuideSearchDialog }}>
      {children}
    </RootProvider>
  )
}
