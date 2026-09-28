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
 * **L'écran du compte**, dans la zone Réglages (s62a, ADR 075).
 *
 * Il n'avait pas de constante jusqu'à s62a : `/account` était écrit en
 * littéral dans la navigation, les écrans et les menus, si bien que le
 * déplacer demandait de retrouver chaque copie. L'ancien chemin répond 308 vers
 * celui-ci, par la table de `apps/web/lib/legacy-paths.ts`.
 */
export const ACCOUNT_SCREEN_PATH = '/app/settings/account'

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
