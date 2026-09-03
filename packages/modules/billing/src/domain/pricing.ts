import { z } from 'zod'

import { BILLING_KEYS } from './message-keys'
import {
  BillingConfigError,
  offerById,
  type BillingCatalogue,
  type BillingOffer,
} from './offer'

/**
 * Ce que la page publique de tarifs (s22) demande au domaine : deux
 * dérivations, pures, sans base ni rendu.
 *
 * Elles vivent ici et pas dans le composant pour une raison exécutable : ce qui
 * tient dans une fonction pure se prouve sans rendre quoi que ce soit, et la
 * règle n'a alors qu'un seul site — donc une seule vérité.
 */

/**
 * L'offre **mise en avant**, ou `null`.
 *
 * `config/billing.ts` ne déclare aucune offre recommandée, et le plan de s22
 * refuse d'y ajouter un champ pour en déclarer une : la mise en avant est donc
 * **dérivée** du catalogue — la dernière offre d'abonnement déclarée.
 *
 * « La dernière » plutôt que « la première » : un catalogue se lit du moins
 * engageant au plus engageant, et c'est l'engagement le plus long que le projet
 * a intérêt à proposer. Un catalogue sans abonnement n'a pas d'offre
 * recommandée — une carte mise en avant par défaut affirmerait un conseil que
 * personne n'a donné.
 *
 * Le catalogue n'est **pas** trié ni copié : il est mémorisé pour tout le
 * processus (`apps/web/lib/billing-catalogue.ts`), et le muter pour un
 * affichage empoisonnerait aussi le checkout.
 */
export function highlightedOfferId(catalogue: BillingCatalogue): string | null {
  let highlighted: string | null = null

  for (const offer of catalogue) {
    if (offer.mode === 'subscription') {
      highlighted = offer.id
    }
  }

  return highlighted
}

/**
 * La clé de la **périodicité affichée** d'une offre.
 *
 * Trois formes, et pas une de plus : par mois, par an, une seule fois. Il n'y a
 * **aucune division mensuelle** de l'offre annuelle — afficher « 24,17 €/mois »
 * sous un prélèvement unique de 290 € par an est une affirmation que rien ne
 * valide, ni ici ni chez le fournisseur.
 *
 * Elle **refuse** une offre dont le mode et la périodicité se contredisent,
 * comme `parseBillingCatalogue` le fait au démarrage. Ce n'est pas une
 * redondance : cette fonction accepte autre chose qu'une offre issue du
 * catalogue validé, et dire « par mois » d'un achat unique annoncerait un
 * renouvellement qui n'aura pas lieu.
 */
export function periodicityKeyOf(offer: Pick<BillingOffer, 'mode' | 'interval'>): string {
  if (offer.mode === 'one_time') {
    if (offer.interval !== null) {
      throw new BillingConfigError(
        'Une offre « one_time » ne peut pas porter de périodicité : elle se paie une seule fois.',
      )
    }

    return BILLING_KEYS.pricing.oneTime
  }

  if (offer.interval === null) {
    throw new BillingConfigError(
      'Une offre « subscription » doit porter une périodicité : sans elle, rien ne dit à quel rythme le prix affiché est prélevé.',
    )
  }

  return offer.interval === 'year' ? BILLING_KEYS.pricing.perYear : BILLING_KEYS.pricing.perMonth
}

/**
 * Le paramètre `?offer=` de la page de tarifs, **borné en forme**.
 *
 * Une chaîne, non vide, et pas plus longue qu'un identifiant d'offre. Tout le
 * reste — un tableau (`?offer=a&offer=b`), une absence, un nombre — n'est pas
 * une saisie que cet écran attend.
 */
const OFFER_PARAMETER = z.string().min(1).max(64)

/**
 * L'offre **reposée** après un aller-retour par la connexion (ADR 045), ou
 * `null`.
 *
 * Deux bornes, et il faut les deux : Zod borne la **forme**, le catalogue borne
 * les **valeurs** (`docs/security.md` §4). La seconde est celle qu'on oublie —
 * sans elle, une chaîne arbitraire venue de l'URL ressortirait de cette
 * fonction comme si le produit vendait cette offre, et le premier composant qui
 * la réinjecterait ferait passer une saisie utilisateur pour une donnée du
 * catalogue.
 *
 * Elle vit ici, et pas dans l'écran, pour une raison exécutable : à l'écran,
 * remplacer la confrontation au catalogue par la valeur brute ne changeait
 * **aucun** rendu — rien du document ne consomme un identifiant qui ne désigne
 * aucune carte — et la suite entière restait verte. Ici, c'est le site du
 * défaut : la mutation fait rougir « ignore un identifiant que le catalogue ne
 * connaît pas ».
 *
 * Une valeur absente, malformée ou inconnue est **ignorée sans erreur** : c'est
 * une préférence d'affichage, pas une ressource. Un 404 sur `?offer=inconnu`
 * transformerait une décoration en porte fermée.
 */
export function selectedOfferOf(value: unknown, catalogue: BillingCatalogue): string | null {
  const parsed = OFFER_PARAMETER.safeParse(value)

  return parsed.success ? (offerById(catalogue, parsed.data)?.id ?? null) : null
}
