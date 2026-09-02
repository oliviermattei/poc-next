import { PageHeader } from '@repo/ui'

import type { MarketingSite } from '../application/marketing-site'
import type { MarketingLegalDocument } from '../domain/marketing-config'
import {
  legalDescriptionKey,
  legalSectionBodyKey,
  legalSectionTitleKey,
  legalTitleKey,
} from '../domain/message-keys'
import { MarketingFooter, type MarketingFooterLink } from './marketing-footer'
import type { MarketingIntl } from './marketing-intl'

/**
 * Une page légale : en-tête, puis les sections que la configuration déclare,
 * puis le même pied de page que l'accueil.
 *
 * Le rendu est **échappé** par React, et rien ici n'utilise
 * `dangerouslySetInnerHTML` : le texte vient des catalogues, il n'a pas à
 * porter de balisage (`docs/security.md` §4). Un document qui aurait besoin de
 * mise en forme riche est une décision de story, pas un contournement.
 */
export interface LegalDocumentViewProps {
  readonly site: MarketingSite
  readonly document: MarketingLegalDocument
  readonly intl: MarketingIntl
  /** Les liens que l'application ajoute au pied de page (s36). */
  readonly footerLinks?: readonly MarketingFooterLink[]
}

export function LegalDocumentView({
  site,
  document,
  intl,
  footerLinks,
}: LegalDocumentViewProps) {
  return (
    <>
      <PageHeader
        title={intl.t(legalTitleKey(document.slug))}
        description={intl.t(legalDescriptionKey(document.slug))}
      />
      <div className="min-w-0 space-y-8">
        {document.sections.map((section) => (
          <section key={section} className="min-w-0 space-y-2">
            <h2 className="text-2xl font-semibold tracking-tight">
              {intl.t(legalSectionTitleKey(document.slug, section))}
            </h2>
            <p className="text-base text-muted-foreground">
              {intl.t(legalSectionBodyKey(document.slug, section))}
            </p>
          </section>
        ))}
      </div>
      <MarketingFooter site={site} intl={intl} extraLinks={footerLinks} />
    </>
  )
}
