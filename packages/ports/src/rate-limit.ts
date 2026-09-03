/**
 * Le port `RateLimiter` — la **quatrième** dépendance externe du dépôt à passer
 * derrière une interface (ADR 008, ADR 050), après `mailer`, `storage` et
 * `payments`.
 *
 * Les choix de forme du gabarit posé par `mailer.ts` sont repris tels quels et
 * ne sont pas redémontrés : un fichier par capacité, un résultat **discriminé**
 * plutôt qu'une exception, les collaborateurs injectés, la forme du journal
 * fermée. Ce qui suit ne dit que ce que ce port-ci ajoute.
 *
 * **Ce qu'il remplace.** Deux compteurs locaux existaient avant lui —
 * `public_form_throttle` (s11) et `billing_checkout_throttle` (s24) — écrits
 * chacun parce que sa story ouvrait le premier point d'entrée public de son
 * module. Ils ont la même forme, la même fenêtre fixe et le même défaut : deux
 * implémentations d'une règle de sécurité divergent au premier seuil ajusté.
 * s28 les fait converger ici. Leurs tables **restent en place, inertes** : le
 * socle de fiabilité impose de cesser d'écrire avant de supprimer, et leur
 * suppression appartient à une story ultérieure (ADR 050).
 *
 * **Pourquoi un port, alors que l'implémentation est notre propre base.** Parce
 * que la limitation est sur le chemin de chaque requête publique et qu'il faut
 * pouvoir la **neutraliser dans les tests par injection**, sans qu'aucune
 * variable d'environnement ne puisse la désactiver en production (critère 8 de
 * s28). Un compteur appelé directement depuis le répartiteur n'aurait laissé
 * que la seconde voie, et une variable qui éteint une protection **est** une
 * porte — ce dépôt a payé deux fois cette leçon (`SKIP_ENV_VALIDATION`, s26
 * puis s27).
 *
 * **Ce que ce port ne fait pas** : décider. Il compte et il rend des comptes ;
 * c'est l'appelant — le répartiteur — qui traduit un dépassement en 429, et le
 * domaine qui aligne les fenêtres et calcule le `Retry-After`. Un port qui
 * déciderait ferait de chaque appelant un endroit où la règle peut différer.
 */

/**
 * Un seau à faire avancer : sa clé, son seuil, sa fenêtre.
 *
 * La clé est construite par l'appelant, en clair ; c'est l'implémentation qui la
 * **condense** avant de l'écrire. Aucune adresse IP, aucune adresse email
 * n'entre en clair dans le magasin — la même règle que celle que les deux
 * tables remplacées portaient déjà.
 *
 * `windowSeconds` voyage avec le seau plutôt que d'être une propriété du
 * limiteur : deux seaux d'une même requête n'ont aucune raison de partager la
 * même fenêtre — le seau par compte visé d'une connexion est plus large que
 * celui de l'appelant, parce que l'attaque qu'il vise est plus lente.
 */
export interface RateLimitBucketRequest {
  readonly key: string
  /** Passages tolérés dans la fenêtre, celui en cours compris. */
  readonly max: number
  readonly windowSeconds: number
}

/**
 * L'état d'un seau **après** son passage.
 *
 * `hits` inclut le passage en cours : le seuil est atteint sans être dépassé
 * quand `hits === max`. C'est la convention des deux compteurs remplacés, et la
 * changer refuserait le dernier passage annoncé comme permis.
 *
 * `retryAfterSeconds` est **le temps restant de la fenêtre réelle**, jamais une
 * constante : un `Retry-After` figé pendant que la fenêtre avance ment, et un
 * client honnête réessaie trop tôt — donc se fait refuser une seconde fois pour
 * avoir cru la réponse.
 */
export interface RateLimitBucketState {
  readonly key: string
  readonly hits: number
  readonly max: number
  readonly exceeded: boolean
  readonly retryAfterSeconds: number
}

export interface ConsumeRateLimitInput {
  /**
   * Les seaux de **cette** requête, tous consommés ensemble.
   *
   * Ensemble, et non l'un après l'autre : un appelant qui s'arrêterait au
   * premier seau dépassé ne ferait pas avancer le second, et un attaquant qui
   * sature volontairement son propre seau d'appelant rendrait invisible le seau
   * par compte — c'est-à-dire exactement le seau qui voit le bourrage
   * distribué.
   */
  readonly buckets: readonly RateLimitBucketRequest[]
  /** L'instant de référence. Injecté, jamais lu du système par le port. */
  readonly now: Date
}

/**
 * Pourquoi une consommation a échoué.
 *
 * Deux codes, et un seul est une panne. `invalid_bucket` est définitif — un
 * seuil nul ou négatif est un défaut de configuration, pas un incident, et le
 * rejouer ne le réparerait pas (`docs/reliability.md` §3).
 */
