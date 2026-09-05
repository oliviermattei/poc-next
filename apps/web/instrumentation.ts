/**
 * **Le point de démarrage que la sortie autonome atteint.**
 *
 * Next appelle `register` une fois par instance de serveur, avant de servir la
 * moindre requête — en `next dev`, en `next start` et dans l'image de
 * production. `next.config.ts` porte la même garde, mais `output: 'standalone'`
 * (s27) sérialise la configuration dans `server.js` : le fichier de
 * configuration n'y est plus exécuté, et sans ce point-ci l'image démarrerait
 * **sans valider son environnement**. Mesuré sur la première image de la story :
 * un serveur autonome lancé avec un environnement entièrement vide affichait
 * `✓ Ready` et répondait 503 sur `/api/health`.
 *
 * **`process.env.NEXT_RUNTIME` est lu ici, et c'est le seul `process.env` de
 * cette application.** La règle du socle (`docs/security.md` §5) veut que la
 * configuration soit lue et validée dans `@repo/config`, et ce n'en est pas :
 * Next **remplace cette expression par un littéral à la compilation**, une fois
 * par runtime, et c'est précisément ce remplacement qui fait disparaître les
 * imports ci-dessous du paquet *edge*. Une indirection par une fonction —
 * fût-elle dans `@repo/config` — retirerait la constante et rendrait le
 * remplacement impossible.
 *
 * Mesuré sans cette garde : `next dev` et `next build` compilent aussi une
 * « Edge Instrumentation », où `node:fs` et `node:path` n'existent pas —
 * « Ecmascript file had an error », import trace `./packages/config/src/dotenv.ts`
 * → `./apps/web/instrumentation.ts`. Les imports sont donc **dynamiques** et
 * placés après la garde : statiques, ils seraient dans le paquet edge quoi que
 * dise la condition.
 *
 * Pour la même raison, **rien de Node ne s'écrit ici**, pas même
 * `process.exit` : sa seule présence lexicale refaisait échouer la compilation
 * du paquet edge. Le refus vit dans `lib/startup.ts`, importé dynamiquement.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return
  }

  // `loadRootEnv` est un chargement, pas un repli : hors du dépôt — dans
  // l'image — il n'y a pas de `.env`, la fonction ne trouve pas la racine et ne
  // fait rien. Tout vient alors de l'environnement du conteneur.
  const { loadRootEnv } = await import('@repo/config/server')
  const { refuseStartupOnInvalidConfiguration } = await import('./lib/startup')

  loadRootEnv()
  refuseStartupOnInvalidConfiguration()

  /**
   * **L'ordonnanceur local** (s33), et il ne démarre qu'ici.
   *
   * Il n'existe que dans le mode local (`JOBS_LOCAL_RUNNER=1`) : avec le
   * fournisseur, c'est lui qui tient les horloges, et deux ordonnanceurs
   * feraient deux exécutions de chaque échéance. `register` est appelée une
   * fois par instance de serveur, ce qui est exactement la portée voulue — un
   * `setInterval` posé dans un fichier de route serait posé à chaque requête.
   */
  const { prepareJobs, startLocalJobScheduler } = await import('./lib/jobs')

  prepareJobs()
  startLocalJobScheduler()
}
