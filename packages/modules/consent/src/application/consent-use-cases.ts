import {
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
}

/** Ce qu'une décision enregistrée produit : un en-tête, et rien d'autre. */
export interface RecordedConsent {
  readonly state: ConsentState
  readonly setCookie: string
}

export interface ConsentUseCases {
  /** Les scripts déclarés, tels quels : l'écran de préférences en dérive ses cases. */
  readonly scripts: readonly NonEssentialScript[]
  /** L'état du visiteur, lu dans son cookie. Une valeur illisible vaut « rien de décidé ». */
  readonly stateOf: (cookieValue: string | null | undefined) => ConsentState
  readonly record: (submission: ConsentSubmission) => RecordedConsent
}

export function createConsentUseCases(dependencies: ConsentDependencies): ConsentUseCases {
  const stateOf = (cookieValue: string | null | undefined): ConsentState =>
    resolveConsentState(dependencies.scripts, decodeConsentCookie(cookieValue))

  return {
    scripts: dependencies.scripts,
    stateOf,
    record: (submission) => {
      // Les catégories **déclarées** décident de ce qui est enregistré : le
      // corps reçu ne peut ni en ajouter une, ni en taire une (le navigateur
      // n'envoie pas les cases décochées).
      const declared = resolveConsentState(dependencies.scripts, {}).declared
      const decisions = decideFrom(submission, declared)

      return {
        state: resolveConsentState(dependencies.scripts, decisions),
        setCookie: consentSetCookie(decisions),
      }
    },
  }
}
