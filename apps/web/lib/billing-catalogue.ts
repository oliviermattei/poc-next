import { parseBillingCatalogue, type BillingCatalogue } from '@repo/module-billing'

import { billingOffers } from '../../../config/billing'

/**
 * **Le catalogue d'offres, validé** — la règle qui décide, isolée de ce qui la
 * construit, comme `lib/billing-config.ts`, `lib/mailer-config.ts` et
 * `lib/oauth-config.ts`.
 *
 * Elle est appelée à **deux** endroits, et il faut les deux :
 *
 * - `apps/web/next.config.ts`, au **démarrage** : c'est le premier critère de
 *   la story — « une offre malformée fait échouer le démarrage ». Next charge ce
 *   fichier avant de servir quoi que ce soit et abandonne quand il lève ;
 * - `apps/web/lib/billing.ts`, à la construction du service : le module ne lit
 *   pas `config/billing.ts`, il reçoit un catalogue **déjà validé**.
 *
 * Ce fichier existe parce que la première n'existait pas (constat F2 de la
 * revue) : le catalogue n'était validé qu'à la première requête qui construisait
 * le service, et cette requête pouvait être le **webhook public** — qui
 * répondait alors 500 au lieu de 400, y compris sur une signature invalide.
 * Stripe rejoue, abandonne, et l'état des abonnements diverge en silence
 * (`docs/reliability.md` §1 et §2).
 *
 * Il n'importe **ni** le point de composition, **ni** la base, **ni** le SDK :
 * `next.config.ts` doit pouvoir poser cette question sans rien monter.
 *
 * Le résultat est mémorisé : le catalogue est du code, il ne change pas d'un
 * appel à l'autre, et l'écran ne doit pas repayer la validation à chaque vue.
 */
let catalogue: BillingCatalogue | null = null

export function billingCatalogue(): BillingCatalogue {
  catalogue ??= parseBillingCatalogue([...billingOffers])

  return catalogue
}
