/**
 * **Les événements d'usage que ce module émet** (s39).
 *
 * Ils sont nommés **ici**, chez l'émetteur, et non dans le module
 * `analytics` : `auth` est du socle, `analytics` est optionnel, et faire
 * dépendre le premier du second inverserait la dépendance qui fait toute la
 * modularité. Le module optionnel apporte le *fournisseur* et le
 * *consentement* ; il n'a pas à posséder le vocabulaire métier des autres.
 *
 * Le préfixe est celui du module, comme pour les identifiants de tâches
 * (`<module>.<verbe>`) : deux modules qui mesureraient « created » ne se
 * confondent pas chez le fournisseur.
 */

/** Une inscription **réussie** — le compte est écrit quand cet événement part. */
export const SIGN_UP_EVENT = 'auth.signed_up'
