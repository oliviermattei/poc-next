/**
 * Le port `Monitoring` — la **septième** dépendance externe du dépôt à passer
 * derrière une interface (ADR 008), livrée en même temps que `analytics.ts`.
 *
 * Le gabarit de `mailer.ts` est repris tel quel. Ce qui suit ne dit que ce que
 * ce port-ci ajoute.
 *
 * **Son échec dégrade, il ne refuse jamais**, exactement comme `analytics.ts` :
 * une remontée d'erreur qui échoue ne doit pas transformer une erreur en deux.
 * C'est la règle générale (`docs/reliability.md` §2), et depuis s39 elle est de
 * nouveau majoritaire chez les ports — `rate-limit.ts` reste la seule exception,
 * pour la raison écrite dans `packages/ports/AGENTS.md`.
 *
 * **Ce port n'est pas appelé par le code métier, et c'est sa différence avec
 * les six autres.** Une erreur non gérée n'est pas un geste : elle est
 * *attrapée*, aux deux points d'instrumentation de l'application — le crochet
 * serveur de Next (`instrumentation.ts`, `onRequestError`) et la frontière
 * d'erreur du navigateur. Le port existe quand même, parce que ce sont ces deux
 * points-là qui ont besoin d'une surface typée qui ne lève pas : lever depuis un
 * gestionnaire d'erreur remplacerait l'erreur d'origine par la nôtre.
 */

/**
 * D'où vient l'erreur. Deux valeurs, parce que le critère 1 de s39 en demande
 * deux : « une erreur non gérée côté serveur **et** côté client ».
 */
export const MONITORING_ORIGINS = ['server', 'client'] as const

export type MonitoringOrigin = (typeof MONITORING_ORIGINS)[number]

/**
 * Une erreur non gérée, telle que le fournisseur la reçoit.
 *
 * `stack` est la trace **non minifiée chez le fournisseur** : les cartes source
 * sont envoyées au build (`scripts/source-maps.ts`), jamais servies au visiteur.
 * Elle est ici en `string | null` parce qu'une erreur levée dans un navigateur
 * ancien peut n'en avoir aucune, et qu'un port ne devine rien.
 *
 * `context` ne porte que des **références** — une route, un identifiant de
 * requête, une locale. Jamais un corps, jamais un en-tête, jamais un cookie :
 * `docs/security.md` §5 interdit qu'un secret atteigne un journal, une réponse
 * d'erreur **ou la télémétrie**, et c'est cette dernière moitié que le critère 2
 * demande de prouver. Le compilateur borne la forme ; l'implémentation filtre
 * les noms de champs sensibles, et la preuve porte sur la **requête capturée**.
 */
export interface MonitoringEvent {
  /** Le message de l'erreur, assaini par l'implémentation. */
  readonly message: string
  /** Le nom du type levé — `TypeError`, `Error`. */
  readonly type: string
  readonly stack: string | null
  readonly origin: MonitoringOrigin
  /** La version déployée, pour que le fournisseur retrouve les cartes source. */
  readonly release: string | null
  /** Des références seulement — ni secret, ni donnée personnelle. */
  readonly context: Readonly<Record<string, string>>
}

/**
 * Les codes d'échec, **déclarés littéralement pour rester énumérables**, et
 * chacun annote de quel côté il tombe — même règle que `jobs.ts` et
 * `analytics.ts`. `isTransientMonitoringError` (`@repo/adapter-sentry`) en est
 * la lecture exécutable, et `tests/analytics.test.ts` confronte les deux :
 * l'annotation écrite ici est extraite de ce fichier, jamais recopiée.
 */
export const MONITORING_ERROR_CODES = [
  /** Le fournisseur est injoignable, en panne, ou a rendu une erreur serveur. Transitoire. */
  'provider_unavailable',
  /** L'appel a dépassé son délai explicite. Transitoire. */
  'timeout',
  /** Le fournisseur a refusé le débit. Transitoire. */
  'rate_limited',
  /** La clé du projet est refusée. **Définitif**. */
  'unauthorized',
  /** L'événement n'a pas la forme attendue. **Définitif**. */
  'invalid_event',
  /** **Aucun DSN configuré**, donc aucun appel réseau. **Définitif**, et ce n'est pas une panne. */
  'not_configured',
] as const

export type MonitoringErrorCode = (typeof MONITORING_ERROR_CODES)[number]

export interface MonitoringError {
  readonly code: MonitoringErrorCode
  readonly message: string
}

/**
 * Le résultat d'une remontée. Discriminé comme les six autres ports —
 * `tests/fixtures/typing/unhandled-monitoring-failure.ts` doit échouer à
 * compiler.
 */
export type CaptureResult =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly error: MonitoringError }

/** La seule surface par laquelle une erreur atteint le fournisseur. */
export interface Monitoring {
  capture(event: MonitoringEvent): Promise<CaptureResult>
}

/**
 * Ce qu'une remontée met au journal.
 *
 * **Forme fermée** : aucun champ où mettre une trace, un contexte, un DSN ou un
 * corps de requête. Le journal dit qu'une erreur est partie — ou pourquoi elle
 * n'est pas partie —, il ne redit pas l'erreur, que le processus a déjà écrite.
 */
export interface MonitoringLogRecord {
  readonly event: 'monitoring.sent' | 'monitoring.dropped' | 'monitoring.failed'
  readonly origin: MonitoringOrigin
  /** Le nom du type levé, jamais son message. */
  readonly type: string
  readonly code: MonitoringErrorCode | null
  /** Message assaini par l'implémentation. */
  readonly message: string | null
  /** Noms des champs de contexte retirés avant envoi. Jamais leurs valeurs. */
  readonly redacted: readonly string[]
}

export type MonitoringLogger = (record: MonitoringLogRecord) => void
