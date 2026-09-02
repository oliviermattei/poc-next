import { Separator, cn } from '@repo/ui'

import { CONTACT_PATH, legalPath, type MarketingSite } from '../application/marketing-site'
import { CONTACT_TITLE_KEY, FOOTER_LABEL_KEY, legalTitleKey } from '../domain/message-keys'
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
/**
 * Un lien que **l'application** ajoute au pied de page.
 *
 * `href` est un chemin **interne** : c'est le pied de page qui le met dans la
 * forme publique de la langue servie, une seule fois, comme il le fait pour ses
 * propres liens.
 */
export interface MarketingFooterLink {
  readonly key: string
  readonly href: string
  readonly label: string
}

export interface MarketingFooterProps {
  readonly site: MarketingSite
  readonly intl: MarketingIntl
  /**
   * Les liens que l'application ajoute, après ceux du module.
   *
   * Ils existent parce que le socle a des pages que le site public doit
   * annoncer sans que ce module les connaisse : l'écran de préférences de
   * cookies de s36 est le premier. Le module ne sait pas ce qu'est le
   * consentement — il sait afficher un lien qu'on lui donne, déjà traduit.
   *
   * C'est aussi ce qui empêche l'inverse, qui serait une régression : déclarer
   * ces pages dans `config/marketing.ts` ferait disparaître le point d'accès au
   * consentement avec le site public — exactement la non-conformité que le
   * finding F57 a relevée.
   */
  readonly extraLinks?: readonly MarketingFooterLink[]
}

/** Le style d'un lien du pied de page. Écrit une fois : deux copies divergeraient. */
const FOOTER_LINK = cn(
  'rounded-sm text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring',
)

export function MarketingFooter({ site, intl, extraLinks = [] }: MarketingFooterProps) {
  /**
   * Ce que le pied de page a réellement à montrer.
   *
   * La condition portait sur les seuls documents légaux, si bien qu'un projet
   * qui les retirait servait `/contact`, l'annonçait dans son plan de site, et
   * n'y menait de nulle part (constat F9 de la revue de s11). Elle porte
   * désormais sur les liens eux-mêmes : le pied de page disparaît quand il n'a
   * rien à dire, pas quand une de ses deux sources est vide.
   *
   * Le point d'accès au contact est **ici** et non dans la navigation du shell,
   * pour la même raison que les liens légaux : dans le shell, il survivrait à la
   * coupure du module et mènerait à une page qui répond 404. Il suit donc
   * `site.forms`, qui est ce que l'écran de contact suit lui aussi.
   */
  const links = [
    ...site.legalDocuments.map((document) => ({
      key: document.slug,
      href: legalPath(document.slug),
      label: intl.t(legalTitleKey(document.slug)),
    })),
    ...(site.forms === null
      ? []
      : [{ key: 'contact', href: CONTACT_PATH, label: intl.t(CONTACT_TITLE_KEY) }]),
    // Les liens du socle viennent après ceux du module : ce sont des pages de
    // service, pas du contenu du site.
    ...extraLinks,
  ]

  if (links.length === 0) {
    return null
  }

  return (
    <footer className="min-w-0 pt-8 pb-12">
      <Separator />
      <nav
        aria-label={intl.t(FOOTER_LABEL_KEY)}
        className="mt-6 flex min-w-0 flex-wrap gap-x-6 gap-y-2"
      >
        {links.map((link) => (
          <a key={link.key} href={intl.path(link.href)} className={FOOTER_LINK}>
            {link.label}
          </a>
        ))}
      </nav>
    </footer>
  )
}
