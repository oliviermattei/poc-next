/**
 * Ce qu'un formulaire affiche quand le serveur refuse — **la clé, et l'attente
 * quand il y en a une**.
 *
 * Écrit ici plutôt que dans chaque formulaire parce que la limitation de débit
 * (s28) refuse au **répartiteur**, avant tout gestionnaire : les trois
 * formulaires de ce dossier reçoivent donc le même 429, avec le même
 * `Retry-After`, et doivent en dire la même chose. `app/public-form.tsx` porte
 * la classe `throttled` depuis s11 ; s28 l'étend à l'authentification, elle
 * n'en invente pas une seconde.
 */
export interface RefusalMessage {
  /** La clé de traduction, **entière** : c'est ce que `tests/i18n.test.ts` extrait. */
  readonly key: string
  /**
   * Les minutes à attendre, ou `null` quand le serveur n'a rien dit de lisible.
   *
   * Deux clés plutôt qu'une valeur sentinelle : le message sans chiffre existe
   * pour de bon, et il est celui que `public-form.tsx` affiche déjà.
   */
  readonly minutes: number | null
}

/**
 * L'attente que **le serveur** demande, en minutes arrondies au-dessus.
 *
 * Trois décisions, écrites parce que ce sont elles qu'on relira :
 *
 * 1. **la valeur vient de l'en-tête `Retry-After`**, jamais d'un compte à
 *    rebours du navigateur ni d'une recopie de `config/security.ts`. Le
 *    répartiteur la calcule sur la fenêtre réelle (`packages/core/src/registry.ts`)
 *    et une seconde source la ferait mentir dès qu'un seuil changerait ;
 * 2. **arrondi au-dessus, et en minutes.** Les fenêtres livrées vont de 60 s à
 *    3 600 s : « réessayez dans 3 542 secondes » est illisible, et arrondir
 *    vers le bas ferait réessayer trop tôt, c'est-à-dire se faire refuser une
 *    seconde fois ;
 * 3. **une valeur illisible ne s'affiche pas.** La norme autorise aussi une
 *    date HTTP ; ce dépôt n'en écrit jamais, mais un relais peut réécrire
 *    l'en-tête, et « NaN minutes » à l'écran serait pire que pas de chiffre.
 */
export const retryAfterMinutes = (response: Response): number | null => {
  const header = response.headers.get('retry-after')

  if (header === null) {
    return null
  }

  const seconds = Number(header)

  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds / 60) : null
}

/**
 * **L'explication du bouton éteint**, partagée par les formulaires des écrans
 * d'authentification.
 *
 * Ici pour la même raison que le reste de ce fichier : ces formulaires doivent
 * en dire la même chose, et ce module est le seul de ce dossier qui ne porte
 * aucun composant — un `import` depuis `two-factor-form.tsx` n'y tire pas
 * `AuthForm` dans le lot de `/two-factor`. Elle est écrite **par clé entière**
 * comme les refus : une clé composée échapperait au contrôle d'existence des
 * clés dans chaque locale (s09).
 *
 * `app/public-form.tsx` et `app/billing-actions.tsx` portent la leur, qui vient
 * du catalogue de leur module — pas de clé commune à inventer entre eux.
 */
export const AUTH_NOSCRIPT_KEY = 'app.auth.noscript'
