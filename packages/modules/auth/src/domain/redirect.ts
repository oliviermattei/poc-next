/**
 * **La destination par défaut d'une ouverture de session** (s61, ADR 073) :
 * le tableau de bord de l'application.
 *
 * Écrite **une fois**, et c'est le point : elle est le repli de chaque parcours
 * — mot de passe, magic link, OAuth, passkey, second facteur — et du retour
 * d'un connecté sur `/sign-in`. Un repli recopié en littéral sur l'un d'eux
 * enverrait ce parcours ailleurs (sur le **site**, pour un `'/'` oublié) sans
 * qu'aucun autre ne le voie. `/` sert toujours le site public.
 */
export const DEFAULT_SIGNED_IN_PATH = '/app'

/**
 * **La rubrique Profil** des réglages (s62b) : avatar, nom, email, et en bas
 * les données — export et suppression du compte.
 */
export const PROFILE_SCREEN_PATH = '/app/settings/profile'

/**
 * **La rubrique Sécurité** des réglages (s62b) : mot de passe, connexions,
 * passkeys, second facteur, sessions actives.
 */
export const SECURITY_SCREEN_PATH = '/app/settings/security'

/**
 * **L'écran du compte** : l'entrée de la zone Réglages, celle du menu de compte.
 *
 * Il n'avait pas de constante jusqu'à s62a : `/account` était écrit en
 * littéral dans la navigation, les écrans et les menus, si bien que le
 * déplacer demandait de retrouver chaque copie. Depuis s62b, le compte est
 * rangé en deux rubriques et cette constante désigne la première, Profil ;
 * `/account` (s61) et `/app/settings/account` (s62a) répondent 308 vers elle,
 * par la table de `apps/web/lib/legacy-paths.ts`.
 */
export const ACCOUNT_SCREEN_PATH = PROFILE_SCREEN_PATH

// C0 (U+0000–U+001F), DEL (U+007F) et tout blanc au sens de `\s`, espace et
// blancs Unicode compris.
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARACTER = /[\u0000-\u001f\u007f\s]/u

/**
 * La destination de retour après authentification (`docs/security.md` §4 :
 * « Redirections : liste blanche de destinations. Aucune redirection pilotée
 * par un paramètre non validé »).
 *
 * La liste blanche est ici une **forme**, pas une énumération de chemins : est
 * accepté ce qui reste sur ce site, c'est-à-dire un chemin absolu d'une seule
 * barre oblique. Tout le reste retombe sur le repli. Une énumération des
 * chemins d'écran obligerait chaque story qui ajoute une page à revenir ici, et
 * la première qui l'oublierait renverrait l'utilisateur à l'accueil sans que
 * rien ne le dise.
 *
 * Les formes refusées sont celles qui sortent du site sans en avoir l'air :
 * l'URL absolue, l'URL protocole-relative (`//evil.test`), la barre oblique
 * inversée, que les navigateurs normalisent en `/`, et **tout caractère de
 * contrôle ou blanc** (revue s61, C1). Le navigateur retire tabulation, CR et
 * LF d'une URL avant de la lire : `/\t/evil.test` devient `//evil.test` une
 * fois servi dans un en-tête `Location`, et CR ou LF y font lever une 500.
 * Un chemin interne légitime arrive encodé (`%20`, `%09`) : il ne porte jamais
 * ces caractères en clair, si bien que les refuser ne coûte aucune page.
 */
export function safeRedirectPath(candidate: string | null | undefined, fallback: string): string {
  if (typeof candidate !== 'string' || candidate === '') {
    return fallback
  }

  if (UNSAFE_CHARACTER.test(candidate)) {
    return fallback
  }

  const normalized = candidate.replaceAll('\\', '/')

  if (!normalized.startsWith('/') || normalized.startsWith('//')) {
    return fallback
  }

  return normalized
}
