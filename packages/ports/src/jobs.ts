/**
 * Le port `Jobs` — la **cinquième** dépendance externe du dépôt à passer
 * derrière une interface (ADR 008), après `mailer`, `storage`, `payments` et
 * `rate-limit`.
 *
 * Les choix de forme du gabarit posé par `mailer.ts` sont repris tels quels et
 * ne sont pas redémontrés : un fichier par capacité, un résultat **discriminé**
 * plutôt qu'une exception, les collaborateurs injectés, la forme du journal
 * fermée. Ce qui suit ne dit que ce que ce port-ci ajoute.
 *
 * **Ce qu'il ne remplace pas : la déclaration.** Le contrat de module porte
 * `jobs` depuis le premier module écrit — `ModuleJob { id, schedule, run }` —,
 * et cette clé reste la seule façon de déclarer un traitement. Créer ici une
 * seconde façon de déclarer ferait deux vérités pour une même chose. Le port ne
 * porte donc que l'**émission** ; la surface unique que le critère 1 de s33
 * demande est la paire *port d'émission + clé `jobs` du contrat*, et c'est le
 * répartiteur (`dispatchModuleJob`, `@repo/core`) qui les réunit.
 *
 * **Ce que ce port ne fait pas** : exécuter. Il met en file — chez le
 * fournisseur, en mémoire, ou immédiatement quand le module est coupé — et rend
 * compte de la mise en file, jamais du résultat du traitement. Un `ok: true`
 * dit « c'est parti », pas « c'est fait » ; le résultat, lui, se lit au journal
 * du répartiteur.
 *
 * **Son échec dégrade, il ne refuse pas** — la règle générale du dépôt
 * (`docs/reliability.md` §2), et la différence assumée avec `rate-limit.ts`,
 * dont le magasin est notre propre base. Un fournisseur de jobs absent ne doit
 * pas empêcher la requête qui émettait de répondre : le repli est l'exécution
 * synchrone (critère 8 de s33).
 */

/**
 * Ce qu'on met en file : **quel job déclaré**, sous **quelle clé**, avec quelles
 * références.
 *
 * `job` est l'identifiant **qualifié** du job tel que le registre l'expose —
 * `<module>.<job>` —, jamais un nom d'événement libre. C'est ce qui rend
 * `unknown_job` détectable : un job qui n'est pas déclaré par un module activé
 * n'a aucune chance de s'exécuter, et il vaut mieux le savoir à l'émission.
 *
 * `key` est la **clé d'idempotence de cette exécution-là**. Elle est construite
 * par l'appelant, parce que lui seul sait ce que « la même exécution » veut
 * dire : la même échéance d'essai, le même quart d'heure de balayage, le même
 * identifiant d'abonnement. Deux émissions de même clé produisent **un** effet
 * (`docs/reliability.md` §1), et c'est prouvé en rejouant, jamais affirmé.
 *
 * `data` ne porte que des **références** — un identifiant d'abonnement, une
 * date. Jamais un secret, jamais une donnée personnelle : la charge utile est
 * écrite chez le fournisseur, relue à l'exécution, et souvent journalisée en
 * chemin. C'est la règle que la revue de s32 a posée pour tout ce qui est écrit
 * puis relu, et `docs/security.md` §5 pour le reste. Les valeurs sont des
 * chaînes : un type ouvert invite à y mettre un objet métier entier.
 */
export interface JobEmission {
  /** Identifiant qualifié du job déclaré : `<module>.<job>`. */
  readonly job: string
  /** Clé d'idempotence de cette exécution. Deux émissions de même clé, un effet. */
  readonly key: string
  /** Références seulement — ni secret, ni donnée personnelle. */
  readonly data: Readonly<Record<string, string>>
}

/**
 * Les codes d'échec, **déclarés littéralement pour rester énumérables**.
 *
 * **Chaque code dit de quel côté il tombe**, et ce n'est pas de la
 * documentation : `docs/reliability.md` §3 interdit de réessayer une erreur de
 * validation, et la distinction ne peut pas s'inventer au niveau de la
 * politique de reprise — elle est portée ici, une fois.
 * `isTransientJobsError` (`@repo/core`) et `isTransientInngestError`
 * (`@repo/adapter-inngest`) sont les deux lectures exécutables de ce classement ;
 * le compilateur force chacune à les traiter tous, et `tests/jobs.test.ts` les
 * confronte l'une à l'autre sur cette liste.
 */
