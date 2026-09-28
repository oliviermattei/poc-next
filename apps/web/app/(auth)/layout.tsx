import { LocaleSwitcher, ThemeToggle } from '@repo/ui'
import { headers } from 'next/headers'
import type { ReactNode } from 'react'

import { currentViewer } from '../../lib/auth'
import { currentConsent } from '../../lib/consent'
import { appIntl } from '../../lib/i18n'
import { localeRouting } from '../../lib/locale-routing'
import { localeOptions } from '../../lib/navigation'
import { NONCE_HEADER } from '../../lib/security-headers'
import { ZoneFrame } from '../zone-frame'

/**
 * La zone **Hors zone** : les écrans de l'authentification, servis avant
 * qu'une session existe.
 *
 * **Le gabarit Hors zone** (s61) : une barre minimale — la marque, la langue,
 * le thème —, puis l'écran centré. **Ni navigation, ni bouton de gabarit** : un
 * visiteur qui se connecte n'a rien d'autre à faire ici, et le lien vers le
 * site reste la marque. Le cadre commun (`ZoneFrame`) apporte le bandeau
 * d'emprunt et le consentement, comme dans les deux autres gabarits.
 *
 * Le nonce est relu ici, comme le layout racine le lisait : le gabarit rend les
 * scripts non essentiels de s36, et `script-src` porte `'strict-dynamic'` — un
 * `<script src>` sans nonce est refusé, même depuis notre propre origine.
 */
export default async function AuthLayout({ children }: { readonly children: ReactNode }) {
  const nonce = (await headers()).get(NONCE_HEADER)
  const { account, impersonatedBy } = await currentViewer()
  const { locale, t, path } = await appIntl()
  const intl = { locale, t, path }
  const languages = localeOptions(localeRouting, intl)
  const consentState = await currentConsent()

  return (
    <div className="flex min-h-svh w-full min-w-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 px-4 md:px-6">
        <a
          href={path('/')}
          className="truncate rounded-sm text-sm font-semibold focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t('app.name')}
        </a>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {languages.length === 0 ? null : (
            <LocaleSwitcher label={t('i18n.switcher.label')} current={locale} options={languages} />
          )}
          <ThemeToggle
            label={t('app.shell.theme.label')}
            options={{
              light: t('app.shell.theme.light'),
              dark: t('app.shell.theme.dark'),
              system: t('app.shell.theme.system'),
            }}
          />
        </div>
      </header>
      <ZoneFrame
        nonce={nonce}
        intl={intl}
        consent={consentState}
        impersonatedBy={impersonatedBy}
        accountEmail={account?.email ?? null}
        variant="centered"
      >
        {children}
      </ZoneFrame>
    </div>
  )
}
