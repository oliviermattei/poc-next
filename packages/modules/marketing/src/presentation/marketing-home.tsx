import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  MarketingSection,
} from '@repo/ui'

import type { ReactNode } from 'react'

import type { MarketingSite } from '../application/marketing-site'
import type { MarketingSection as SectionConfig } from '../domain/marketing-config'
import {
  actionKey,
  itemBodyKey,
  itemTitleKey,
  sectionDescriptionKey,
  sectionTitleKey,
} from '../domain/message-keys'
import { MarketingFooter } from './marketing-footer'
import type { MarketingIntl } from './marketing-intl'

/**
 * L'accueil public, composé depuis `config/marketing.ts`.
 *
 * **Aucune section n'est écrite ici.** Le composant parcourt ce que la
 * configuration déclare, dans son ordre, et choisit un contenu par *nature* —
 * jamais par identifiant. Réordonner ou retirer une section est donc une
 * édition d'une ligne de configuration, ce qu'exige le premier critère de la
 * story ; ajouter une nature est en revanche une décision de design, et elle se
 * voit ici.
 *
 * Les clés de traduction viennent des fonctions de `domain/message-keys.ts`,
 * les **mêmes** que `marketingMessageKeys` — celles que `tests/marketing.test.ts`
 * confronte aux catalogues. Aucun gabarit de clé n'est écrit dans ce fichier :
 * deux dérivations divergeraient, et un fragment de clé dans un `.tsx` est lu
 * comme un morceau de phrase par le détecteur de texte en dur (mesuré).
 */
export interface MarketingHomeProps {
  readonly site: MarketingSite
  readonly intl: MarketingIntl
  /**
   * Le formulaire d'inscription, **fourni par l'application**.
   *
   * Il est interactif, donc client, donc il appelle `fetch` — ce qu'un module
   * n'a pas le droit de faire (`eslint.config.ts`). Ce composant décide **où**
   * il s'affiche, c'est-à-dire à la place que `config/marketing.ts` lui donne
   * dans l'ordre des sections ; il ne le construit pas.
   */
  readonly newsletterForm: ReactNode
}

function SectionActions({
  section,
  intl,
}: {
  readonly section: SectionConfig
  readonly intl: MarketingIntl
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {section.actions.map((action) => (
        <Button key={action.id} variant={action.variant} asChild>
          <a href={intl.path(action.href)}>{intl.t(actionKey(section, action.id))}</a>
        </Button>
      ))}
    </div>
  )
}

function SectionBody({
  section,
  intl,
  newsletterForm,
}: {
  readonly section: SectionConfig
  readonly intl: MarketingIntl
  readonly newsletterForm: ReactNode
}) {
  if (section.kind === 'hero' || section.kind === 'cta') {
    return <SectionActions section={section} intl={intl} />
  }

  if (section.kind === 'newsletter') {
    // s11. La position et la présence de cette section restent décidées par
    // `config/marketing.ts` : la retirer retire le formulaire de la page
    // d'accueil, sans toucher à ce composant.
    return newsletterForm
  }

  if (section.kind === 'features') {
    return (
      <div className="grid min-w-0 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {section.items.map((item) => (
          <Card key={item} className="min-w-0">
            <CardHeader>
              <CardTitle>{intl.t(itemTitleKey(section, item))}</CardTitle>
              <CardDescription>{intl.t(itemBodyKey(section, item))}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    )
  }

  if (section.kind === 'testimonials') {
    return (
      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        {section.items.map((item) => (
          <Card key={item} className="min-w-0">
            <CardContent className="space-y-3">
              {/* Le corps porte la citation, le titre son auteur : convention du
                  module, tenue par `domain/message-keys.ts`. */}
              <blockquote className="text-base">{intl.t(itemBodyKey(section, item))}</blockquote>
              <p className="text-xs text-muted-foreground">
                {intl.t(itemTitleKey(section, item))}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  return (
    <Accordion type="single" collapsible>
      {section.items.map((item) => (
        <AccordionItem key={item} value={item}>
          <AccordionTrigger>{intl.t(itemTitleKey(section, item))}</AccordionTrigger>
          <AccordionContent>{intl.t(itemBodyKey(section, item))}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  )
}

export function MarketingHome({ site, intl, newsletterForm }: MarketingHomeProps) {
  return (
    <>
      {site.sections.map((section, index) => (
        <MarketingSection
          key={section.id}
          title={intl.t(sectionTitleKey(section))}
          description={intl.t(sectionDescriptionKey(section))}
          // Le premier titre de la page est le `h1` du document, les suivants
          // des `h2` : une page qui enchaîne les `h1` n'a plus de structure
          // pour un lecteur d'écran.
          headingLevel={index === 0 ? 1 : 2}
          display={index === 0}
        >
          <SectionBody section={section} intl={intl} newsletterForm={newsletterForm} />
        </MarketingSection>
      ))}
      <MarketingFooter site={site} intl={intl} />
    </>
  )
}
