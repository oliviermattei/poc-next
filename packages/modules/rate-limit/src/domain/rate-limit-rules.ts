/**
 * **La règle de limitation de débit, écrite une fois** (s28) — la règle, pas le
 * compteur.
 *
 * Le compteur vit en base (`../infrastructure/drizzle-rate-limiter.ts`), donc
 * **partagé entre instances** : `docs/security.md` §7 l'exige, et un compteur en
 * mémoire de processus se contourne en scalant horizontalement. Ce fichier ne
 * compte rien et n'ouvre rien ; il dit quelles fenêtres et quels seaux existent.
 *
 * **Il remplace deux copies.** `marketing/domain/rate-limit.ts` (s11) et
 * `billing/domain/checkout-throttle.ts` (s24) portaient la même règle, écrite
 * deux fois, avec deux tables. Chacune annonçait sa propre dette. Elles
 * convergent ici, et leurs tables restent en place, inertes, parce que le socle
 * de fiabilité impose de cesser d'écrire avant de supprimer (ADR 050).
 *
 * **Fenêtre fixe, pas fenêtre glissante.** Une fenêtre glissante demande de
 * garder chaque passage ; une fenêtre fixe tient en une ligne par seau et une
 * seule instruction atomique. Le prix est connu et borné : à cheval sur deux
 * fenêtres, un appelant peut passer jusqu'à deux fois le seuil. C'est le prix
 * qu'acceptaient déjà les deux implémentations remplacées, et il se paie sur le
 * seau de l'appelant — celui qui repose de toute façon sur un en-tête
 * falsifiable. Le seau par **compte visé**, lui, ne dépend d'aucun en-tête.
 */

/**
 * L'identifiant employé quand aucun en-tête ne dit d'où vient la requête.
 *
 * Tout le monde partage alors le **même** seau. C'est délibérément le choix le
 * plus strict : l'inverse — un identifiant unique par requête — rendrait la
 * limite par appelant inopérante précisément là où on ne sait rien de
 * l'appelant.
 */
export const UNKNOWN_CLIENT = 'unknown'

/**
 * Ce que le serveur croit savoir de l'appelant.
 *
 * **Falsifiable, et il faut le dire** : hors d'un proxy de confiance qui
 * réécrit `x-forwarded-for`, n'importe qui peut poser la valeur de son choix.
 * Le seau par appelant est donc une gêne contre le martèlement naïf, **pas une
 * barrière** — c'est exactement pourquoi la connexion porte aussi un seau par
 * compte visé, que nul en-tête ne déplace.
 *
 * Le **premier** maillon de la chaîne est le client ; les suivants sont les
 * relais. Prendre le dernier ferait tomber tous les visiteurs d'un même
 * hébergeur dans un seul seau.
 */
export function clientIdentifierOf(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim()

  if (forwarded !== undefined && forwarded !== '') {
    return forwarded
  }

  const real = headers.get('x-real-ip')?.trim()

  return real === undefined || real === '' ? UNKNOWN_CLIENT : real
}

/**
 * Le début de la fenêtre fixe qui contient cet instant.
 *
 * **Aligné sur la durée**, pas sur le premier appel : deux instances démarrées
 * à une seconde d'écart compteraient sinon dans deux fenêtres décalées, et un
 * compteur « partagé » ne le serait plus qu'en apparence.
 */
export function windowStartOf(now: Date, windowSeconds: number): Date {
  const span = windowSeconds * 1_000

  return new Date(Math.floor(now.getTime() / span) * span)
}

/**
 * Ce que vaut honnêtement un `Retry-After` : **le temps qui reste de la fenêtre
 * réelle**.
 *
 * Une constante égale à la durée de la fenêtre mentirait de presque une fenêtre
 * entière au premier refus, et un client honnête qui la croit réessaie trop
 * tôt — donc se fait refuser une seconde fois pour avoir obéi. Jamais zéro non
 * plus : « réessayez maintenant » relance immédiatement le refus.
 */
export function retryAfterSecondsOf(now: Date, windowStart: Date, windowSeconds: number): number {
  const elapsed = (now.getTime() - windowStart.getTime()) / 1_000

  return Math.max(1, Math.ceil(windowSeconds - elapsed))
}

