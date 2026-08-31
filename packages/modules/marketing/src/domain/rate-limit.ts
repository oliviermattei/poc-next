import type { PublicFormId } from './public-forms'

/**
 * La limitation de débit des formulaires publics — **la règle, pas le
 * compteur**.
 *
 * Le compteur est en base (`infrastructure/drizzle-public-forms.ts`), donc
 * **partagé entre instances** : `docs/security.md` §7 l'exige, et la note de
 * s28 nomme le piège qu'un compteur en mémoire de processus tend — il se
 * contourne en scalant horizontalement. Ce fichier ne fait que dire quelles
 * fenêtres et quels seaux existent ; il n'ouvre rien et ne compte rien.
 *
 * **Dette assumée, à reprendre en s28** : la limitation de débit appartient à
 * cette story-là (`docs/security.md` §7, `docs/architecture.md`,
 * `packages/modules/marketing/AGENTS.md`). Elle est livrée ici parce que ce sont
 * les premiers points d'entrée publics du dépôt et qu'ils ne peuvent pas rester
 * ouverts sans limite. Rien de ce fichier ne prend le nom de s28 : ni port
 * `RateLimiter`, ni module `ratelimit`, ni table `rate_limit_window`. s28 fera
 * converger les deux et supprimera la table de ce module.
 *
 * **Fenêtre fixe, pas fenêtre glissante.** Une fenêtre glissante demande de
 * garder chaque soumission ; une fenêtre fixe tient en une ligne par seau et une
 * seule instruction atomique. Le prix est connu et borné : à cheval sur deux
 * fenêtres, un appelant peut passer deux fois le seuil. C'est acceptable pour
 * un formulaire de contact, ce ne le serait pas pour du bourrage
 * d'identifiants — que s28 traitera avec sa propre forme.
 */

export interface RateLimitPolicy {
  /** Durée de la fenêtre, en secondes. */
  readonly windowSeconds: number
  /** Soumissions tolérées par appelant et par fenêtre. */
  readonly maxPerClient: number
  /** Soumissions tolérées par formulaire, toutes origines confondues. */
  readonly maxPerForm: number
}

/** Un seau et son seuil. */
export interface RateLimitBucket {
  readonly key: string
  readonly max: number
}

/**
 * Les deux seaux d'une soumission, **nommés** — parce qu'ils ne font pas la
 * même chose.
 *
 * Ils ont porté le même verdict jusqu'à la revue de s11, et c'était le défaut :
 * un tableau positionnel de deux éléments interchangeables invitait à leur
 * appliquer la même règle. Ils sont désormais distincts au type comme au nom.
 */
export interface RateLimitBuckets {
  /** Le seau de l'appelant. Dépassé, il **refuse**. */
  readonly client: RateLimitBucket
  /** Le seau du formulaire entier. Dépassé, il **dégrade** — il ne refuse pas. */
  readonly form: RateLimitBucket
}

/**
 * Ce qu'une soumission a le droit de faire, une fois les seaux consultés.
 *
 * Trois valeurs, et la valeur du milieu est celle que la revue de s11 a
 * exigée. `refused` vient du seau de l'appelant ; `degraded` du seau du
 * formulaire, qui **borne le coût sans fermer la porte** — voir
 * `rateLimitBuckets` ci-dessous pour le raisonnement complet.
 */
export type RateLimitVerdict = 'allowed' | 'degraded' | 'refused'

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
 * La limite par appelant est donc un rempart contre le martèlement naïf, pas
 * contre un attaquant qui fait tourner l'en-tête — c'est le seau **par
 * formulaire**, sans identifiant, qui borne le coût total dans ce cas, en
 * suspendant les envois sortants sans jamais refuser une soumission.
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
 * Les seaux qu'une soumission fait avancer — **deux, et ils ne disent pas la
 * même chose**.
 *
 * Le seau de l'**appelant** refuse : dépassé, la soumission n'a pas lieu. Il
 * repose sur un en-tête que le client peut écrire, donc il ne vise que le
 * martèlement naïf, et un identifiant falsifié ne nuit qu'à lui-même.
 *
 * Le seau du **formulaire** ne refuse pas, il **dégrade** — c'est le constat F2
 * de la revue de s11, et c'est la propriété qui rend l'ensemble tenable. Tant
 * qu'il refusait, l'en-tête falsifiable devenait un levier : quelques centaines
 * de requêtes suffisaient à fermer les deux formulaires à **tous** les visiteurs
 * pendant toute la fenêtre. Un garde-fou contre l'abus qui offre à l'abuseur
 * l'indisponibilité qu'il cherchait n'est pas un garde-fou. Saturé, il suspend
 * donc ce qui coûte — l'envoi sortant, la seule dépense réelle d'une
 * soumission — et laisse passer la soumission elle-même.
 *
 * La clé porte l'identifiant en clair ; c'est l'infrastructure qui la
 * **condense** avant de l'écrire, si bien que la table ne contient aucune
 * adresse.
 */
export function rateLimitBuckets(input: {
  readonly form: PublicFormId
  readonly client: string
  readonly policy: RateLimitPolicy
}): RateLimitBuckets {
  return {
    client: { key: `${input.form}:client:${input.client}`, max: input.policy.maxPerClient },
    form: { key: `${input.form}:all`, max: input.policy.maxPerForm },
  }
}

/**
 * Le verdict, à partir du compte que la base vient de rendre.
 *
 * Le compte **inclut** la soumission en cours : le seuil est donc atteint sans
 * être dépassé quand `hits === max`. Écrire `>=` refuserait la dernière
 * soumission annoncée comme permise.
 */
export const exceedsRateLimit = (hits: number, max: number): boolean => hits > max
