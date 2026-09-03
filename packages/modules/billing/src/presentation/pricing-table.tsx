import {
  Alert,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Separator,
  cn,
} from '@repo/ui'
import { TagIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { BILLING_KEYS as K, offerDescriptionKey, offerNameKey } from '../domain/message-keys'
import type { BillingInterval, BillingMode } from '../domain/offer'
import { periodicityKeyOf } from '../domain/pricing'
import type { BillingIntl } from './billing-intl'

/**
 * La page publique de tarifs — **composée, jamais inventée** (s22).
 *
 * Le nom vient du design system, qui déclare `PricingTable` pour cette story
 * (« Tarifs dérivés de `config/billing.ts` »). Elle porte l'écran entier — en
 * tête, grille, état vide —, comme `BillingScreen` porte le sien : `PageHeader`,
 * `Card`, `Badge`, `Separator`, `Alert`, `EmptyState`, tous de `@repo/ui`.
 * Aucune primitive maison, aucune couleur Tailwind brute, aucun texte en dur.
 *
 * **Le nombre de cartes n'est écrit nulle part** : il vient de la longueur de
 * `offers`, elle-même la longueur du catalogue. C'est le premier critère de la
 * story — ajouter une offre à `config/billing.ts` la fait apparaître sans
 * qu'une ligne de cet écran change.
 *
 * **Les déclencheurs arrivent en `ReactNode`** (ADR 027), comme pour l'écran de
 * facturation : souscrire passe par `fetch` puis par une navigation, et
 * `eslint.config.ts` refuse tout appel réseau depuis un module. Ce composant
 * décide **où** le bouton s'affiche ; l'application décide **comment** il parle
 * au serveur — et, pour un visiteur anonyme, qu'il s'agit d'un lien vers la
 * connexion plutôt que d'un formulaire.
 *
 * **Aucun effet de bord, dans aucun état** : cet écran lit un catalogue déjà
 * validé au démarrage et rend du HTML. Il ne trie ni ne copie ce catalogue —
 * il est mémorisé pour tout le processus
 * (`apps/web/lib/billing-catalogue.ts`), et le muter pour un affichage
 * empoisonnerait aussi le checkout.
 */

/**
 * Le nombre de colonnes, **plafonné à trois** et écrit en classes littérales.
 *
 * Une classe composée à l'exécution (`md:grid-cols-${n}`) n'existerait pas dans
 * la feuille de style : Tailwind ne voit que ce qui est écrit. Trois entrées,
 * donc, et une grille qui reste à une colonne sous `md`.
 */
const COLUMNS: Readonly<Record<1 | 2 | 3, string>> = {
  1: 'md:grid-cols-1',
  2: 'md:grid-cols-2',
  3: 'md:grid-cols-3',
}

/** L'offre telle que cet écran l'affiche : le prix y est **déjà formaté**. */
export interface PricingOfferView {
  readonly id: string
  readonly mode: BillingMode
  readonly interval: BillingInterval | null
  readonly trialDays: number | null
  /**
   * Le prix rendu par `formatOfferPrice` sur **l'offre du catalogue**, dans la
   * langue servie. C'est la seule source du montant affiché : le second critère
   * de la story compare ce qui est ici à ce que le bouton envoie.
   */
  readonly price: string
}

export interface PricingTableProps {
  readonly offers: readonly PricingOfferView[]
  /** Le traducteur seul : cet écran n'affiche aucune date. */
  readonly intl: Pick<BillingIntl, 't'>
  /**
   * L'offre **recommandée**, dérivée du catalogue par `highlightedOfferId`.
   * `null` quand le produit ne vend pas d'abonnement.
   */
  readonly highlightedOfferId: string | null
  /**
   * L'offre **retrouvée** après un aller-retour par la connexion (ADR 045).
   *
   * Elle met la carte en évidence et donne le focus à son déclencheur — elle
   * n'achète rien. L'identifiant a été validé contre le catalogue par l'écran
   * appelant ; une valeur inconnue arrive ici en `null`.
   */
  readonly selectedOfferId: string | null
  /** Un déclencheur par offre, indexé par identifiant. Fourni par l'application. */
  readonly actions: Readonly<Record<string, ReactNode>>
  /**
   * L'écran porte-t-il lui-même l'avertissement « le tunnel exige
   * JavaScript » ?
   *
   * `false` quand les déclencheurs le portent déjà — c'est le cas du composant
   * de l'application, qui l'affiche sous chaque bouton éteint. Le répéter une
   * fois de plus en tête n'en dirait pas davantage. `true` quand les
   * déclencheurs sont de simples liens, qui fonctionnent sans script : le
   * visiteur atteindra le bouton mort **plus tard**, et l'annoncer avant qu'il
   * s'engage vaut mieux que de le lui apprendre après.
   */
  readonly noScriptNotice: boolean
}

function OfferCard({
  offer,
  intl,
  action,
  highlighted,
  selected,
}: {
  readonly offer: PricingOfferView
  readonly intl: Pick<BillingIntl, 't'>
  readonly action: ReactNode
  readonly highlighted: boolean
  readonly selected: boolean
}) {
  return (
    <Card
      className={cn(
        'min-w-0',
        highlighted ? 'border-primary' : undefined,
        // L'offre **reposée** après la connexion (ADR 045) : elle se voit, avec
        // l'anneau de mise au point du système — c'est le même jeton que le
        // focus d'un bouton, pas une couleur inventée.
        selected ? 'ring-2 ring-ring' : undefined,
      )}
      // Et elle se **nomme** : une mise en évidence portée par la seule teinte
      // n'existe pas pour qui ne la perçoit pas.
      aria-current={selected ? 'true' : undefined}
    >
      <CardHeader>
        <CardTitle>{intl.t(offerNameKey(offer.id))}</CardTitle>
        <CardDescription>{intl.t(offerDescriptionKey(offer.id))}</CardDescription>
      </CardHeader>
      {/*
        `flex-1` : les cartes d'une même rangée ont déjà la même hauteur, mais
        leurs contenus n'ont pas la même longueur — une offre sans essai n'a pas
        de badge. Sans cela, les boutons ne s'alignent pas d'une carte à
        l'autre, et l'œil lit un désordre là où il compare des prix.
      */}
      <CardContent className="flex-1 space-y-2">
        <p className="text-3xl font-semibold tracking-tight">{offer.price}</p>
        {/*
          La périodicité vient du `domain` — « par mois », « par an », « paiement
          unique ». **Aucune division mensuelle** de l'offre annuelle : afficher
          « 24,17 €/mois » sous un prélèvement de 290 € par an est une
          affirmation que rien ne valide.
        */}
        <p className="text-sm text-muted-foreground">{intl.t(periodicityKeyOf(offer))}</p>
        {offer.trialDays === null ? null : (
          <div className="flex flex-wrap gap-2">
            <Badge variant="info">
              {intl.t(K.pricing.trialBadge, { count: offer.trialDays })}
            </Badge>
          </div>
        )}
      </CardContent>
      <Separator />
      <CardFooter>{action}</CardFooter>
    </Card>
  )
}

export function PricingTable({
  offers,
  intl,
  highlightedOfferId,
  selectedOfferId,
  actions,
  noScriptNotice,
}: PricingTableProps) {
  const columns = COLUMNS[Math.min(Math.max(offers.length, 1), 3) as 1 | 2 | 3]

  return (
    <div className="space-y-8">
      <PageHeader
        title={intl.t(K.pricing.title)}
        description={intl.t(K.pricing.description)}
      />

      {offers.length === 0 ? (
        <EmptyState
          // `aria-hidden` en booléen, pas en chaîne : le filet de texte rendu
          // refuse toute prop de type chaîne qui n'est pas un marqueur.
          icon={<TagIcon aria-hidden className="size-4" />}
          title={intl.t(K.pricing.emptyTitle)}
          description={intl.t(K.pricing.emptyDescription)}
          // Aucune action : **il n'y en a pas**. Ce qui sort de cet état vide
          // est une ligne de `config/billing.ts`, qu'aucun bouton ne peut
          // écrire. C'est la description qui le dit.
          action={null}
        />
      ) : (
        <div className={cn('grid gap-4', columns)}>
          {offers.map((offer) => (
            <OfferCard
              key={offer.id}
              offer={offer}
              intl={intl}
              action={actions[offer.id]}
              highlighted={offer.id === highlightedOfferId}
              selected={offer.id === selectedOfferId}
            />
          ))}
        </div>
      )}

      {/*
        **Le tunnel exige JavaScript**, et cette page publique en hérite
        (ADR 027) : l'ouvrir par une soumission de formulaire imposerait
        d'ajouter `checkout.stripe.com` à `config/security.ts`. Le dire vaut
        mieux que de laisser un bouton mort — et ce `<noscript>` ne coûte ni
        script en ligne, ni source de politique de sécurité du contenu.
      */}
      {noScriptNotice ? (
        <noscript>
          <Alert variant="warning">{intl.t(K.pricing.noScript)}</Alert>
        </noscript>
      ) : null}
    </div>
  )
}
