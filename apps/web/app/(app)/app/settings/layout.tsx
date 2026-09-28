import { PageHeader, Separator } from '@repo/ui'
import type { ReactNode } from 'react'

import { currentViewer } from '../../../../lib/auth'
import { appIntl } from '../../../../lib/i18n'
import { moduleRegistry } from '../../../../lib/module-registry'
import { shellNavigation } from '../../../../lib/navigation'
import { SettingsNavigation } from '../../../app-navigation'

/**
 * **Le cadre de la zone Réglages** (s62a, ADR 075), sous `/app/settings`.
 *
 * Rendu **dans** le gabarit Application : l'`AppShell` fournit déjà la barre
 * latérale du produit et la barre du haut. Ce cadre ajoute le titre de la zone
 * et sa sous-navigation, dérivée du registre par la surface `settings` — la
 * même dérivation que la barre latérale, seule la surface change. Chaque
 * entrée disparaît avec son module, sans qu'aucune ligne ici n'en nomme un.
 *
 * Les écrans déplacés gardent leur propre contenu et leurs propres gardes :
 * un visiteur anonyme est renvoyé à la connexion par l'écran, pas par ce
 * cadre, et un module coupé répond 404 par l'écran. Pour un anonyme, la
 * sous-navigation est vide — `visibleNavigation` n'en montre rien.
 *
 * Deux colonnes à partir de `md` ; en dessous, la sous-navigation passe
 * au-dessus du contenu, séparée par un `Separator`.
 */
export default async function SettingsLayout({ children }: { readonly children: ReactNode }) {
  const { session } = await currentViewer()
  const { locale, t, path } = await appIntl()
  const items = shellNavigation(moduleRegistry, session, { locale, t, path }, 'settings')

  return (
    <>
      <PageHeader title={t('app.settings.title')} />
      <div className="grid min-w-0 gap-6 md:grid-cols-[12rem_1fr]">
        <div className="flex min-w-0 flex-col gap-4">
          <SettingsNavigation items={items} label={t('app.settings.navigation')} />
          <Separator className="md:hidden" />
        </div>
        <div className="flex min-w-0 flex-col gap-6">{children}</div>
      </div>
    </>
  )
}
