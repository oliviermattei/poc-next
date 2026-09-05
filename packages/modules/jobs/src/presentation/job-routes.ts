import type { ModuleRoute } from '@repo/core'

/**
 * **La route de rappel du fournisseur** (s33).
 *
 * C'est par elle qu'Inngest exécute une tâche : il synchronise (`PUT`),
 * s'introspecte (`GET`) et appelle (`POST`). Sans elle, une émission partirait
 * chez le fournisseur et **rien** ne l'exécuterait — c'est-à-dire exactement
 * l'état que cette story corrige, déplacé d'un cran.
 *
 * **Une route déclarée par le module, pas un fichier de route Next**, et c'est
 * le même choix que le webhook de paiement (s19) : un fichier `route.ts` de
 * plus serait un sixième point d'entrée hors du répartiteur, donc hors de la
 * limitation de débit dérivée du registre — `docs/security.md` §7 en compte
 * cinq et un test l'épingle. Ici, le module coupé, ces trois chemins ne sont
 * dans aucune table de routage : ils répondent 404 sans qu'aucun `if` ne le
 * décide.
 *
 * **Trois états, trois réponses, et il ne faut pas les confondre** — la CI de
 * la PR 27 a rougi pour les avoir confondus :
 *
 * | État | Réponse | Ce qu'elle dit |
 * |---|---|---|
 * | module **coupé** | **404**, par le répartiteur | l'endroit n'existe pas : la route n'est dans aucune table de routage |
 * | module activé, **exécuteur local** (`JOBS_LOCAL_RUNNER=1`) | **503** `jobs_provider_not_configured` | l'endroit existe, aucun fournisseur n'est derrière |
 * | module activé, **fournisseur configuré** | ce que le SDK répond | la synchronisation, l'introspection ou l'exécution |
 *
 * La deuxième ligne répondait 404 à la livraison, et
 * `e2e/modules.spec.ts` l'a attrapé : ce balayage exige qu'une route
 * **publique d'un module activé** ne réponde jamais 404. Il avait raison — la
 * route **est** déclarée et **est** montée ; dire « cet endroit n'existe pas »
 * envoie chercher un défaut de routage qui n'existe pas.
 *
 * Le commentaire d'origine invoquait `docs/security.md` §7 pour justifier le
 * 404 (« une erreur serveur annoncerait qu'un ordonnanceur vit ici »). C'était
 * une mauvaise lecture : la règle des 404 protège l'existence de la ressource
 * **d'autrui**, pas celle d'un point d'entrée d'intégration que le contrat d'un
 * module open source déclare en clair. Le webhook de paiement, public lui
 * aussi, répond 400 sur une signature fausse — il ne se cache pas.
 *
 * **L'autre option — ne pas déclarer la route quand aucun fournisseur n'est
 * configuré — a été écartée** : elle ferait dépendre `routes` de
 * l'environnement, ce qu'aucun module de ce dépôt ne fait, et rendrait la route
 * invisible au balayage qui a trouvé le défaut.
 *
 * Le corps ne nomme **aucune variable** : un code stable, comme
 * `{"error":"rate_limited"}`. Ce qu'il faut renseigner se lit dans
 * `.env.example` et `docs/deployment.md`, et le démarrage le journalise déjà.
 *
 * **`public`, et sa garde est la signature.** Le fournisseur n'a pas de session ;
 * c'est le SDK qui vérifie la clé de signature avant d'exécuter quoi que ce
 * soit, exactement comme Stripe. La politique de limitation est `webhook` — la
 * plus large de toutes — pour la raison écrite dans `config/security.ts` : un
 * fournisseur qui rejoue en rafale après une panne ne doit jamais être le
 * premier refusé.
 */

export const JOBS_CALLBACK_PATH = '/jobs/inngest'

/**
 * Ce que répond la route quand elle est montée mais qu'aucun fournisseur n'est
 * derrière.
 *
 * **503, jamais 404** : l'endroit existe. Et 503 plutôt que 501, parce qu'un
 * fournisseur mal configuré qui rejouerait doit réussir une fois la
 * configuration corrigée — c'est le même code que `/api/health` rend sur une
 * dépendance absente.
 */
const providerNotConfigured = (): Response =>
  Response.json({ error: 'jobs_provider_not_configured' }, { status: 503 })

export function createJobRoutes(
  callback: () => ((request: Request) => Promise<Response>) | null,
): readonly ModuleRoute[] {
  const serve = async (request: Request): Promise<Response> => {
    const handler = callback()

    return handler === null ? providerNotConfigured() : await handler(request)
  }

  return (['GET', 'POST', 'PUT'] as const).map((method) => ({
    method,
    path: JOBS_CALLBACK_PATH,
    protection: { level: 'public' as const },
    rateLimit: { policy: 'webhook' },
    handler: serve,
  }))
}
