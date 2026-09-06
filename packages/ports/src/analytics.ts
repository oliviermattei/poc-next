/**
 * Le port `Analytics` — la **sixième** dépendance externe du dépôt à passer
 * derrière une interface (ADR 008), après `mailer`, `storage`, `payments`,
 * `rate-limit` et `jobs`.
 *
 * Les choix de forme du gabarit posé par `mailer.ts` sont repris tels quels et
 * ne sont pas redémontrés : un fichier par capacité, un résultat **discriminé**
 * plutôt qu'une exception, les collaborateurs injectés, la forme du journal
 * fermée. Ce qui suit ne dit que ce que ce port-ci ajoute.
 *
 * **Son échec dégrade, il ne refuse jamais** — la règle générale du dépôt
 * (`docs/reliability.md` §2, « pas d'analytics → l'application tourne »), et
 * l'inverse de `rate-limit.ts`, dont le magasin est notre propre base. Aucun
 * appelant de ce port n'a le droit de changer sa réponse parce qu'une mesure
 * n'est pas partie : c'est le critère 5 de s39, et il se mesure sur les
 * **appels sortants**, pas sur l'absence d'erreur.
 *
 * **C'est la seule surface que le code métier appelle pour mesurer.** Pas de
 * `posthog.capture()` dans un composant, pas de `fetch` vers un fournisseur
 * dans un cas d'usage : `tests/analytics.test.ts` balaie le dépôt et refuse le
 * contournement — avec son plancher, parce qu'un balayage sur zéro appelant est
 * vert sans rien vérifier (constat de s32).
 *
 * **Ce qu'il ne fait pas** : décider si l'on a le droit de mesurer. Le
 * consentement est déclaré au registre de s36 et appliqué avant le
 * **chargement** du script, donc bien avant qu'une méthode d'ici ne soit
 * appelée. Un port qui porterait la question du consentement en ferait une
 * décision de fournisseur.
 */

/**
 * Ce qu'une propriété d'événement a le droit d'être.
 *
 * Fermé aux trois scalaires, délibérément : un type ouvert (`unknown`, un objet)
 * invite à passer un objet métier entier — donc, tôt ou tard, un jeton ou une
 * adresse. L'implémentation **filtre** en plus par nom de champ
 * (`docs/security.md` §5), et le compilateur borne déjà ce qui peut entrer.
 */
export type AnalyticsPropertyValue = string | number | boolean

export type AnalyticsProperties = Readonly<Record<string, AnalyticsPropertyValue>>

/**
 * Un événement d'usage.
 *
 * `distinctId` identifie **la personne ou la session** chez le fournisseur. Il
 * est fourni par l'appelant, jamais deviné ici : c'est lui qui sait s'il mesure
 * un compte ou un visiteur anonyme.
 */
export interface AnalyticsEvent {
  /** Nom de l'événement, en `domaine.verbe` — `auth.signed_up`. */
  readonly name: string
  readonly distinctId: string
  readonly properties: AnalyticsProperties
}

/** Un affichage de page — l'autre moitié du critère 3. */
export interface AnalyticsPageView {
  /** Le chemin, jamais l'URL complète : une query porte souvent un jeton. */
  readonly path: string
  readonly distinctId: string
  readonly properties: AnalyticsProperties
}

/**
 * Les codes d'échec, **déclarés littéralement pour rester énumérables**.
 *
 * **Chaque code dit de quel côté il tombe**, comme ceux de `rate-limit.ts` et
 * de `jobs.ts` : `docs/reliability.md` §3 interdit de réessayer une erreur de
 * validation, et la politique de reprise lit ce classement au lieu de
 * l'inventer. La lecture exécutable est `isTransientAnalyticsError`
 * (`@repo/adapter-posthog`), et `tests/analytics.test.ts` la confronte aux
 * **annotations ci-dessous**, extraites de ce fichier : le mot « transitoire »
 * ou « définitif » écrit à côté d'un code est la déclaration, la fonction en est
 * la lecture, et les deux doivent dire la même chose. Un code ajouté sans
 * annotation rougit. **Ce test n'existait pas** quand ce commentaire l'a
 * annoncé la première fois (constat 4 de la revue de s39) : reclasser
 * `unauthorized` laissait alors la suite verte.
 */
