/**
 * Le port `Mailer` — première dépendance externe du dépôt à passer derrière une
 * interface (ADR 008), et **le gabarit des cinq suivants** : storage (s18),
 * paiement (s19), jobs (s33), analytique et monitoring (s39).
 *
 * Trois choix de forme sont faits ici, et ils seront recopiés. Ils sont donc
 * écrits, avec ce qui les motive :
 *
 * 1. **Un fichier par capacité, un package pour tous les ports.**
 *    `docs/architecture.md` annonce `packages/ports/` au singulier et
 *    `packages/adapters/` contenant `resend`, `s3`, `stripe`… : un port est une
 *    poignée d'interfaces sans dépendance d'exécution, un adapter traîne un SDK.
 *    Un package par port multiplierait les manifestes sans rien isoler ; un
 *    package par adapter isole un SDK, ce qui est le seul isolement utile.
 *
 * 2. **`send` rend un résultat, elle ne lève pas.** Le critère de la story dit
 *    « remonté à l'appelant **sans faire tomber la requête** ». Une exception
 *    remonte aussi, mais elle remonte *par défaut* : l'appelant qui l'oublie
 *    rend un 500, et rien dans le type ne le lui rappelle. Un résultat
 *    discriminé oblige à regarder `ok` avant de lire `id` — le compilateur pose
 *    la question que la revue poserait. Corollaire opposable, prouvé par test :
 *    **aucune implémentation de ce port ne rejette**, quoi qu'il arrive au
 *    fournisseur.
 *
 * 3. **Le rendu est injecté, pas hérité.** Une implémentation reçoit son
 *    `EmailRenderer` ; elle ne connaît ni React, ni les templates. C'est ce qui
 *    permet à `@repo/adapter-resend` de ne dépendre que du SDK Resend, et à une
 *    doublure de n'avoir aucune dépendance du tout.
 *
 * Ce package ne contient **que** des types : aucune implémentation, aucune
 * doublure, aucun `import` d'exécution. Un port qui embarque du code met ce code
 * dans le graphe de tous ses appelants.
 */

/**
 * Données d'un template, injectées à sa place dans le sujet et le corps.
 *
 * Volontairement plates et scalaires : ce sont des valeurs à interpoler, pas un
 * modèle de vue. Une structure imbriquée signalerait une règle métier qui a
 * fui dans un email.
 */
export type EmailData = Readonly<Record<string, string | number>>

/**
 * Ce que le code métier demande : un destinataire, un sujet, un template, des
 * données.
 *
 * `locale` s'y ajoute parce que le contrat de module (ADR 007) déclare un
 * template **par locale** : sans elle, l'implémentation devrait deviner dans
 * quelle langue rendre, et le choix se ferait deux fois — une fois pour le
 * sujet, une fois pour le corps.
 *
 * `subject` est le sujet **non interpolé**, tel que le module le déclare
 * (`'Bienvenue {name}'`). Une seule fonction d'interpolation traite le sujet et
 * le corps ; interpoler le sujet chez l'appelant en ferait deux, qui
 * divergeraient.
 */
export interface SendEmailInput {
  readonly to: string
  readonly subject: string
  readonly template: string
  readonly locale: string
  readonly data: EmailData
}

/** Un email prêt à partir : sujet interpolé, corps rendu dans les deux formats. */
export interface RenderedEmail {
  readonly subject: string
  readonly html: string
  readonly text: string
}

/**
 * Rend un envoi en email.
 *
 * Injecté dans les implémentations du port. Il peut échouer — un template
 * inconnu, une locale non livrée, une donnée manquante sont des erreurs de
 * programmation — et il **lève** alors, contrairement à `send` : ce n'est pas
 * une panne de fournisseur à dégrader, c'est un défaut à corriger. Les
 * implémentations le rattrapent et le rendent en `invalid_request`.
 */
export type EmailRenderer = (input: SendEmailInput) => Promise<RenderedEmail>

/**
 * Pourquoi un envoi a échoué — et, indissociablement, **s'il faut le rejouer**.
 *
 * `docs/reliability.md` §3 : « Les reprises ne s'appliquent qu'aux erreurs
 * transitoires. Rejouer une erreur de validation est un défaut, pas une
 * précaution. » La distinction n'est donc pas documentaire : c'est
 * `isTransient` qui la lit, et un code de plus oblige à dire de quel côté il
 * tombe.
 */
export type MailerErrorCode =
  /** Requête refusée par le fournisseur (adresse invalide, template cassé). Définitif. */
  | 'invalid_request'
  /** Clé d'API absente, révoquée ou sans droit. Définitif — rejouer ne la rendra pas valide. */
  | 'unauthorized'
  /** Quota atteint. Transitoire. */
  | 'rate_limited'
  /** Fournisseur en panne ou injoignable. Transitoire. */
  | 'provider_unavailable'
  /** Délai d'attente dépassé (`docs/reliability.md` §3). Transitoire. */
  | 'timeout'

/**
 * L'échec, tel que l'appelant le reçoit.
 *
 * `message` est destiné à l'humain qui lit un journal ou une réponse d'erreur :
 * il est **assaini** par l'implémentation (`docs/security.md` §5). Ni clé
 * d'API, ni adresse, ni contenu d'email ne doivent pouvoir y transiter, y
 * compris quand c'est le fournisseur qui les a mis dans son propre message.
 */
export interface MailerError {
  readonly code: MailerErrorCode
  readonly message: string
  /** Nombre de tentatives réellement faites, reprises comprises. */
  readonly attempts: number
}

export type SendEmailResult =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly error: MailerError }

/**
 * La seule surface que le code métier appelle pour envoyer un email.
 *
 * Une seule méthode, et c'est délibéré : un port grossit par ajout de cas
 * particuliers (pièces jointes, envoi groupé, planification) dont aucun n'est
 * demandé. Le jour où l'un l'est, il s'ajoute ici et **toutes** les
 * implémentations doivent le porter — c'est exactement la friction voulue.
 */
export interface Mailer {
  send(input: SendEmailInput): Promise<SendEmailResult>
}

/**
 * Ce qu'une implémentation a le droit de journaliser d'un échec.
 *
 * La forme est fermée, et c'est la première ligne de défense de
 * `docs/security.md` §5 : il n'y a **aucun champ** où mettre le destinataire,
 * le sujet, le corps ou une clé d'API. Le compilateur refuse de les
 * journaliser ; il ne peut rien pour `message`, qui vient du fournisseur — d'où
 * l'assainissement, qui est prouvé par mutation côté adapter.
 */
export interface MailerLogRecord {
  readonly event: 'mailer.send_failed' | 'mailer.send_retried'
  /** Identifiant du template. Ce n'est pas une donnée personnelle. */
  readonly template: string
  readonly code: MailerErrorCode
  readonly attempts: number
  readonly message: string
}

/**
 * Le journal, injecté.
 *
 * Une fonction plutôt qu'une interface : ce port n'a besoin que d'écrire, et
 * une interface à une méthode se remplace par sa méthode. Le monitoring
 * complet est un port à part (s39).
 */
export type MailerLogger = (record: MailerLogRecord) => void
