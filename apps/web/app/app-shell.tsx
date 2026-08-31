import { LocaleSwitcher, Sidebar, SidebarBrand, ThemeToggle } from '@repo/ui'
import type { ReactNode } from 'react'

import { authRoutePath, currentViewer } from '../lib/auth'
import { appIntl } from '../lib/i18n'
import { localeRouting } from '../lib/locale-routing'
import { moduleRegistry } from '../lib/module-registry'
import { localeOptions, shellNavigation } from '../lib/navigation'
import { AccountMenu } from './account-menu'
import { DesktopNavigation, MobileNavigation } from './app-navigation'

/**
 * Le shell de l'application : navigation latérale, langue, menu de compte,
 * contenu.
 *
 * Il entoure **tous** les écrans, y compris ceux de l'authentification : la
 * navigation n'y montre alors que les entrées publiques, et le menu de compte
 * n'existe pas. C'est la même règle qui décide des deux — celle qui refuserait
 * la route (`docs/security.md` §3) —, pas une condition d'écran.
 *
 * Le sélecteur de langue suit la même logique : il apparaît quand
 * l'application **sert plusieurs langues**, pas quand un module s'appelle
 * `i18n`. Module coupé, `localeRouting.locales` n'a qu'une entrée et il n'y a
 * rien à choisir — donc aucun sélecteur, sans qu'aucune condition ne nomme un
 * module.
 *
 * `min-w-0` revient partout, et ce n'est pas décoratif : un élément de grille
 * ou de boîte flexible a `min-width: auto` par défaut, si bien qu'un contenu
 * large (une adresse email, un agent utilisateur) pousse la page au lieu d'être
 * tronqué. C'est la cause n°1 de débordement horizontal sous 400 px, le critère
 * mesurable de s08.
 */
export async function AppShell({ children }: { readonly children: ReactNode }) {
  const { session, account } = await currentViewer()
  const { locale, t, path } = await appIntl()
  const intl = { locale, t, path }
  const items = shellNavigation(moduleRegistry, session, intl)
  const languages = localeOptions(localeRouting, intl)

  return (
    <div className="flex min-h-svh w-full">
      <Sidebar>
        <SidebarBrand>
          <a href={path('/')} className="rounded-sm focus-visible:ring-2 focus-visible:ring-ring">
            {t('app.name')}
          </a>
        </SidebarBrand>
        <DesktopNavigation items={items} label={t('app.shell.navigation')} />
      </Sidebar>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3 md:px-6">
          <MobileNavigation
            items={items}
            label={t('app.shell.navigation')}
            openLabel={t('app.shell.openNavigation')}
            title={t('app.name')}
          />
          <a
            href={path('/')}
            className="truncate text-sm font-semibold md:hidden"
            aria-hidden
            tabIndex={-1}
          >
            {t('app.name')}
          </a>
          <div className="ml-auto flex items-center gap-1">
            {languages.length === 0 ? null : (
              <LocaleSwitcher
                label={t('i18n.switcher.label')}
                current={locale}
                options={languages}
              />
            )}
            <ThemeToggle
              label={t('app.shell.theme.label')}
              options={{
                light: t('app.shell.theme.light'),
                dark: t('app.shell.theme.dark'),
                system: t('app.shell.theme.system'),
              }}
            />
            {account === null ? null : (
              <AccountMenu
                email={account.email}
                name={account.name}
                accountHref={path('/account')}
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
