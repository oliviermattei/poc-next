import { Sidebar, SidebarBrand, ThemeToggle } from '@repo/ui'
import type { ReactNode } from 'react'

import { authRoutePath, currentViewer } from '../lib/auth'
import { moduleRegistry } from '../lib/module-registry'
import { shellNavigation } from '../lib/navigation'
import { AccountMenu } from './account-menu'
import { DesktopNavigation, MobileNavigation } from './app-navigation'

/**
 * Le shell de l'application : navigation latérale, menu de compte, contenu.
 *
 * Il entoure **tous** les écrans, y compris ceux de l'authentification : la
 * navigation n'y montre alors que les entrées publiques, et le menu de compte
 * n'existe pas. C'est la même règle qui décide des deux — celle qui refuserait
 * la route (`docs/security.md` §3) —, pas une condition d'écran.
 *
 * `min-w-0` revient partout, et ce n'est pas décoratif : un élément de grille
 * ou de boîte flexible a `min-width: auto` par défaut, si bien qu'un contenu
 * large (une adresse email, un agent utilisateur) pousse la page au lieu d'être
 * tronqué. C'est la cause n°1 de débordement horizontal sous 400 px, le critère
 * mesurable de cette story.
 */
export async function AppShell({ children }: { readonly children: ReactNode }) {
  const { session, account } = await currentViewer()
  const items = shellNavigation(moduleRegistry, session)

  return (
    <div className="flex min-h-svh w-full">
      <Sidebar>
        <SidebarBrand>
          <a href="/" className="rounded-sm focus-visible:ring-2 focus-visible:ring-ring">
            Application
          </a>
        </SidebarBrand>
        <DesktopNavigation items={items} />
      </Sidebar>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3 md:px-6">
          <MobileNavigation items={items} />
          <a
            href="/"
            className="truncate text-sm font-semibold md:hidden"
            aria-hidden
            tabIndex={-1}
          >
            Application
          </a>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle
              label="Thème"
              options={{ light: 'Clair', dark: 'Sombre', system: 'Système' }}
            />
            {account === null ? null : (
              <AccountMenu
                email={account.email}
                name={account.name}
                signOutAction={authRoutePath('signOut')}
              />
            )}
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-10">
          <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-6">{children}</div>
        </main>
      </div>
    </div>
  )
}
