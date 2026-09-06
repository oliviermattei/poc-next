import { MODULE_ROUTE_PREFIX, type ModuleRoute } from '@repo/core'

import {
  analyticsBootstrap,
  type AnalyticsBrowserSettings,
} from '../domain/analytics-script'

/**
 * **La route qui sert le script d'analyse au navigateur.**
 *
 * Elle existe pour une raison mesurée en revue : la clé de projet et l'hôte
 * doivent atteindre le navigateur, et la politique de sécurité livrée refuse un
 * script **en ligne** — c'est un `<script src>` nonce, et rien d'autre, que
 * `ConsentScripts` (s36) sait rendre. Servir ce script depuis notre origine est
 * donc le seul chemin qui initialise le fournisseur sans rouvrir la politique.
 *
 * Elle est `public` : le visiteur qui l'obtient n'a pas de session, et il vient
 * d'accorder son consentement. Le répartiteur lui applique la limitation dérivée
 * du registre (ADR 050). Le script est donc **mis en cache** par le navigateur —
 * sans quoi une sortie d'entreprise partagée épuiserait le seau de la politique
 * `default` et perdrait sa mesure.
 *
 * **Trois états, trois réponses, et il ne faut pas les confondre** — c'est le
 * tableau de `jobs/src/presentation/job-routes.ts` (s33), transposé sans rien y
 * changer, parce que c'est la même question :
 *
 * | État | Réponse | Ce qu'elle dit |
 * |---|---|---|
 * | module **coupé** | **404**, par le répartiteur | l'endroit n'existe pas : la route n'est dans aucune table de routage |
 * | module activé, **aucune clé** | **503** `analytics_provider_not_configured` | l'endroit existe, aucun fournisseur n'est derrière |
 * | module activé, **clé configurée** | **200**, le script | le fournisseur est initialisé dans le navigateur |
 *
 * La deuxième ligne répondait **404** à la première écriture, et
 * `e2e/modules.spec.ts` l'a attrapé en intégration — **la troisième fois que ce
 * balayage attrape cette classe**, après le rappel de s33 et le téléchargement
 * de s35. Il avait raison : la route **est** déclarée et **est** montée, et dire
 * « cet endroit n'existe pas » envoie chercher un défaut de routage qui n'existe
 * pas. Pire ici qu'ailleurs : ce chemin est le seul du dépôt à porter une
 * extension, et la revue avait déjà noté qu'un 404 y est indistinguable d'une
 * route absente — donc de la garantie du critère 8, que ce 404-là effaçait.
 *
 * **L'autre option — servir un script inerte en 200 — a été écartée**, et pour
 * la règle que cette story existe pour tenir : un déploiement configuré et un
 * déploiement qui ne l'est pas deviendraient indistinguables de l'extérieur.
 * C'est exactement le repli silencieux que le socle interdit aux ports (« un
 * port qui se replie en silence ne peut plus distinguer un vrai envoi d'un envoi
 * capté »), et c'est le défaut dont cette ronde de correctifs est partie : un
 * script qui se charge et ne mesure rien. Le navigateur, lui, ne perd rien —
 * sans clé, le script n'est pas déclaré au registre de consentement, donc aucune
 * page ne le demande.
 *
 * **503 plutôt que 501**, comme s33 : une configuration corrigée doit faire
 * réussir le même appel, et c'est le code que `/api/health` rend déjà sur une
 * dépendance absente. Le corps ne nomme **aucune variable** : un code stable.
 * Ce qu'il faut renseigner se lit dans `.env.example` et `docs/deployment.md`.
 */

const PATHS = { script: '/analytics/script.js' } as const

/** Le chemin public du script, préfixe de montage compris. */
export const ANALYTICS_SCRIPT_PATH = `${MODULE_ROUTE_PREFIX}${PATHS.script}`

/** Une heure : le script ne change qu'au redéploiement, avec la configuration. */
const CACHE_SECONDS = 3_600

export function createBrowserScriptRoutes(
  settings: () => AnalyticsBrowserSettings | null,
): readonly ModuleRoute[] {
  return [
    {
      method: 'GET',
      path: PATHS.script,
      protection: { level: 'public' },
      handler: () => {
        const browser = settings()

        if (browser === null) {
          return Response.json({ error: 'analytics_provider_not_configured' }, { status: 503 })
        }

        return new Response(analyticsBootstrap(browser), {
          status: 200,
          headers: {
            'content-type': 'application/javascript; charset=utf-8',
            'cache-control': `public, max-age=${String(CACHE_SECONDS)}`,
          },
        })
      },
    },
  ]
}
