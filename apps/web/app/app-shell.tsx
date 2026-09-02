import { ConsentBanner, ConsentScripts } from '@repo/module-consent/presentation'
import { LocaleSwitcher, Sidebar, SidebarBrand, ThemeToggle, cn } from '@repo/ui'
import type { ReactNode } from 'react'

import { authRoutePath, currentViewer } from '../lib/auth'
import { currentConsent } from '../lib/consent'
import { appIntl } from '../lib/i18n'
import { localeRouting } from '../lib/locale-routing'
import { moduleRegistry } from '../lib/module-registry'
import { localeOptions, shellNavigation } from '../lib/navigation'
import { fileUrl, storage } from '../lib/storage'
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
export async function AppShell({
  children,
  nonce = null,
}: {
  readonly children: ReactNode
  /**
   * Le nonce de la requête, **transmis par `app/layout.tsx`** plutôt que relu
   * ici : c'est lui qui lit `x-nonce`, et deux lectures du même en-tête
   * pourraient diverger. Il porte les scripts non essentiels de s36, que la
   * politique refuse sans nonce — `script-src` porte `'strict-dynamic'`, qui
   * fait ignorer `'self'` aux navigateurs qui le comprennent.
   */
  readonly nonce?: string | null
}) {
  const { session, account } = await currentViewer()
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
   * Le consentement du **visiteur**, lu dans son cookie et non dans un compte
   * (s36) : un anonyme a exactement le même droit qu'un utilisateur connecté.
   * Aucune connexion à la base n'est ouverte pour cela.
   */
  const consentState = await currentConsent()

  return (
    <>
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
            closeLabel={t('app.shell.closeNavigation')}
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
                avatarUrl={avatar === null ? null : fileUrl(avatar.fileId, avatar.version)}
              />
            )}
          </div>
        </header>

        {/*
          **La bannière réserve sa place plutôt que de couvrir la page.**
          Mesuré : posée en surface fixe sans cette réserve, elle interceptait
          les clics de dix parcours — pied de page marketing, formulaires de
          fin d'écran, actions d'une ligne de membre à 390 px. Ce n'était pas
          un défaut de test : un visiteur ne pouvait littéralement pas
          atteindre le bas de la page avant d'avoir répondu, ce qui revient à
          rendre la bannière modale par accident — exactement ce que le design
          refuse. La réserve est plus haute sous `md`, où les deux boutons
          passent en colonne.
        */}
        <main
          className={cn(
            'min-w-0 flex-1 px-4 py-6 md:px-8 md:py-10',
            consentState.bannerRequired && 'pb-64 md:pb-36',
          )}
        >
          <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-6">{children}</div>
        </main>
      </div>
    </div>

    {/*
      **En fin de document**, et les deux pour la même raison. La bannière ne
      doit pas précéder le contenu pour une aide technique : elle est une
      annonce, pas un préambule. Les scripts non essentiels, eux, ne sont rendus
      que si leur catégorie est accordée — aucune balise n'existe avant le
      choix, ce que `e2e/consent.spec.ts` vérifie sur les requêtes réellement
      émises.
    */}
    <ConsentBanner state={consentState} intl={intl} />
    <ConsentScripts scripts={consentState.allowedScripts} nonce={nonce} />
    </>
  )
}