export type RateLimitErrorCode =
  /** Le magasin est injoignable, en panne, ou la requête a expiré. Transitoire. */
  | 'store_unavailable'
  /** Le seau demandé n'a pas de sens : seuil nul ou négatif, fenêtre nulle. Définitif. */
  | 'invalid_bucket'

/**
 * L'échec, tel que l'appelant le reçoit.
 *
 * `message` est destiné à l'humain qui lit un journal : il est **assaini** par
 * l'implémentation (`docs/security.md` §5). Aucune clé de seau, donc aucune
 * adresse, ne doit pouvoir y transiter.
 */
export interface RateLimitError {
  readonly code: RateLimitErrorCode
  readonly message: string
}

/**
 * Le résultat d'une consommation.
 *
 * **Discriminé, et c'est la garantie qui compte ici.** Le compilateur force
 * l'appelant à écarter l'échec avant de lire les seaux, si bien qu'un magasin
 * indisponible ne peut pas devenir un chemin qui laisse passer par distraction.
 * `tests/fixtures/typing/unhandled-rate-limit-failure.ts` le compile pour de
 * vrai et doit échouer.
 */
export type ConsumeRateLimitResult =
  | { readonly ok: true; readonly buckets: readonly RateLimitBucketState[] }
  | { readonly ok: false; readonly error: RateLimitError }

/**
 * Le résultat d'un balayage des fenêtres closes.
 *
 * Il rend le nombre de lignes effacées parce qu'une purge se **prouve en
 * l'exécutant** (`docs/reliability.md` §1), pas en la déclarant.
 */
export type SweepRateLimitResult =
  | { readonly ok: true; readonly removed: number }
  | { readonly ok: false; readonly error: RateLimitError }

/**
 * La seule surface que le code appelle pour compter.
 *
 * Aucune de ces méthodes ne lève, quoi qu'il arrive au magasin — corollaire
 * opposable du gabarit, prouvé chez l'implémentation, y compris au cas où le
 * pilote de base lèverait lui-même.
 */
export interface RateLimiter {
  consume(input: ConsumeRateLimitInput): Promise<ConsumeRateLimitResult>

  /**
   * Efface les seaux dont **leur propre** fenêtre est close à cet instant.
   *
   * Sans lui, le magasin ne se vide jamais : il y a un seau par identifiant
   * d'appelant, et cet identifiant vient d'un en-tête que le client écrit
   * lui-même — la revue de s11 avait mesuré 500 identifiants distincts, 500
   * lignes, et rien pour les reprendre.
   *
   * **Le paramètre est l'instant présent, pas une borne arbitraire**, et la
   * distinction est ce que la revue de s28 a dû faire ajouter (constat C1). Le
   * magasin est partagé par toutes les routes, et les seaux n'ont pas la même
   * durée : une borne « efface tout ce qui précède » ne peut pas dire si une
   * ligne est close, et effaçait les seaux longs encore ouverts des autres
   * routes. C'est la **ligne** qui porte son échéance ; ce paramètre ne fait que
   * dire quand on regarde.
   *
   * **Un instant passé ne peut donc que retarder la récupération** — jamais
   * effacer un seau ouvert. C'est la propriété qui rend l'appel sûr depuis
   * n'importe quel appelant, quelle que soit la fenêtre qu'il connaît.
   */
  sweep(now: Date): Promise<SweepRateLimitResult>
}

/**
 * Ce qu'un dépassement met au journal (critère 6 de s28).
 *
 * **La forme est fermée, et elle ne condense pas** — à la différence du
 * magasin, qui condense. Les deux règles diffèrent, et c'est assumé : la table
 * conserve ses lignes au-delà de l'incident et n'a aucune raison de porter une
 * adresse, alors qu'un journal d'incident sans l'adresse ni la route ne sert à
 * rien. C'est précisément ce que le critère demande.
 *
 * Il n'y a **aucun champ** où mettre un corps de requête, un mot de passe, un
 * jeton ou une adresse email : le compte visé n'apparaît que dans la clé
 * condensée du seau, jamais ici.
 */
export interface RateLimitLogRecord {
  readonly event: 'rate_limit.exceeded' | 'rate_limit.store_unavailable'
  /** La route concernée, telle que le module la déclare. */
  readonly route: string
  readonly method: string
  /** L'appelant, en clair : c'est ce que le critère 6 demande. */
  readonly client: string
  /** Lequel des seaux a refusé — jamais sa clé, qui porte le compte visé. */
  readonly bucket: 'client' | 'subject' | null
  readonly retryAfterSeconds: number
}

/** Le journal, injecté — ce port n'a besoin que d'écrire. */
export type RateLimitLogger = (record: RateLimitLogRecord) => void
