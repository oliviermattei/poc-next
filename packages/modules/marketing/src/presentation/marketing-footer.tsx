import { Separator } from '@repo/ui'

import { legalPath, type MarketingSite } from '../application/marketing-site'
import { FOOTER_LABEL_KEY, legalTitleKey } from '../domain/message-keys'
import type { MarketingIntl } from './marketing-intl'

/**
 * Le pied de page du site public — **le point d'accès déclaré aux mentions
 * légales** (critère 2 de la story).
 *
 * Il vit dans le module, et non dans le shell de l'application : dans le shell,
 * il survivrait à la désactivation du module et proposerait des liens vers des
 * pages qui répondent 404. Il est donc rendu en fin de contenu des pages
 * marketing, et disparaît avec elles.
 *
 * Aucun composant `Footer` n'existe au design system : celui-ci est **composé**
 * d'un `Separator`, de liens et de tokens sémantiques. Le manque est signalé
 * dans `docs/designs/s10-marketing-site.md` ; il n'est pas comblé par une
 * primitive maison dans `packages/ui`.
 *
 * `aria-label` traduit, et obligatoire : deux régions de navigation anonymes
 * dans la même page (celle du shell et celle-ci) sont indistinguables au
 * clavier et au lecteur d'écran.
 */
export interface MarketingFooterProps {
  readonly site: MarketingSite
  readonly intl: MarketingIntl
}

export function MarketingFooter({ site, intl }: MarketingFooterProps) {
  if (site.legalDocuments.length === 0) {
    return null
  }

  return (
    <footer className="min-w-0 pt-8 pb-12">
      <Separator />
      <nav
        aria-label={intl.t(FOOTER_LABEL_KEY)}
        className="mt-6 flex min-w-0 flex-wrap gap-x-6 gap-y-2"
      >
        {site.legalDocuments.map((document) => (
          <a
            key={document.slug}
            href={intl.path(legalPath(document.slug))}
            className="rounded-sm text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            {intl.t(legalTitleKey(document.slug))}
          </a>
        ))}
      </nav>
    </footer>
  )
}
