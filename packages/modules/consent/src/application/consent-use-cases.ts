import {
  consentHostCopyClearance,
  consentSetCookie,
  decodeConsentCookie,
} from '../domain/consent-cookie'
import {
  decideFrom,
  resolveConsentState,
  type ConsentState,
  type ConsentSubmission,
  type NonEssentialScript,
} from '../domain/consent-category'

/**
 * Les cas d'usage du consentement.
 *
 * Deux, et ils tiennent en dix lignes : lire l'état du visiteur, enregistrer sa
 * décision. Il n'y a **aucun port** — ni base, ni mailer, ni service tiers —
 * parce que ce module ne persiste rien (ADR 035) : la seule dépendance est la
 * liste des scripts non essentiels, que le point de composition de
 * l'application lui remet.
 */

export interface ConsentDependencies {
  /** Les scripts non essentiels **déclarés par les modules activés**. */
  readonly scripts: readonly NonEssentialScript[]
  /**
   * Les origines d'où une soumission est acceptée : celles que le déploiement
   * **configure** — le site et l'application (s64b1, ADR 079). Obligatoire :
   * une garde sans origine n'aurait rien à comparer.
   */
  readonly acceptedOrigins: readonly string[]
  /**
   * Le domaine parent du cookie, ou `null` pour un cookie propre à l'hôte
   * (s64c). Obligatoire, pour la même raison que `acceptedOrigins`.
   */
  readonly cookieDomain: string | null
}

/**
 * Ce qu'une décision enregistrée produit : des en-têtes `Set-Cookie`, et rien
 * d'autre — le choix, puis, avec un domaine parent, l'effacement de la copie
 * propre à l'hôte. **Dans cet ordre** : l'effacement ne vise que la copie sans
 * `Domain`, il ne touche pas au choix qui le précède.
 */
export interface RecordedConsent {
  readonly state: ConsentState
  readonly setCookies: readonly string[]
}

export interface ConsentUseCases {
  /** Les scripts déclarés, tels quels : l'écran de préférences en dérive ses cases. */
  readonly scripts: readonly NonEssentialScript[]
  /** Les origines configurées, que la garde de la route compare à `Origin`. */
  readonly acceptedOrigins: readonly string[]
  /** L'état du visiteur, lu dans son cookie. Une valeur illisible vaut « rien de décidé ». */
  readonly stateOf: (cookieValue: string | null | undefined) => ConsentState
  readonly record: (submission: ConsentSubmission) => RecordedConsent
}

export function createConsentUseCases(dependencies: ConsentDependencies): ConsentUseCases {
  const stateOf = (cookieValue: string | null | undefined): ConsentState =>
    resolveConsentState(dependencies.scripts, decodeConsentCookie(cookieValue))

  return {
    scripts: dependencies.scripts,
    acceptedOrigins: dependencies.acceptedOrigins,
    stateOf,
    record: (submission) => {
      // Les catégories **déclarées** décident de ce qui est enregistré : le
      // corps reçu ne peut ni en ajouter une, ni en taire une (le navigateur
      // n'envoie pas les cases décochées).
      const declared = resolveConsentState(dependencies.scripts, {}).declared
      const decisions = decideFrom(submission, declared)

      return {
        state: resolveConsentState(dependencies.scripts, decisions),
        setCookies:
          dependencies.cookieDomain === null
            ? [consentSetCookie(decisions, { domain: null })]
            : [
                consentSetCookie(decisions, { domain: dependencies.cookieDomain }),
                consentHostCopyClearance(),
              ],
      }
    },
  }
}