export const JOBS_ERROR_CODES = [
  /** Le fournisseur est injoignable, en panne, ou a rendu une erreur serveur. Transitoire. */
  'provider_unavailable',
  /** L'appel a dépassé son délai explicite. Transitoire. */
  'timeout',
  /** Le fournisseur a refusé le débit. Transitoire. */
  'rate_limited',
  /** La clé du fournisseur est refusée. **Définitif** : la rejouer ne la répare pas. */
  'unauthorized',
  /**
   * L'événement ou sa charge utile n'a pas la forme attendue. **Définitif.**
   *
   * C'est le code que porte une erreur de validation — celle que
   * `docs/reliability.md` §3 nomme en toutes lettres : « transient errors only —
   * retrying a validation error is a defect ». Le rejeu ne changerait pas la
   * charge utile ; il ne ferait que multiplier l'échec.
   */
  'invalid_event',
  /**
   * Aucun module activé ne déclare ce job. **Définitif.**
   *
   * Le cas existe pour de bon : un module coupé emporte ses jobs, et un
   * appelant du socle peut émettre vers un job qui n'est plus là. Le refuser en
   * le nommant vaut mieux qu'une file qui grossit sans consommateur — c'est
   * exactement l'état que s33 corrige.
   */
  'unknown_job',
] as const

/**
 * Pourquoi une émission ou une exécution a échoué.
 *
 * **Le type est dérivé de la liste, jamais écrit deux fois** — la forme de
 * `SUBSCRIPTION_STATUSES` dans le domaine de la facturation. C'est ce qui rend
 * l'union **énumérable à l'exécution**, donc ce qui permet à `tests/jobs.test.ts`
 * de confronter les deux classements — celui du socle et celui de l'adaptateur —
 * sur tous les codes, sans en recopier aucun. Sans cette liste, le compilateur
 * force chacun à **traiter** tous les codes, et rien ne les force à **dire la
 * même chose** (constat b de la seconde revue de s33).
 */
export type JobsErrorCode = (typeof JOBS_ERROR_CODES)[number]

/**
 * L'échec, tel que l'appelant le reçoit.
 *
 * `message` est destiné à l'humain qui lit un journal : il est **assaini** par
 * l'implémentation (`docs/security.md` §5). Ni clé de fournisseur, ni URL
 * signée, ni charge utile ne doivent pouvoir y transiter.
 */
export interface JobsError {
  readonly code: JobsErrorCode
  readonly message: string
}

/**
 * Le résultat d'une mise en file.
 *
 * **Discriminé, et c'est la garantie qui compte ici.** Le compilateur force
 * l'appelant à écarter l'échec avant de lire l'identifiant, si bien qu'une
 * émission perdue ne peut pas passer pour une émission réussie. La nuance vaut
 * plus que pour les autres ports : un email non parti finit par se voir, un
 * traitement jamais mis en file ne se voit **jamais** dans la requête qui l'a
 * demandé. `tests/fixtures/typing/unhandled-jobs-failure.ts` le compile pour de
 * vrai et doit échouer.
 */
export type EmitJobResult =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly error: JobsError }

/**
 * La seule surface que le code métier appelle pour différer un traitement.
 *
 * Une méthode, et une seule : l'autre moitié de la surface est la clé `jobs` du
 * contrat de module. Aucune méthode ne lève, quoi qu'il arrive au fournisseur —
 * corollaire opposable du gabarit, prouvé chez chaque implémentation.
 */
export interface Jobs {
  emit(emission: JobEmission): Promise<EmitJobResult>
}

/**
 * Ce qu'une exécution met au journal (critères 4 et 5 de s33).
 *
 * **La forme est fermée**, comme celle des quatre ports précédents : il n'y a
 * **aucun champ** où mettre une charge utile, une clé de fournisseur, une
 * adresse ou un corps de requête. Ce qui est journalisé d'une exécution, c'est
 * son job, sa clé d'idempotence, son numéro de tentative et, en cas d'échec,
 * son code et un message assaini.
 *
 * Les six événements ne sont pas décoratifs — chacun répond à une question
 * qu'un exploitant se pose : est-ce parti (`emit_failed` quand non), est-ce
 * passé (`started`/`succeeded`), a-t-on rejoué pour rien (`skipped`), est-ce
 * en train de réessayer (`retrying`), a-t-on renoncé (`failed`).
 */
export interface JobsLogRecord {
  readonly event:
    | 'job.emit_failed'
    | 'job.started'
    | 'job.succeeded'
    | 'job.skipped'
    | 'job.retrying'
    | 'job.failed'
  /** Identifiant qualifié du job. */
  readonly job: string
  /** Clé d'idempotence de l'exécution — une référence, jamais une donnée. */
  readonly key: string
  /** Numéro de la tentative, à partir de 1. */
  readonly attempt: number
  readonly code: JobsErrorCode | null
  /** Message assaini par l'implémentation. */
  readonly message: string | null
}

/** Le journal, injecté — ce port n'a besoin que d'écrire. */
export type JobsLogger = (record: JobsLogRecord) => void
