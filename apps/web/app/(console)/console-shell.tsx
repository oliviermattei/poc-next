import { CONSOLE_SCREEN_PATH } from '@repo/module-admin'
import { ConsentBanner, ConsentScripts } from '@repo/module-consent/presentation'
import { Badge, LocaleSwitcher, Sidebar, SidebarBrand, ThemeToggle, cn } from '@repo/ui'
import type { ReactNode } from 'react'

import { ACCOUNT_SCREEN_PATH, authRoutePath, currentViewer } from '../../lib/auth'
import { consoleNavigation } from '../../lib/back-office'
import { currentConsent } from '../../lib/consent'
import { appIntl } from '../../lib/i18n'
import { localeRouting } from '../../lib/locale-routing'
import { localeOptions } from '../../lib/navigation'
import { fileUrl, storage } from '../../lib/storage'
import { AccountMenu } from '../account-menu'
import { DesktopNavigation, MobileNavigation } from '../app-navigation'

/**
 * **Le shell de la console** (s60, ADR 071) — celui du superadmin.
 *
 * Il reprend le squelette de l'`AppShell` (barre latérale, barre du haut de
 * 3,5 rem) pour que rien ne soit à réapprendre, et s'en distingue par son
 * **contenu**, jamais par une couleur (lacune 1 du design) : un badge
 * « Console » à côté du nom, et les seules entrées de la surface `console`.
 * **Aucune** entrée de la barre latérale du produit n'y paraît.
 *
 * Ce qu'il n'a pas, et c'est voulu : ni cloche de notifications, ni sélecteur
 * d'organisation — la console n'agit pas au nom d'une organisation. Ni bandeau
 * d'emprunt : une session empruntée n'atteint jamais ce shell, le layout la
 * refuse avant.
 *
 * Ce qu'il garde de l'`AppShell` : la langue (quand plusieurs sont servies —
 * une donnée, jamais un nom de module), le thème, le menu de compte (la seule
 * déconnexion visible ; il crée le seul lien console → application, le sens
 * que le critère 6 n'interdit pas), la bannière et les scripts de consentement
 * — avec le **nonce**, que `script-src 'strict-dynamic'` exige.
 *
 * Il n'est rendu qu'**après** la garde du layout, donc toujours module `admin`
 * activé : ses textes peuvent venir du catalogue de ce module.
 */
export async function ConsoleShell({
  children,
  nonce,
}: {
  readonly children: ReactNode
  readonly nonce: string | null
}) {
  const { session, account } = await currentViewer()
  const { locale, t, path } = await appIntl()
  const intl = { locale, t, path }
  const items = consoleNavigation(session, intl)
  const languages = localeOptions(localeRouting, intl)
  const avatar = account === null ? null : await storage.avatarOf(account.userId)
  const consentState = await currentConsent()

  return (
    <>
      <div className="flex min-h-svh w-full">
        <Sidebar>
          <SidebarBrand>
            <span className="flex items-center gap-2">
              <a
                href={path(CONSOLE_SCREEN_PATH)}
                className="truncate rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t('app.name')}
              </a>
              <Badge variant="default">{t('admin.console.badge')}</Badge>
            </span>
          </SidebarBrand>
          <DesktopNavigation items={items} label={t('admin.console.navigation')} />
        </Sidebar>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3 md:px-6">
            <MobileNavigation
              items={items}
              label={t('admin.console.navigation')}
              openLabel={t('app.shell.openNavigation')}
              closeLabel={t('app.shell.closeNavigation')}
              title={t('admin.console.title')}
            />
            <span className="truncate text-sm font-semibold md:hidden" aria-hidden>
              {t('admin.console.title')}
            </span>
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
                  accountHref={path(ACCOUNT_SCREEN_PATH)}
                  signOutAction={authRoutePath('signOut')}
                  avatarUrl={avatar === null ? null : fileUrl(avatar.fileId, avatar.version)}
                />
              )}
            </div>
          </header>

          {/* La bannière réserve sa place plutôt que de couvrir la page — la
              raison mesurée est écrite dans `app-shell.tsx`. Pleine largeur :
              les tableaux de la console en ont besoin. */}
          <main
            className={cn(
              'flex min-w-0 flex-1 flex-col gap-6 px-3 py-6 md:px-6',
              consentState.bannerRequired && 'pb-64 md:pb-36',
            )}
          >
            {children}
          </main>
        </div>
      </div>

      <ConsentBanner state={consentState} intl={intl} />
      <ConsentScripts scripts={consentState.allowedScripts} nonce={nonce} />
    </>
  )
}
