import { MarketingSection } from '@repo/ui'
import type { ReactNode } from 'react'

import type { MarketingSite } from '../application/marketing-site'
import { WAITLIST_DESCRIPTION_KEY, WAITLIST_TITLE_KEY } from '../domain/message-keys'
import { MarketingFooter, type MarketingFooterLink } from './marketing-footer'
import type { MarketingIntl } from './marketing-intl'

/**
 * L'écran de liste d'attente — la quatrième page publique du module (s42).
 *
 * **Elle ne remplace pas l'accueil** : la story retire explicitement ce
 * remplacement de son périmètre, et son critère 6 exige que la page d'accueil
 * reste inchangée. C'est une page de plus, à son propre chemin.
 *
 * Même composition que `ContactView`, et pour les mêmes raisons :
 * `MarketingSection` avec `headingLevel={1}` — c'est le titre du document —,
 * sans `display`, la typographie `display` étant réservée aux héros marketing
 * par `docs/design-system.md`. Aucun composant de design system n'est inventé
 * ici.
 *
 * **Le formulaire arrive en `ReactNode`.** Il est interactif, donc client, donc
 * il appelle `fetch` — ce qu'un module n'a pas le droit de faire
 * (`eslint.config.ts`). Le module décide **où** il va ; l'application le
 * fournit.
 */
export interface WaitlistViewProps {
  readonly site: MarketingSite
  readonly intl: MarketingIntl
  readonly form: ReactNode
  /** Les liens que l'application ajoute au pied de page (s36). */
  readonly footerLinks?: readonly MarketingFooterLink[]
}

export function WaitlistView({ site, intl, form, footerLinks }: WaitlistViewProps) {
  return (
    <>
      <MarketingSection
        title={intl.t(WAITLIST_TITLE_KEY)}
        description={intl.t(WAITLIST_DESCRIPTION_KEY)}
        headingLevel={1}
      >
        {form}
      </MarketingSection>
      <MarketingFooter site={site} intl={intl} extraLinks={footerLinks} />
    </>
  )
}
