import {
  Button,
  LocaleSwitcher,
  ThemeToggle,
  type LocaleOption,
  type SidebarItem,
} from '@repo/ui'
import type { ReactNode } from 'react'

import { currentViewer, DEFAULT_SIGNED_IN_PATH } from '../../lib/auth'
import { currentConsent } from '../../lib/consent'
import { appIntl } from '../../lib/i18n'
import { localeRouting } from '../../lib/locale-routing'
import { moduleRegistry } from '../../lib/module-registry'
import { localeOptions, shellNavigation } from '../../lib/navigation'
import { MobileNavigation, SiteNavigation } from '../app-navigation'
import { ZoneFrame } from '../zone-frame'

/**
 * **Le gabarit Site** (s61, ADR 073) : l'en-tête du site, puis le cadre commun
 * des zones. Rendu par `(site)/layout.tsx` et par la 404 racine, qui n'a aucun
 * layout de zone au-dessus d'elle (ADR 072).
 *
 * **Ses seules lectures sont celles de `currentViewer()`** — la session, pour
 * choisir le bouton, et l'emprunt, pour le bandeau. Ni avatar, ni compteur de
 * notifications : ce sont des lectures de base que l'`AppShell` paie pour son
 * menu de compte et sa cloche, et l'en-tête du site n'a ni l'un ni l'autre.
 * Pour un anonyme sans cookie, aucune connexion n'est ouverte :
 * `tests/marketing.test.ts` rend ce gabarit et compte les connexions.
 *
 * **Pas de pied de page ici** : chaque page du site rend le sien
 * (`publicFooterLinks`) ; le gabarit l'ajouterait une seconde fois.
 */
export async function SiteTemplate({
  children,
  nonce,
}: {
  readonly children: ReactNode
  readonly nonce: string | null
}) {
  const { session, account, impersonatedBy } = await currentViewer()
  const { locale, t, path } = await appIntl()
  const intl = { locale, t, path }
  const consentState = await currentConsent()
  const languages = localeOptions(localeRouting, intl)

  return (
    <div className="flex min-h-svh w-full min-w-0 flex-col">
      <SiteHeader
        brand={{ href: path('/'), label: t('app.name') }}
        items={shellNavigation(moduleRegistry, session, intl, 'site')}
        navigationLabel={t('app.site.navigation')}
        openLabel={t('app.shell.openNavigation')}
        closeLabel={t('app.shell.closeNavigation')}
        /*
          `null` quand une seule langue est servie : aucun sélecteur, sans
          qu'aucune condition ne nomme le module `i18n` — et **aucune clé
          demandée** : le libellé appartient au module `i18n`, et coupé, sa clé
          n'est plus au catalogue (une traduction absente lève).
        */
        languages={
          languages.length === 0
            ? null
            : { label: t('i18n.switcher.label'), current: locale, options: languages }
        }
        theme={{
          label: t('app.shell.theme.label'),
          options: {
            light: t('app.shell.theme.light'),
            dark: t('app.shell.theme.dark'),
            system: t('app.shell.theme.system'),
          },
        }}
        /*
          **Le bouton appartient au gabarit** (ADR 073) — l'exception nommée
          à « aucune entrée de navigation écrite à la main »
          (`apps/web/AGENTS.md`). Elle est sûre : l'authentification est du
          socle, elle ne peut pas être coupée.
        */
        action={
          session === null
            ? { href: path('/sign-in'), label: t('app.site.signIn') }
            : // Le tableau de bord, `/app` : la même constante que la
              // destination par défaut d'une ouverture de session.
              { href: path(DEFAULT_SIGNED_IN_PATH), label: t('app.site.openApp') }
        }
      />
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
  )
}

interface SiteHeaderProps {
  readonly brand: { readonly href: string; readonly label: string }
  readonly items: readonly SidebarItem[]
  readonly navigationLabel: string
  readonly openLabel: string
  readonly closeLabel: string
  readonly languages: {
    readonly label: string
    readonly current: string
    readonly options: readonly LocaleOption[]
  } | null
  readonly theme: {
    readonly label: string
    readonly options: { readonly light: string; readonly dark: string; readonly system: string }
  }
  readonly action: { readonly href: string; readonly label: string }
}

/**
 * **L'en-tête du site** : marque, entrées de la surface `site` dérivées du
 * registre, langue, thème, bouton de gabarit.
 *
 * Il est rendu **quelles que soient les entrées visibles** (critère 3) : quatre
 * modules coupés, il garde la marque, la langue, le thème et le bouton. Sous
 * `md`, les entrées passent dans un `Sheet` (`MobileNavigation`), le bouton
 * reste dans la barre.
 */
function SiteHeader({
  brand,
  items,
  navigationLabel,
  openLabel,
  closeLabel,
  languages,
  theme,
  action,
}: SiteHeaderProps) {
  return (
    <header className="h-16 shrink-0 border-b border-border bg-background">
      <div className="mx-auto flex h-full w-full max-w-6xl min-w-0 items-center gap-2 px-4 md:px-6">
        {items.length === 0 ? null : (
          <MobileNavigation
            items={items}
            label={navigationLabel}
            openLabel={openLabel}
            closeLabel={closeLabel}
            title={brand.label}
          />
        )}
        <a
          href={brand.href}
          className="truncate rounded-sm text-sm font-semibold focus-visible:ring-2 focus-visible:ring-ring"
        >
          {brand.label}
        </a>
        {items.length === 0 ? null : <SiteNavigation items={items} label={navigationLabel} />}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {languages === null ? null : (
            <LocaleSwitcher
              label={languages.label}
              current={languages.current}
              options={languages.options}
            />
          )}
          <ThemeToggle label={theme.label} options={theme.options} />
          <Button asChild>
            <a href={action.href}>{action.label}</a>
          </Button>
        </div>
      </div>
    </header>
  )
}
