/**
 * **La limitation de débit de la route publique de checkout** — la règle, pas
 * le compteur (s24).
 *
 * C'est la **première route de paiement publique** du dépôt : elle ouvre une
 * session chez le fournisseur pour un appelant dont on ne sait rien.
 * `docs/security.md` §7 exige une limitation « partagée entre instances » sur
 * tout point d'entrée public ; le compteur vit donc en base
 * (`infrastructure/drizzle-billing-repositories.ts`), et un compteur en mémoire
 * de processus se contournerait en scalant horizontalement.
 *
 * **La forme est celle de `marketing`** — fenêtre fixe, une ligne par seau,
 * une seule instruction atomique — et elle est **recopiée**, pas importée : le
 * module `billing` ne déclare aucun `requires` (ADR 034) et ne connaît pas
 * `marketing`. La dette de convergence est celle que `marketing` nomme déjà :
 * s28 possède la limitation de débit, fera converger les points d'entrée vers
 * son port et supprimera les deux tables. Rien ici ne prend le nom de s28 : ni
 * port `RateLimiter`, ni table `rate_limit_window`.
 *
 * **Deux seaux, et ils ne disent pas la même chose** — la même leçon que
 * `marketing`, apprise deux fois (constat F2 de la revue de s11, constat F3 de
 * celle de s24).
 *
 * Le seau de l'**appelant** refuse. Il repose sur un en-tête que le client
 * écrit lui-même : il ne vise que le martèlement naïf, et un identifiant
 * falsifié ne nuit qu'à lui-même. Seul, il ne borne donc rien du **coût total**
 * de la route — or chaque ouverture acceptée crée un client *et* une session
 * chez le fournisseur (clé d'idempotence tirée au hasard, elle ne converge
 * jamais) et, chez nous, une ligne `billing_customer` que rien n'effacera
 * jamais : l'ADR 047 refuse nommément toute commande de nettoyage.
 *
 * Le seau **global** borne ce coût, et il ne refuse pas : au-delà du seuil, le
 * tunnel anonyme n'est plus ouvert et le visiteur repart par **la connexion** —
 * le comportement d'avant s24, où le déclencheur anonyme menait à `/sign-in`.
 * C'est la dégradation que la première rédaction de ce fichier déclarait
 * inexistante (« il n'y a rien à dégrader »), et elle a trois propriétés que
 * n'aurait pas un refus global : le canal de vente reste ouvert, l'offre suit
 * le visiteur (ADR 045), et le chemin authentifié n'est pas touché. Personne ne
 * gagne, en faisant tourner un en-tête, le pouvoir de couper la vente.
 *
 * **L'ordre des deux seaux est la règle** : celui de l'appelant décide
 * d'abord, et le seau global ne compte que ce qui a été laissé passer. Compter
 * aussi les refus rendrait à un seul appelant le pouvoir d'envoyer tous les
 * autres à la connexion — c'est-à-dire l'indisponibilité que ce second seau
 * existe pour refuser.
 */

/** L'identifiant employé quand aucun en-tête ne dit d'où vient la requête. */
export const UNKNOWN_CHECKOUT_CLIENT = 'unknown'

/**
 * La politique, **écrite ici et non configurable**.
 *
 * `config/billing.ts` décrit ce que le projet vend ; il ne décrit pas comment
 * on se défend, et une limite qu'un fichier de projet peut porter à l'infini
 * n'est pas une limite. Cinq ouvertures de tunnel par appelant et par tranche
 * de dix minutes : au-delà, ce n'est plus quelqu'un qui hésite entre deux
 * offres.
 *
 * `maxGlobal` est **dix fois** le seau d'un appelant : il faut dix visiteurs au
 * maximum du leur, dans la même tranche de dix minutes, pour que le tunnel
 * anonyme repasse par la connexion. Un produit qui vend quelques abonnements
 * par jour n'y touche jamais ; une campagne de requêtes à en-têtes tournants y
 * arrive en quelques secondes, et c'est précisément ce qu'on veut borner.
 */
export const GUEST_CHECKOUT_RATE_LIMIT = {
  windowSeconds: 600,
  maxPerClient: 5,
  maxGlobal: 50,
} as const

/**
 * Le seau **global** : une seule ligne pour toute la route, sans identifiant.
 *
 * Pas de clé par appelant, et c'est le point : ce que ce seau borne est le coût
 * total, quel que soit l'en-tête présenté.
 */
export const GUEST_CHECKOUT_GLOBAL_BUCKET = 'guest-checkout:all'

/**
 * Ce que le serveur croit savoir de l'appelant.
 *
 * **Falsifiable, et il faut le dire** : hors d'un proxy de confiance qui
 * réécrit `x-forwarded-for`, n'importe qui peut poser la valeur de son choix.
 * Le **premier** maillon de la chaîne est le client ; les suivants sont les
 * relais — prendre le dernier ferait tomber tous les visiteurs d'un même
 * hébergeur dans un seul seau.
 */
export function checkoutClientOf(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim()

  if (forwarded !== undefined && forwarded !== '') {
    return forwarded
  }

  const real = headers.get('x-real-ip')?.trim()

  return real === undefined || real === '' ? UNKNOWN_CHECKOUT_CLIENT : real
}

/**
 * Le début de la fenêtre fixe qui contient cet instant.
 *
 * **Aligné sur la durée**, pas sur le premier appel : deux instances démarrées
 * à une seconde d'écart compteraient sinon dans deux fenêtres décalées, et un
 * compteur « partagé » ne le serait plus qu'en apparence.
 */
export function checkoutWindowStartOf(now: Date, windowSeconds: number): Date {
  const span = windowSeconds * 1_000

  return new Date(Math.floor(now.getTime() / span) * span)
}

/**
 * Le seau d'un appelant.
 *
 * La clé porte l'identifiant en clair ; c'est l'infrastructure qui la
 * **condense** avant de l'écrire, si bien que la table ne contient aucune
 * adresse.
 */
export const guestCheckoutBucket = (client: string): string => `guest-checkout:client:${client}`

/**
 * Le verdict, à partir du compte que la base vient de rendre.
 *
 * Le compte **inclut** l'ouverture en cours : le seuil est atteint sans être
 * dépassé quand `hits === max`. Écrire `>=` refuserait la dernière ouverture
 * annoncée comme permise.
 */
export const exceedsCheckoutRateLimit = (hits: number, max: number): boolean => hits > max
