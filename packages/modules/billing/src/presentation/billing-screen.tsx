import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
} from '@repo/ui'
import { CreditCardIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import type { BillingView, OfferView } from '../application/billing-use-cases'
import {
  BILLING_KEYS as K,
  offerDescriptionKey,
  offerNameKey,
  stateDescriptionKey,
  stateTitleKey,
} from '../domain/message-keys'
import type { BillingDisplayState } from '../domain/subscription'
import type { BillingIntl } from './billing-intl'

/**
 * L'écran de facturation — **composé, jamais inventé**.
 *
 * Tout vient de `@repo/ui` (`docs/design-system.md`) : `PageHeader`, `Card`,
 * `Badge`, `Alert`, `EmptyState`. Aucune primitive maison, aucune couleur
 * Tailwind brute, aucun texte en dur.
 *
 * **Les déclencheurs arrivent en `ReactNode`** (ADR 027). Souscrire et ouvrir le
 * portail passent par `fetch` puis par une navigation, et `eslint.config.ts`
 * refuse tout appel réseau depuis un module. Le module décide **où** les boutons
 * s'affichent ; l'application décide **comment** ils parlent au serveur.
 *
 * **La navigation vers le fournisseur est pilotée par script, pas par un
 * formulaire.** Une redirection 303 depuis une soumission serait soumise à
 * `form-action 'self'`, et il faudrait déclarer deux origines de plus dans
 * `config/security.ts` (recherche §7). L'écran ne les demande pas.
 */

/**
 * La sémantique de chaque état — **celle du design system, à la lettre** :
 * « essai en cours → `info`, en retard de paiement → `warning`, annulé ou
 * expiré → `muted`, abonnement actif → `success` ».
 *
 * `muted` n'est pas une variante d'`Alert` ni de `Badge` : l'état neutre est
 * `secondary` sur le badge et le variant par défaut sur l'alerte, qui portent
 * déjà les tokens neutres. Inventer une variante ici serait un composant hors
 * système.
 */
const BADGE_VARIANT: Readonly<Record<BillingDisplayState, 'secondary' | 'success' | 'info' | 'warning'>> =
  {
    none: 'secondary',
    trialing: 'info',
    active: 'success',
    ending: 'secondary',
    past_due: 'warning',
    expired: 'secondary',
  }

const ALERT_VARIANT: Readonly<Record<BillingDisplayState, 'default' | 'success' | 'info' | 'warning'>> =
  {
    none: 'default',
    trialing: 'info',
    active: 'success',
    ending: 'default',
    past_due: 'warning',
    expired: 'default',
  }

/** Les états qui demandent quelque chose au visiteur portent une alerte en tête. */
const ANNOUNCED: readonly BillingDisplayState[] = ['trialing', 'ending', 'past_due', 'expired']

export interface BillingScreenProps {
  readonly view: BillingView
  readonly intl: BillingIntl
  /** Le bouton « Gérer la facturation », fourni par l'application (ADR 027). */
  readonly manageAction: ReactNode
  /** Un bouton « Souscrire » par offre, indexé par identifiant d'offre. */
  readonly subscribeActions: Readonly<Record<string, ReactNode>>
  /** Le retour de paiement, ou `null`. Validé par l'écran appelant. */
  readonly checkoutOutcome: 'success' | 'cancelled' | null
}

function OfferCard({
  offer,
  intl,
  action,
  subscribed,
}: {
  readonly offer: OfferView
  readonly intl: BillingIntl
  readonly action: ReactNode
  /** Le périmètre a-t-il déjà un abonnement qui donne l'accès ? */
  readonly subscribed: boolean
}) {
  const intervalKey = offer.interval === 'year' ? K.intervalYear : K.intervalMonth
  // **Deux fermetures, et elles ne se regardent pas** (critère 6 de s20) : une
  // offre unique se ferme sur sa propre possession, une offre d'abonnement sur
  // l'abonnement en cours. Les confondre interdirait à un abonné d'acheter à
  // vie, et à un acheteur à vie de s'abonner — ce que la garde serveur permet
  // toutes deux.
  const oneTime = offer.mode === 'one_time'

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{intl.t(offerNameKey(offer.id))}</CardTitle>
        <CardDescription>{intl.t(offerDescriptionKey(offer.id))}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-2xl font-semibold">{offer.price}</p>
        <p className="text-sm text-muted-foreground">
          {intl.t(offer.interval === null ? K.oneTime : intervalKey)}
        </p>
        <div className="flex flex-wrap gap-2">
          {offer.trialDays === null ? null : (
            <Badge variant="info">{intl.t(K.trialDays, { count: offer.trialDays })}</Badge>
          )}
          {offer.perSeat ? <Badge variant="outline">{intl.t(K.perSeat)}</Badge> : null}
        </div>
      </CardContent>
      {/*
        **Un abonnement vivant ferme le catalogue entier**, et pas seulement la
        carte de l'offre en cours (constat M3 de la seconde revue).
        `checkout.sessions.create({ mode: 'subscription' })` crée *toujours* un
        abonnement de plus chez le fournisseur : le bouton de l'autre offre
        ouvrait un second prélèvement, dont cet écran — qui n'affiche que
        l'abonnement courant — ne disait rien. Le sixième critère de la story
        confie le changement d'offre au **portail**, et c'est ce que les cartes
        disent désormais.

        Sans accès — abonnement expiré, annulé, jamais souscrit —, toutes les
        cartes reprennent leur bouton : c'est le parcours « annuler puis se
        réabonner » du constat F1, et l'offre passée n'y est pas un obstacle.

        La garde qui compte est **côté serveur** (`openCheckout` refuse en 409) :
        masquer un bouton n'est pas une permission.
      */}
      <CardFooter>
        {oneTime ? (
          offer.owned ? (
            <Badge variant="success">{intl.t(K.ownedOffer)}</Badge>
          ) : (
            action
          )
        ) : subscribed ? (
          offer.current ? (
            <Badge variant="success">{intl.t(K.currentOffer)}</Badge>
          ) : (
            <p className="text-sm text-muted-foreground">{intl.t(K.changeThroughPortal)}</p>
          )
        ) : (
          action
        )}
      </CardFooter>
    </Card>
  )
}

