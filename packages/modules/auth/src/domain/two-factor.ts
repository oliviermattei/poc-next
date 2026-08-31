/**
 * Le refus d'une vérification de second facteur, **replié sur trois classes**.
 *
 * Même règle que le refus de connexion (`credentials.ts`) et que la classe
 * d'un retour de fournisseur (`oauth.ts`), pour la même raison : les codes du
 * greffon décrivent l'état du compte, et aucun n'a le droit d'atteindre le
 * navigateur (`docs/security.md` §7). Mesurés dans `better-auth@1.7.2` :
 *
 * | Code du greffon | Statut | Ce qu'il dirait |
 * |---|---|---|
 * | `INVALID_CODE` | 401 | le code est faux |
 * | `INVALID_TWO_FACTOR_COOKIE` | 401 | le défi n'existe plus |
 * | `TOTP_NOT_ENABLED` | 400 | ce compte n'a pas de secret TOTP |
 * | `TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE` | 400 | le défi vient d'être détruit |
 * | `ACCOUNT_TEMPORARILY_LOCKED` | 429 | le compte est verrouillé |
 *
 * Les classes ne sont **pas** une hiérarchie de gravité : elles disent la
 * conduite à tenir, et rien d'autre. `invalid` — le défi vit encore, ressaisir
 * un code a un sens. `restart` — il n'y a plus de défi, il faut refaire la
 * connexion. Sans cette seconde classe, l'écran répéterait « code invalide » à
 * quelqu'un dont le défi a été détruit au cinquième essai, et il ressaierait
 * indéfiniment.
 *
 * `used` est la troisième, et elle vient d'un mensonge mesuré (revue s13,
 * C12/C13/C14) : la garde de rejeu du module refuse un compteur déjà pris, ce
 * qui arrive sur un code **juste** — deuxième connexion dans les mêmes trente
 * secondes, ré-enrôlement dans la même période, horloge du serveur reculée.
 * L'écran disait « ce code n'est pas valide » à quelqu'un qui lisait le bon
 * code sur son téléphone : il en conclut qu'on lui a pris son compte. La
 * conduite à tenir n'est pas la même non plus — il faut attendre le code
 * suivant, pas ressaisir celui-là.
 *
 * Le **statut**, lui, est le même pour les trois : le distinguer rendrait
 * l'état du compte lisible à qui ne lit que l'en-tête.
 *
 * Ce n'est pas un oracle d'énumération : on n'arrive ici qu'après avoir prouvé
 * le premier facteur, donc sur son propre compte. `used`, en particulier, n'est
 * atteignable qu'avec un défi ouvert ou une session — pour qui n'a rien
 * présenté, tous les refus du module restent indistinguables.
 */

/**
 * L'écran de vérification, **côté application**.
 *
 * Déclaré ici pour la même raison qu'`OAUTH_RETURN_SCREEN` : les voies qui
 * ouvrent une session par une **redirection de navigateur** — le magic link et
 * les rappels de fournisseur — doivent envoyer quelque part la personne dont
 * la session vient d'être remplacée par un défi. Le formulaire de mot de
 * passe, lui, n'en a pas besoin : il reçoit du JSON et navigue lui-même.
 */
export const TWO_FACTOR_SCREEN = '/two-factor'

/**
 * Les deux réglages TOTP du module, **écrits une fois**.
 *
 * Ils sont passés au greffon *et* relus par la garde de rejeu : deux écritures
 * divergentes rendraient la garde incapable de placer un code que la
 * bibliothèque vient d'accepter, donc refuseraient toutes les connexions.
 */
export const TOTP_DIGITS = 6
export const TOTP_PERIOD_SECONDS = 30

/**
 * Les compteurs auxquels un code **que la bibliothèque vient d'accepter** peut
 * appartenir.
 *
 * La bibliothèque vérifie à son instant `T₁` avec une fenêtre de ±1 période,
 * donc accepte `{c₁-1, c₁, c₁+1}`. La garde, elle, calcule son propre compteur
 * `c₂` à `T₂ ≥ T₁`, quelques millisecondes plus tard — et une frontière de
 * période peut être passée entre les deux, auquel cas `c₂ = c₁+1` et le pas
 * `c₁-1` vaut `c₂-2`. La liste couvre donc **les deux positions possibles**
 * de la fenêtre : sans le pas `-2`, un code accepté juste après une frontière
 * ne serait rattaché à aucun compteur.
 *
 * Ordre croissant, et c'est ce que l'appelant doit garder : à collision (deux
 * compteurs produisant le même code, de l'ordre de 10⁻⁶), retenir **le plus
 * petit** refuse un rejeu plutôt que de l'accepter.
 */
export function totpStepsToTry(
  now: Date,
  periodSeconds: number = TOTP_PERIOD_SECONDS,
): readonly number[] {
  const current = Math.floor(now.getTime() / (periodSeconds * 1000))

  return [current - 2, current - 1, current, current + 1]
}

/**
 * Ce qu'un refus de second facteur a le droit de dire. Trois classes.
 *
 * `invalid` et `restart` sont rendues par {@link twoFactorRefusal}, qui replie
 * les codes du greffon. `used` ne vient pas de la bibliothèque — elle ne
 * mémorise aucun compteur : c'est la garde de rejeu du module qui la rend, dans
 * `presentation/auth-routes.ts`.
 */
export type TwoFactorFailureClass = 'invalid' | 'restart' | 'used'

/** Le statut rendu par tout refus, quelle que soit la classe. */
export const TWO_FACTOR_REFUSAL_STATUS = 401

export interface TwoFactorRefusal {
  readonly status: number
  readonly body: { readonly error: TwoFactorFailureClass }
}

/**
 * Le refus à rendre pour un statut du greffon — `null` si la réponse doit
 * passer telle quelle.
 *
 * Le repli est `invalid`, pas `restart` : proposer de recommencer la connexion
 * alors que le défi vit encore ferait perdre un défi valide à chaque hoquet.
 */
export function twoFactorRefusal(status: number): TwoFactorRefusal | null {
  if (status >= 200 && status < 300) {
    return null
  }

  return {
    status: TWO_FACTOR_REFUSAL_STATUS,
    body: { error: status === 400 || status === 429 ? 'restart' : 'invalid' },
  }
}

/**
 * **Il n'y a pas de `readTwoFactorFailureClass` ici**, et c'est mesuré.
 *
 * s12 en avait un (`readOAuthFailureClass`) parce que son refus est relu par un
 * composant **serveur** — l'écran de connexion, qui peut importer le module par
 * `apps/web/lib/auth.ts`. Le refus du second facteur, lui, arrive dans la
 * réponse d'un `fetch`, donc dans un composant **client** : lui faire importer
 * `@repo/module-auth` embarquerait Better Auth et Drizzle dans le paquet du
 * navigateur, et casserait la règle « un seul fichier de l'application connaît
 * le module ».
 *
 * La fonction avait malgré tout été écrite, exportée et testée — sans un seul
 * appelant de production (revue s13, C5). Un test qui protège du code mort
 * donne une fausse impression de couverture : elle est retirée, et ce
 * paragraphe est ce qui empêche de la réécrire.
 */