/**
 * Le verdict, à partir du compte que le magasin vient de rendre.
 *
 * Le compte **inclut** le passage en cours : le seuil est atteint sans être
 * dépassé quand `hits === max`. Écrire `>=` refuserait le dernier passage
 * annoncé comme permis.
 */
export const exceedsRateLimit = (hits: number, max: number): boolean => hits > max

/**
 * Le seau de l'**appelant** sur une route.
 *
 * La clé porte l'identifiant en clair ; c'est l'infrastructure qui la
 * **condense** avant de l'écrire, si bien que le magasin ne contient aucune
 * adresse.
 */
export const callerBucketKey = (route: string, client: string): string =>
  `${route}:client:${client}`

/**
 * Le seau du **compte visé** — la seule défense contre le bourrage distribué.
 *
 * Dix mille adresses, un essai chacune, sur le même compte : chaque seau
 * d'appelant reste sous son seuil, et le compte tombe. Ce seau-ci ne dépend
 * d'aucun en-tête, donc rien de ce que l'attaquant contrôle ne le déplace.
 *
 * **Il ne normalise rien**, et c'est la correction du constat M1 de la
 * troisième revue. Deux normalisations coexistaient — le lecteur de cookie
 * rendait la sous-chaîne brute, cette clé la mettait en minuscules — et aucune
 * n'était celle du serveur : le limiteur comptait donc une valeur que la
 * bibliothèque ne voyait jamais. Chaque lecteur (`subjectOfBody`,
 * `subjectOfCookies`) rend maintenant **la valeur telle que le serveur la
 * lira** ; cette fonction ne fait que composer une clé.
 */
export const subjectBucketKey = (route: string, subject: string): string =>
  `${route}:subject:${subject}`

/**
 * Le compte visé, lu dans le corps de la requête au champ que la route déclare.
 *
 * **Une adresse inconnue est comptée comme une autre.** Ne compter que les
 * adresses existantes apprendrait à l'attaquant lesquelles le sont — c'est
 * l'énumération inversée que `docs/security.md` §3 refuse, la même règle qui
 * rend « compte inconnu » et « mot de passe erroné » indiscernables.
 *
 * `null` quand le champ manque : le seau du compte n'est alors pas consommé, et
 * seul celui de l'appelant décide. Inventer une valeur créerait un seau que
 * personne ne partage — c'est-à-dire aucune limite.
 *
 * **La valeur est normalisée ici**, et nulle part ailleurs : espaces retirés,
 * casse ramenée en minuscules, pour que `Victime@Example.test` et
 * `victime@example.test` tombent dans le même seau. La clé de seau, elle, ne
 * touche plus à rien (voir `subjectBucketKey`).
 */
export function subjectOfBody(body: unknown, field: string): string | null {
  if (typeof body !== 'object' || body === null) {
    return null
  }

  const value = (body as Record<string, unknown>)[field]

  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim().toLowerCase()

  return normalized === '' ? null : normalized
}

/**
 * La valeur d'un cookie **telle que le serveur la lira**, et pas une autre.
 *
 * C'est la correction du constat M1 de la troisième revue de s28. Le chemin
 * réel du second facteur est `ctx.getSignedCookie(nom)`
 * (`better-call@1.4.0/dist/context.mjs:38`) → `parsedCookies.get(nom)`, et cette
 * table est produite par `better-call/dist/cookies.mjs:19-40`, qui fait
 * exactement trois choses à la sous-chaîne qui suit le `=` : elle la **détrime**,
 * elle retire ses **guillemets encadrants**, puis elle applique `tryDecode`
 * (`dist/utils.mjs`) — `decodeURIComponent` dès que la valeur contient un `%`,
 * et la valeur brute si le décodage lève.
 *
 * Rendre la sous-chaîne brute laissait l'appelant, qui écrit l'en-tête `Cookie`
 * en entier, envoyer **le même défi** sous autant d'encodages qu'il voulait :
 * chaque encodage ouvrait son propre seau. Mesuré contre l'application
 * démarrée : quinze encodages d'un même défi → 401×15, la même valeur brute →
 * 401×10 puis 429×5.
 *
 * **Le rattrapage n'est pas une politesse** : `decodeURIComponent('%zz')` lève,
 * et l'en-tête vient de l'attaquant. Une exception ici deviendrait un 500 sur
 * une route publique — et surtout une valeur comptée différemment de celle que
 * le serveur, lui, lira sans broncher.
 */