export function BillingScreen({
  view,
  intl,
  manageAction,
  subscribeActions,
  checkoutOutcome,
}: BillingScreenProps) {
  const stateTitle = intl.t(stateTitleKey(view.state))
  // La comparaison vit **hors du JSX** : un littéral d'un seul mot entre
  // accolades dans des enfants ou dans une prop est lu comme du texte affiché
  // par `tests/i18n.test.ts`, et il a raison de le lire ainsi.
  const paid = checkoutOutcome === 'success'

  return (
    <div className="space-y-8">
      <PageHeader title={intl.t(K.title)} description={intl.t(K.description)} />

      {checkoutOutcome === null ? null : (
        <Alert variant={paid ? 'success' : 'info'} role="status">
          {intl.t(paid ? K.checkoutSuccess : K.checkoutCancelled)}
        </Alert>
      )}

      {ANNOUNCED.includes(view.state) ? (
        <Alert variant={ALERT_VARIANT[view.state]}>
          <AlertTitle>{stateTitle}</AlertTitle>
          <AlertDescription>{intl.t(stateDescriptionKey(view.state))}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            {intl.t(K.subscriptionTitle)}
            {/*
              Le badge porte le **nom** de l'état, pas une couleur seule : une
              distinction faite uniquement par la teinte n'existe pas pour qui
              ne la perçoit pas.
            */}
            <Badge variant={BADGE_VARIANT[view.state]}>{stateTitle}</Badge>
          </CardTitle>
          <CardDescription>{intl.t(stateDescriptionKey(view.state))}</CardDescription>
        </CardHeader>
        {view.subscription === null ? null : (
          <CardContent className="space-y-1 text-sm text-muted-foreground">
            {/*
              L'offre en cours, sur sa propre ligne. **Jamais concaténée** avec
              autre chose : deux chaînes traduites collées dans un même nœud de
              texte produisent une phrase que personne n'a écrite, et que le
              filet de `tests/rendered-text.test.ts` lit — à juste titre — comme
              du texte en dur.
            */}
            <p>
              {view.subscription.offerId === null
                ? intl.t(K.unknownOffer)
                : intl.t(offerNameKey(view.subscription.offerId))}
            </p>
            <p>
              {intl.t(view.subscription.cancelAtPeriodEnd ? K.endsAt : K.renewsAt, {
                date: intl.formatDate(view.subscription.renewsAt),
              })}
            </p>
            {view.subscription.trialEnd === null ? null : (
              <p>{intl.t(K.trialEndsAt, { date: intl.formatDate(view.subscription.trialEnd) })}</p>
            )}
            {view.subscription.quantity > 1 ? (
              <p>{intl.t(K.seats, { count: view.subscription.quantity })}</p>
            ) : null}
          </CardContent>
        )}
        {/*
          **Le portail n'est proposé que s'il y a un abonnement** (quatrième
          critère de s20, ADR 038 §4). Ce qu'il sert — moyen de paiement,
          changement d'offre, résiliation — n'existe pas pour un achat unique ;
          l'historique des paiements, lui, est juste en dessous et vient de
          l'application.
        */}
        {view.canOpenPortal ? <CardFooter>{manageAction}</CardFooter> : null}
      </Card>

      {/*
        **L'historique des paiements uniques** — rendu seulement s'il y en a.
        Pas d'`EmptyState` : ce qui en sort est le catalogue, juste en dessous,
        et un état vide y promettrait une action qui vit ailleurs.
      */}
      {view.purchases.length === 0 ? null : (
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>{intl.t(K.purchasesTitle)}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {view.purchases.map((purchase, index) => (
              <div
                key={`${purchase.offerId}-${String(index)}`}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <div className="min-w-0 space-y-1">
                  {/*
                    Une offre retirée du catalogue est **nommée comme telle** :
                    composer sa clé de traduction ferait lever le traducteur
                    (s09), donc mettrait l'écran en 500 pour un achat payé.
                  */}
                  <p className="font-medium">
                    {purchase.offerId === null
                      ? intl.t(K.unknownOffer)
                      : intl.t(offerNameKey(purchase.offerId))}
                  </p>
                  {purchase.purchasedAt === null ? null : (
                    <p className="text-sm text-muted-foreground">
                      {intl.t(K.purchasedAt, { date: intl.formatDate(purchase.purchasedAt) })}
                    </p>
                  )}
                  {/*
                    Le montant **réellement prélevé**, jamais celui du
                    catalogue : une offre dont le prix change ne réécrit pas le
                    passé. Absent quand le fournisseur ne l'a pas dit.
                  */}
                  {purchase.price === null ? null : (
                    <p className="text-sm text-muted-foreground">{purchase.price}</p>
                  )}
                </div>
                {/*
                  Le badge porte le **nom** de l'état : une distinction faite
                  uniquement par la teinte n'existe pas pour qui ne la perçoit
                  pas. `secondary` et non `destructive` — un remboursement est
                  un état terminé, pas une erreur du système.
                */}
                <Badge variant={purchase.refunded ? 'secondary' : 'success'}>
                  {intl.t(purchase.refunded ? K.purchaseRefunded : K.purchasePaid)}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">{intl.t(K.offersTitle)}</h2>
        {view.offers.length === 0 ? (
          <EmptyState
            icon={<CreditCardIcon aria-hidden="true" className="size-4" />}
            title={intl.t(K.emptyTitle)}
            description={intl.t(K.emptyDescription)}
            // Aucune action : **il n'y en a pas**. Le design system exige que
            // l'état vide porte ce qui en sort ; ici, ce qui en sort est une
            // ligne de `config/billing.ts`, qu'aucun bouton ne peut écrire.
            // C'est la description qui le dit.
            action={null}
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {view.offers.map((offer) => (
              <OfferCard
                key={offer.id}
                offer={offer}
                intl={intl}
                action={subscribeActions[offer.id]}
                subscribed={view.hasSubscription}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
