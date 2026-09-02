import { MarketingSection } from '@repo/ui'
import type { ReactNode } from 'react'

import type { MarketingSite } from '../application/marketing-site'
import { CONTACT_DESCRIPTION_KEY, CONTACT_TITLE_KEY } from '../domain/message-keys'
import { MarketingFooter, type MarketingFooterLink } from './marketing-footer'
import type { MarketingIntl } from './marketing-intl'

/**
 * L'écran de contact — la troisième page publique du module.
 *
 * `MarketingSection` avec `headingLevel={1}` : c'est le titre du document.
 * `display` n'est **pas** posé — la typographie `display` est « héros marketing
 * uniquement » selon `docs/design-system.md`, et cette page n'est pas un héros.
 *
 * **Le formulaire arrive en `ReactNode`**, il n'est pas construit ici. Il est
 * interactif, donc client, donc il appelle `fetch` — ce qu'un module n'a pas le
 * droit de faire (`eslint.config.ts` : tout appel réseau sortant d'un module
 * passe par une porte bornée). Le module décide **où** le formulaire va ; c'est
 * l'application qui le fournit, comme elle fournit déjà `AuthForm` à ses écrans
 * d'authentification.
 *
 * Le même pied de page que l'accueil et que les pages légales, pour la même
 * raison : il vit dans le module, donc il disparaît avec lui.
 */
export interface ContactViewProps {
  readonly site: MarketingSite
  readonly intl: MarketingIntl
  readonly form: ReactNode
  /** Les liens que l'application ajoute au pied de page (s36). */
  readonly footerLinks?: readonly MarketingFooterLink[]
}

export function ContactView({ site, intl, form, footerLinks }: ContactViewProps) {
  return (
    <>
      <MarketingSection
        title={intl.t(CONTACT_TITLE_KEY)}
        description={intl.t(CONTACT_DESCRIPTION_KEY)}
        headingLevel={1}
      >
        {form}
      </MarketingSection>
      <MarketingFooter site={site} intl={intl} extraLinks={footerLinks} />
    </>
  )
}
