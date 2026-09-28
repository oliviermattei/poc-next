/**
 * **L'écran de facturation**, servi par l'application dans la zone Réglages
 * (s62a, ADR 075). Le module en connaît le chemin, pas le rendu.
 *
 * Il vit dans le `domain`, et non plus à côté des routes, parce qu'un second
 * appelant en a besoin **dans l'application** : les URL de retour du checkout
 * et du portail (`application/billing-use-cases.ts`) étaient un littéral
 * `${appUrl}/billing`, que l'`application` ne pouvait pas remplacer par une
 * constante de `presentation` (ADR 006). L'ancien chemin `/billing` répond 308
 * vers celui-ci, par la table de `apps/web/lib/legacy-paths.ts`.
 */
export const BILLING_SCREEN_PATH = '/app/settings/billing'
