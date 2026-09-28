import { Badge, Button, LocaleSwitcher, Sidebar, SidebarBrand, ThemeToggle } from '@repo/ui'
import { BellIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { ACCOUNT_SCREEN_PATH, authRoutePath, currentViewer, DEFAULT_SIGNED_IN_PATH } from '../lib/auth'
import { currentConsent } from '../lib/consent'
import { appIntl } from '../lib/i18n'
import { localeRouting } from '../lib/locale-routing'
import { moduleRegistry } from '../lib/module-registry'
import { localeOptions, shellNavigation } from '../lib/navigation'
import {
  notifications,
  NOTIFICATIONS_BADGE_LABEL_KEY,
  NOTIFICATIONS_SCREEN_PATH,
} from '../lib/notifications'
import {
  ORGANIZATION_SWITCHER_KEYS,
  organizationRoutePath,
  organizations,
} from '../lib/organizations'
import { fileUrl, storage } from '../lib/storage'
import { AccountMenu } from './account-menu'
import { DesktopNavigation, MobileNavigation } from './app-navigation'
import { ShellOrgSwitcher } from './shell-org-switcher'
import { ZoneFrame } from './zone-frame'

/**
 * Le shell de l'application — **le gabarit Application** (s61) : navigation
 * latérale, langue, menu de compte, contenu.
 *
 * Il n'entoure que les écrans de la zone Application (`app/(app)/`) ; le site
 * et l'authentification ont leur propre gabarit. Sa barre latérale ne rend que
 * la surface `app` — les liens du site sont dans l'en-tête du site (ADR 073) —,
 * et sa marque mène au tableau de bord, `/app`. Le menu de compte n'est rendu
 * que pour un compte : c'est la même règle qui décide des entrées — celle qui
 * refuserait la route (`docs/security.md` §3) —, pas une condition d'écran.
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
export async function AppShell({
  children,
  nonce = null,
}: {
  readonly children: ReactNode
  /**
   * Le nonce de la requête, **transmis par le layout de sa zone** (ou par
   * `not-found.tsx`) plutôt que relu ici : c'est lui qui lit `x-nonce`, et le
   * shell reste un composant qui ne lit pas la requête (s60, ADR 071). Il porte les scripts non essentiels de s36, que la
   * politique refuse sans nonce — `script-src` porte `'strict-dynamic'`, qui
   * fait ignorer `'self'` aux navigateurs qui le comprennent.
   */
  readonly nonce?: string | null
}) {
  const { session, account, impersonatedBy } = await currentViewer()
  const { locale, t, path } = await appIntl()
  const intl = { locale, t, path }
  const items = shellNavigation(moduleRegistry, session, intl)
  const languages = localeOptions(localeRouting, intl)
  // **Lu seulement quand il y a un compte.** Un visiteur anonyme n'a pas de
  // menu de compte, donc pas d'avatar à chercher — et `tests/marketing.test.ts`
  // compte les connexions ouvertes pendant le rendu du shell : une lecture
  // inconditionnelle ici ferait rougir cette mesure.
  const avatar = account === null ? null : await storage.avatarOf(account.userId)
  /**
   * **Le badge de notifications non lues** (s32, critère 2).
   *
   * Lu **seulement quand il y a une session** : un visiteur anonyme n'a pas de
   * notifications, donc aucune connexion n'est ouverte pour l'apprendre. Module
   * coupé, `unreadCount` rend zéro **sans toucher la base**, et la condition
   * ci-dessous ne nomme aucun module — elle lit une donnée.
   *
   * **Ce qui rougit si on retire la condition** : `tests/marketing.test.ts`,
   * cas « ne lit aucun compteur de notifications pour un visiteur sans
   * session ». Il monte le module de force avant de compter — sans cela le
   * registre en vigueur ne le contient pas, `unreadCount` rend zéro sans rien
   * lire, et la mesure reste verte (revue s32, F2).
   *
   * **Il se met à jour à la navigation, et à rien d'autre.** Le shell est rendu
   * côté serveur à chaque requête ; après une lecture, la route répond 303 vers
   * l'écran, donc le compteur est relu. Aucun intervalle, aucun websocket : le
   * temps réel est au cimetière du PRD.
   */
  const unread = session === null ? 0 : await notifications.unreadCount(session)
  /**
   * **Les organisations du compte, pour le sélecteur de la barre du haut**
   * (s62c). Même règle que le compteur : lues **seulement avec une session** —
   * `tests/marketing.test.ts` compte les lectures du shell d'un anonyme. Module
   * coupé, la liste est vide **sans toucher la base**, et c'est elle qui décide
   * du rendu : aucune condition ne nomme un module.
   */
  const switcher = session === null ? null : await organizations.switcher(session.userId)
  const orgSwitcher =
    switcher === null || switcher.options.length === 0 ? null : (
      <ShellOrgSwitcher
        label={t(ORGANIZATION_SWITCHER_KEYS.label)}
        // Des organisations sans courante : le déclencheur invite à choisir, il
        // ne constate pas un vide (constat F7 de s15).
        current={switcher.current === null ? t(ORGANIZATION_SWITCHER_KEYS.none) : switcher.current.name}
        currentValue={switcher.current === null ? null : switcher.current.id}
        action={organizationRoutePath('switch')}
        fieldName="organizationId"
        options={switcher.options.map((option) => ({ value: option.id, label: option.name }))}
      />
    )
  /**
   * Le consentement du **visiteur**, lu dans son cookie et non dans un compte
   * (s36) : un anonyme a exactement le même droit qu'un utilisateur connecté.
   * Aucune connexion à la base n'est ouverte pour cela.
   */
  const consentState = await currentConsent()
  // **L'emprunt de session en cours** (s37b2, critère 5) : le bandeau est
  // rendu par `ZoneFrame`, commun aux trois gabarits. Aucune lecture n'est
  // faite pour lui — l'emprunt arrive avec la session, dans la résolution que
  // `currentViewer()` a déjà payée (revue de s37b2, F3).

  return (
    <div className="flex min-h-svh w-full">
      <Sidebar>
        <SidebarBrand>
          <a href={path(DEFAULT_SIGNED_IN_PATH)} className="rounded-sm focus-visible:ring-2 focus-visible:ring-ring">
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
            closeLabel={t('app.shell.closeNavigation')}
            title={t('app.name')}
            // Sous `md`, le sélecteur passe dans le panneau : la barre garde la
            // cloche et le menu de compte, sans déborder.
            header={orgSwitcher}
          />
          <a
            href={path(DEFAULT_SIGNED_IN_PATH)}
            className="truncate text-sm font-semibold md:hidden"
            aria-hidden
            tabIndex={-1}
          >
            {t('app.name')}
          </a>
          <div className="ml-auto flex min-w-0 items-center gap-1">
            {orgSwitcher === null ? null : (
              <div className="hidden min-w-0 md:block">{orgSwitcher}</div>
            )}
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
            {!notifications.available || account === null ? null : (
              <Button
                asChild
                variant="ghost"
                size="icon"
                aria-label={t(NOTIFICATIONS_BADGE_LABEL_KEY, { count: unread })}
              >
                <a href={path(NOTIFICATIONS_SCREEN_PATH)} className="relative">
                  <BellIcon aria-hidden />
                  {unread === 0 ? null : (
                    <Badge
                      variant="destructive"
                      className="absolute -top-1 -right-1 px-1 py-0"
                      aria-hidden
                    >
                      {unread}
                    </Badge>
                  )}
                </a>
              </Button>
            )}
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

        <ZoneFrame
          nonce={nonce}
          intl={intl}
          consent={consentState}
          impersonatedBy={impersonatedBy}
          accountEmail={account?.email ?? null}
          variant="contained"
        >
          {children}
        </ZoneFrame>
      </div>
    </div>
  )
}
