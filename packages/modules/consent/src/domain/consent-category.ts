/**
 * Les catégories de consentement, et ce qu'elles autorisent.
 *
 * Une **union fermée**, et courte : deux catégories que le visiteur peut
 * distinguer sans effort. Elles ne décrivent pas des fournisseurs mais des
 * **finalités**, ce qui est la forme que la loi demande — « mesure d'audience »
 * et « publicité » sont des raisons, `posthog` et `google-ads` seraient des
 * noms de sociétés.
 *
 * Les cookies strictement nécessaires — session, langue, ce consentement
 * lui-même — n'ont pas de catégorie ici : ils ne sont pas soumis au choix, et
 * leur donner une case laisserait croire l'inverse.
 *
 * `advertising` plutôt que `marketing` : le dépôt a déjà un module qui porte ce
 * nom, et deux notions homonymes dans le même produit finissent par être
 * confondues.
 */
export const CONSENT_CATEGORIES = ['analytics', 'advertising'] as const

/** L'identifiant du module, écrit une fois : ni le contrat ni les clés ne le recopient. */
export const CONSENT_MODULE_ID = 'consent'

export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number]

/**
 * Un script que le produit ne charge **qu'après** consentement.
 *
 * `src` est une URL servie par le produit ou par un tiers. **Rien à déclarer
 * dans `config/security.ts`** pour un navigateur CSP 3 : la politique livrée porte
 * `'strict-dynamic'`
 * dans `script-src`, et un navigateur CSP 3 **ignore alors `'self'` et toute
 * source d'hôte**. C'est le **nonce** de la requête qui autorise la balise, et
 * `ConsentScripts` le porte déjà. Mesuré sous le build de production (ADR 036,
 * revue de s36) : nonce faux, le script est refusé quelle que soit la liste
 * d'origines. `'strict-dynamic'` ne vaut que pour `script-src` : les appels
 * réseau du fournisseur, eux, demandent toujours son origine dans les champs
 * `connect` et `img` de `config/security.ts`. C'est ce que s39 doit savoir
 * avant d'ajouter sa ligne.
 */
export interface NonEssentialScript {
  readonly id: string
  readonly category: ConsentCategory
  readonly src: string
}

/** Ce que le visiteur a décidé, catégorie par catégorie. Absente = non décidée. */
export type ConsentDecisions = Readonly<Partial<Record<ConsentCategory, boolean>>>

/** L'état lisible d'une catégorie, tel que l'écran de préférences l'affiche. */
export const CONSENT_STATUSES = ['granted', 'denied', 'undecided'] as const

export type ConsentStatus = (typeof CONSENT_STATUSES)[number]

export interface ConsentState {
  /** Les catégories qu'au moins un script déclare. Vide = module inerte. */
  readonly declared: readonly ConsentCategory[]
  readonly granted: readonly ConsentCategory[]
  readonly denied: readonly ConsentCategory[]
  readonly undecided: readonly ConsentCategory[]
  /** Reste-t-il une catégorie déclarée sur laquelle le visiteur ne s'est pas prononcé ? */
  readonly bannerRequired: boolean
  /** Les scripts que l'application a le droit de charger, **maintenant**. */
  readonly allowedScripts: readonly NonEssentialScript[]
}

/**
 * Les catégories déclarées, dans l'ordre du produit et sans doublon.
 *
 * L'ordre vient de `CONSENT_CATEGORIES`, jamais de celui des scripts : deux
 * déploiements qui déclarent les mêmes scripts dans un ordre différent doivent
 * montrer les mêmes cases dans le même ordre.
 */
export const declaredCategories = (
  scripts: readonly NonEssentialScript[],
): readonly ConsentCategory[] =>
  CONSENT_CATEGORIES.filter((category) => scripts.some((script) => script.category === category))

/**
 * L'état du consentement : ce qui est déclaré, ce qui est décidé, ce qui peut
 * être chargé.
 *
 * **Rien n'est autorisé par défaut.** Une catégorie sur laquelle personne ne
 * s'est prononcé n'autorise aucun script : c'est la différence entre un
 * consentement et une absence d'opposition, et c'est toute la conformité de ce
 * module.
 *
 * Une décision portant sur une catégorie qu'aucun script ne déclare est
 * **ignorée** : elle ne peut rien autoriser, et la faire apparaître à l'écran
 * proposerait de régler quelque chose qui n'existe pas.
 */
export function resolveConsentState(
  scripts: readonly NonEssentialScript[],
  decisions: ConsentDecisions,
): ConsentState {
  const declared = declaredCategories(scripts)
  const granted = declared.filter((category) => decisions[category] === true)
  const denied = declared.filter((category) => decisions[category] === false)
  const undecided = declared.filter((category) => decisions[category] === undefined)

  return {
    declared,
    granted,
    denied,
    undecided,
    bannerRequired: undecided.length > 0,
    allowedScripts: scripts.filter((script) => granted.includes(script.category)),
  }
}

/** L'état d'une catégorie, pour l'écran qui l'affiche. */
export function statusOf(state: ConsentState, category: ConsentCategory): ConsentStatus {
  if (state.granted.includes(category)) {
    return 'granted'
  }

  return state.denied.includes(category) ? 'denied' : 'undecided'
}

/** Ce que le visiteur demande : les trois boutons, et rien d'autre. */
export const CONSENT_INTENTS = ['accept-all', 'refuse-all', 'save'] as const

export type ConsentIntent = (typeof CONSENT_INTENTS)[number]

export interface ConsentSubmission {
  readonly intent: ConsentIntent
  /** Les catégories cochées. Une case décochée n'est pas envoyée par le navigateur. */
  readonly categories: readonly string[]
}

/**
 * Les décisions que produit une soumission.
 *
 * **La liste déclarée décide, jamais le corps reçu.** Un navigateur n'envoie
 * pas les cases décochées : sans cette liste, « enregistrer » avec tout décoché
 * serait indistinguable de « ne rien changer », et le retrait de consentement —
 * la moitié qui compte — serait impossible. C'est aussi ce qui rend le corps
 * inoffensif : une catégorie inventée par l'appelant n'entre nulle part.
 */
export function decideFrom(
  submission: ConsentSubmission,
  declared: readonly ConsentCategory[],
): ConsentDecisions {
  const decisions: Partial<Record<ConsentCategory, boolean>> = {}

  for (const category of declared) {
    decisions[category] =
      submission.intent === 'accept-all' ||
      (submission.intent === 'save' && submission.categories.includes(category))
  }

  return decisions
}