export const ANALYTICS_ERROR_CODES = [
  /** Le fournisseur est injoignable, en panne, ou a rendu une erreur serveur. Transitoire. */
  'provider_unavailable',
  /** L'appel a dépassé son délai explicite. Transitoire. */
  'timeout',
  /** Le fournisseur a refusé le débit. Transitoire. */
  'rate_limited',
  /** La clé du fournisseur est refusée. **Définitif** : la rejouer ne la répare pas. */
  'unauthorized',
  /** L'événement n'a pas la forme attendue. **Définitif** — rejouer ne le corrige pas. */
  'invalid_event',
  /**
   * **Aucune clé configurée**, donc aucun appel réseau. **Définitif**, et ce
   * n'est pas une panne : c'est l'état livré du boilerplate.
   *
   * Il est une **valeur** plutôt qu'un `ok: true` silencieux pour une raison
   * mesurable : un `ok: true` rendrait indiscernables « c'est parti chez le
   * fournisseur » et « personne n'a rien reçu ». C'est la faute que le socle
   * nomme pour les modes locaux — un port qui se replie en silence ne peut plus
   * distinguer un vrai envoi d'un envoi capté, production comprise.
   */
  'not_configured',
] as const

/**
 * Pourquoi une mesure n'est pas partie.
 *
 * **Le type est dérivé de la liste, jamais écrit deux fois** : c'est ce qui rend
 * l'union énumérable à l'exécution, donc ce qui permet de confronter le
 * classement de l'adaptateur à la liste complète sans en recopier un seul code.
 */
export type AnalyticsErrorCode = (typeof ANALYTICS_ERROR_CODES)[number]

/**
 * L'échec, tel que l'appelant le reçoit.
 *
 * `message` est destiné à l'humain qui lit un journal : il est **assaini** par
 * l'implémentation (`docs/security.md` §5). Ni clé de projet, ni URL, ni
 * propriété d'événement ne doivent pouvoir y transiter.
 */
export interface AnalyticsError {
  readonly code: AnalyticsErrorCode
  readonly message: string
}

/**
 * Le résultat d'une mesure.
 *
 * **Discriminé**, comme les cinq ports précédents :
 * `tests/fixtures/typing/unhandled-analytics-failure.ts` le compile pour de vrai
 * et doit échouer. Ce que la garantie change ici : l'appelant ne peut pas
 * confondre « mesuré » et « rien n'est parti », donc il ne peut pas non plus
 * bâtir une décision produit sur une mesure qui n'a pas eu lieu.
 */
export type AnalyticsResult =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly error: AnalyticsError }

/**
 * La seule surface que le code métier appelle pour mesurer (critère 3 de s39).
 *
 * Deux méthodes, et deux seulement : l'événement et l'affichage de page.
 * Aucune ne lève, quoi qu'il arrive au fournisseur — corollaire opposable du
 * gabarit, prouvé chez l'implémentation.
 */
export interface Analytics {
  track(event: AnalyticsEvent): Promise<AnalyticsResult>
  page(view: AnalyticsPageView): Promise<AnalyticsResult>
}

/**
 * Ce qu'une mesure met au journal.
 *
 * **La forme est fermée**, comme celle des cinq ports précédents : il n'y a
 * **aucun champ** où mettre une propriété d'événement, un identifiant de
 * visiteur, une clé de projet ou un corps de requête. Ce qui est journalisé,
 * c'est le nom de l'événement, l'issue, et — quand il y a eu filtrage — les
 * **noms** des propriétés retirées, jamais leurs valeurs.
 *
 * `redacted` porte des noms de champs choisis par le développeur (`password`,
 * `token`), pas des données du visiteur : c'est ce qui permet à un exploitant de
 * voir qu'un appelant envoie n'importe quoi, sans que le journal devienne la
 * fuite qu'il dénonce.
 */
export interface AnalyticsLogRecord {
  readonly event: 'analytics.sent' | 'analytics.dropped' | 'analytics.failed'
  /** Nom de l'événement mesuré, jamais ses propriétés. */
  readonly name: string
  readonly code: AnalyticsErrorCode | null
  /** Message assaini par l'implémentation. */
  readonly message: string | null
  /** Noms des propriétés retirées avant envoi. Jamais leurs valeurs. */
  readonly redacted: readonly string[]
}

/** Le journal, injecté — ce port n'a besoin que d'écrire. */
export type AnalyticsLogger = (record: AnalyticsLogRecord) => void