const asTheServerReadsIt = (raw: string): string => {
  const trimmed = raw.trim()
  // Le retrait est celui de la bibliothèque, au caractère près : premier
  // caractère `"` ⇒ `slice(1, -1)`, sans exiger de guillemet fermant.
  const unquoted = trimmed.codePointAt(0) === 34 ? trimmed.slice(1, -1) : trimmed

  if (!unquoted.includes('%')) {
    return unquoted
  }

  try {
    return decodeURIComponent(unquoted)
  } catch {
    return unquoted
  }
}

/**
 * Ce qu'une lecture de cookie de défi peut rendre — **trois cas, pas deux**.
 *
 * `ambiguous` est le cas qui n'existait pas à la première livraison, et son
 * absence était la faille : quand plusieurs cookies déclarés sont présents, la
 * bibliothèque d'authentification n'en lit **qu'un**, et lequel dépend de sa
 * configuration. Deviner reviendrait à compter un seau pendant que le serveur en
 * valide un autre.
 */
export type CookieSubject =
  | { readonly kind: 'found'; readonly value: string }
  | { readonly kind: 'absent' }
  | { readonly kind: 'ambiguous' }

/**
 * Le compte visé, lu dans **un cookie** plutôt que dans le corps.
 *
 * Certaines routes publiques ne portent aucun identifiant de cible dans leur
 * corps : la vérification de double authentification n'envoie qu'un code à six
 * chiffres, et elle n'a délibérément pas de session — c'est tout son objet. Sans
 * cette lecture, le seul seau qui la protégeait était celui de l'appelant,
 * c'est-à-dire un en-tête que l'attaquant écrit lui-même : six chiffres, un
 * million de possibilités, et aucune barrière réelle.
 *
 * Le cookie de défi, lui, est **posé et signé par le serveur** : l'appelant ne
 * peut ni l'inventer ni le faire tourner sans repartir d'une connexion valide.
 *
 * **La correspondance est par nom EXACT, et c'est la correction du constat C1 de
 * la re-revue.** Une correspondance par suffixe se contournait par un leurre :
 *
 * ```
 * Cookie: two_factor=<compteur qui tourne>; __Secure-better-auth.two_factor=<le vrai défi>
 * ```
 *
 * Le limiteur comptait le leurre, la bibliothèque validait le vrai défi, et
 * l'énumération des six chiffres redevenait illimitée — mesuré contre
 * l'application démarrée : 401×20 sans un seul 429. La bibliothèque lit par nom
 * exact (`ctx.getSignedCookie(createAuthCookie('two_factor').name)`), donc ce
 * qui compte doit lire par nom exact aussi.
 *
 * **Plusieurs noms déclarés présents ⇒ `ambiguous`, donc refus.** Le nom réel
 * dépend de la configuration (`__Secure-` selon `useSecureCookies`), que la
 * déclaration de route ne connaît pas — elle est faite à l'import, sans
 * environnement. Choisir l'un des deux rouvrirait le contournement dans la
 * moitié des déploiements. Un navigateur légitime n'envoie jamais les deux, ni
 * deux fois le même.
 *
 * **Le nom exact ne suffisait pas : la valeur doit l'être aussi.** C'est le
 * constat M1 de la troisième revue, et c'est la même classe de défaut sur un
 * autre axe. La valeur rendue est celle que le serveur lira, normalisée par
 * `asTheServerReadsIt` — sans quoi le même défi, ré-encodé, ouvre un seau neuf
 * à chaque essai.
 */
export function subjectOfCookies(
  header: string | null,
  names: readonly string[],
): CookieSubject {
  if (header === null || header === '') {
    return { kind: 'absent' }
  }

  const declared = new Set(names)
  const matches: string[] = []

  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=')

    if (separator === -1) {
      continue
    }

    if (declared.has(pair.slice(0, separator).trim())) {
      matches.push(asTheServerReadsIt(pair.slice(separator + 1)))
    }
  }

  if (matches.length > 1) {
    return { kind: 'ambiguous' }
  }

  const only = matches[0]

  return only === undefined || only === '' ? { kind: 'absent' } : { kind: 'found', value: only }
}
