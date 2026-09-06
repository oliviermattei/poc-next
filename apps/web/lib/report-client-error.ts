/**
 * **La moitié navigateur du critère 1** : une erreur non gérée côté client
 * atteint le fournisseur.
 *
 * Elle passe par **notre propre origine** (`/api/modules/analytics/client-error`)
 * et non par un appel direct au fournisseur, pour trois raisons dont deux sont
 * des règles du dépôt :
 *
 * 1. un appel direct coûterait une origine de plus dans `connect-src`
 *    (`docs/security.md` §1), pour un appel que la page peut faire chez elle ;
 * 2. le filtrage des données sensibles doit être **fait par le serveur** : ce
 *    qui est filtré dans le navigateur est filtré par du code que l'appelant
 *    contrôle ;
 * 3. le DSN n'a alors pas besoin d'être embarqué dans le bundle client.
 *
 * **Elle ne lève jamais, et jamais ne rejette.** Elle est appelée depuis
 * `app/global-error.tsx`, l'écran de dernier recours : une erreur levée ici
 * remplacerait l'erreur affichée au visiteur par la nôtre, dans le composant qui
 * existe précisément pour ne plus rien casser.
 */

/**
 * Le point d'arrivée, **dérivé** du module et jamais recopié.
 *
 * Il est écrit ici plutôt qu'importé de `@repo/module-analytics` parce que ce
 * fichier est chargé par un composant client : importer le barril du module y
 * ferait entrer `@repo/core` et le contrat de module. `tests/analytics.test.ts`
 * confronte les deux écritures — elles ne peuvent donc pas diverger en silence,
 * ce qui ferait poster le navigateur vers une route qui n'existe pas.
 */
export const CLIENT_ERROR_ENDPOINT = '/api/modules/analytics/client-error'

/** Ce que la trace a le droit de peser dans le corps posté. Le serveur reborne. */
const MAX_STACK = 20_000

export interface ReportClientErrorOptions {
  /** Le chemin de la page, jamais l'URL : une query emporte les jetons. */
  readonly path?: string
  readonly fetch?: typeof fetch
}

export async function reportClientError(
  error: unknown,
  options: ReportClientErrorOptions = {},
): Promise<void> {
  const { path, fetch: fetchImpl = globalThis.fetch } = options
  const known = error instanceof Error ? error : null

  try {
    await fetchImpl(CLIENT_ERROR_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // `keepalive` : l'écran de dernier recours peut être suivi d'une
      // navigation, et une requête abandonnée à ce moment-là perdrait
      // exactement l'erreur qu'on cherchait à voir.
      keepalive: true,
      body: JSON.stringify({
        message: known?.message ?? String(error),
        type: known?.name ?? 'Error',
        stack: known?.stack?.slice(0, MAX_STACK) ?? null,
        ...(path === undefined ? {} : { path }),
      }),
    })
  } catch {
    // Rien. Un tiers absent dégrade (`docs/reliability.md` §2), et il dégrade
    // ici plus qu'ailleurs : le visiteur regarde déjà un écran d'erreur.
  }
}
