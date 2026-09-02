import { MODULE_ROUTE_PREFIX, type ModuleRoute, type NavigationEntry } from '@repo/core'
import { z } from 'zod'

import { InvalidDemoItemError } from '../domain/demo-item'
import type { DemoItemUseCases } from '../application/demo-items'

/**
 * Routes et navigation du module.
 *
 * Chaque route déclare son **niveau de protection** : c'est le contrat qui rend
 * le §3 du socle de sécurité vérifiable par le registre plutôt que par
 * relecture. Le répartiteur refuse avant d'appeler le gestionnaire — une route
 * `authenticated` n'est jamais exécutée sans session.
 */

/**
 * **La fonctionnalité que ce module réserve à une offre payante** (s21).
 *
 * Écrite une seule fois, et exportée : la route la déclare,
 * `config/gating.ts` dit quelles offres l'ouvrent, et l'écran `/premium` de
 * l'application la nomme. Trois littéraux identiques divergeraient, et le
 * premier à diverger fermerait la porte à tout le monde — c'est justement ce
 * que `assertGatesCoverRoutes` refuse au démarrage.
 */
export const DEMO_PREMIUM_FEATURE = 'premium-report'

/**
 * **L'écran servi par l'application pour cette fonctionnalité** — le module en
 * connaît le chemin, pas le rendu, exactement comme `BILLING_SCREEN_PATH`.
 *
 * Il existe parce qu'une entrée de navigation qui désignait la route d'API
 * rendait `{"error":"forbidden"}` au premier clic (constat m6 de la revue) :
 * l'ADR 043 justifie la visibilité de l'entrée par l'**invitation à
 * souscrire**, et une invitation ne s'écrit pas dans un corps JSON. La route
 * d'API, elle, reste du JSON — c'est ce qu'une route d'API sert.
 */
export const DEMO_PREMIUM_SCREEN_PATH = '/premium'

/** Zod à la frontière (socle de sécurité §4) : le corps entrant n'est pas de confiance. */
const createItemBodySchema = z.object({ title: z.string() })

const badRequest = (reason: string): Response =>
  Response.json({ error: 'invalid_request', reason }, { status: 400 })

export function createDemoItemRoutes(useCases: DemoItemUseCases): readonly ModuleRoute[] {
  return [
    {
      method: 'GET',
      path: '/demo-enabled/items',
      protection: { level: 'public' },
      handler: async () => Response.json({ items: await useCases.listDemoItems() }),
    },
    {
      method: 'POST',
      path: '/demo-enabled/items',
      protection: { level: 'authenticated' },
      handler: async (request, context) => {
        // Le répartiteur a déjà refusé l'appel anonyme ; sans session ici, c'est
        // le montage qui est cassé, et servir la requête serait pire que
        // d'échouer.
        if (context.session === null) {
          return badRequest('session absente')
        }

        const body: unknown = await request.json().catch(() => null)
        const parsed = createItemBodySchema.safeParse(body)

        if (!parsed.success) {
          return badRequest('titre manquant')
        }

        try {
          const item = await useCases.addDemoItem({
            ownerId: context.session.userId,
            title: parsed.data.title,
          })

          return Response.json({ item }, { status: 201 })
        } catch (error) {
          if (error instanceof InvalidDemoItemError) {
            return badRequest(error.message)
          }

          throw error
        }
      },
    },
    {
      method: 'GET',
      path: '/demo-enabled/admin/report',
      protection: { level: 'role', role: 'admin' },
      handler: async () => Response.json({ count: (await useCases.listDemoItems()).length }),
    },
    {
      /**
       * **La fonctionnalité réservée à une offre payante** (s21, ADR 043) — le
       * quatrième niveau de protection, démontré comme les trois autres.
       *
       * Ce module ne connaît **pas** la facturation, et il ne doit pas : il
       * **nomme** une fonctionnalité, et c'est `config/gating.ts` qui dit
       * quelles offres l'ouvrent. Un module qui importerait `billing` pour
       * garder sa propre route rendrait la facturation non désactivable, et
       * écrirait la règle d'accès une fois de plus — ce que la story existe
       * pour éviter (« sans écrire de logique d'accès à chaque écran »).
       *
       * La garde est **côté serveur et au répartiteur** : ce gestionnaire n'est
       * jamais atteint sans le droit, et il n'a donc aucune vérification à
       * refaire (`docs/security.md` §3).
       */
      method: 'GET',
      path: '/demo-enabled/premium/report',
      protection: { level: 'entitlement', feature: DEMO_PREMIUM_FEATURE },
      handler: async () => {
        const items = await useCases.listDemoItems()

        return Response.json({
          count: items.length,
          // Ce que l'offre gratuite n'aurait pas : une dérivation, pas une
          // liste de plus. Elle n'existe que pour que la route serve quelque
          // chose de distinct de la route publique.
          owners: new Set(items.map((item) => item.ownerId)).size,
        })
      },
    },
  ]
}

/**
 * La navigation du module.
 *
 * Deux choses s'y jouent, et elles sont vérifiées :
 *
 * 1. **Le `href` mène quelque part.** Aucun mécanisme de page de module
 *    n'existe : une entrée désigne soit une route montée par ce module — le
 *    préfixe vient du registre, jamais recopié —, soit un écran que
 *    l'application sert et dont le module ne connaît que le chemin
 *    (`DEMO_PREMIUM_SCREEN_PATH`, comme `BILLING_SCREEN_PATH`). Jamais un
 *    chemin inventé, qui répondrait 404.
 * 2. **La protection déclarée est lue.** L'entrée `admin` vise la route
 *    réservée au rôle `admin` : elle n'apparaît que pour une session qui le
 *    porte (`visibleNavigation`). Sans elle, `protection` serait un champ que
 *    le contrat déclare et que personne n'exerce.
 */
export const demoItemNavigation: readonly NavigationEntry[] = [
  {
    id: 'items',
    href: `${MODULE_ROUTE_PREFIX}/demo-enabled/items`,
    labelKey: 'navigation.items',
    order: 10,
    protection: { level: 'public' },
  },
  {
    id: 'admin-report',
    href: `${MODULE_ROUTE_PREFIX}/demo-enabled/admin/report`,
    labelKey: 'navigation.adminReport',
    order: 20,
    protection: { level: 'role', role: 'admin' },
  },
  {
    /**
     * L'entrée de la fonctionnalité réservée — **visible à toute session**, et
     * c'est une décision (ADR 043).
     *
     * `visibleNavigation` ne masque pas ce que l'offre n'ouvre pas : le second
     * critère de la story demande une **invitation à souscrire**, pas une
     * disparition. Faire disparaître l'entrée cacherait au client ce qu'il
     * pourrait acheter, et laisserait le refus 403 comme seule pédagogie.
     *
     * La garde qui compte reste côté serveur : le répartiteur refuse en 403 sur
     * la route d'API, et l'écran ci-dessous repose la même question.
     *
     * **Le `href` est l'écran de l'application, pas la route d'API** — comme
     * l'entrée de `billing`. Une entrée qui menait à la route montée affichait
     * un `{"error":"forbidden"}` brut à qui n'avait pas le droit : c'est le
     * contraire d'une invitation à souscrire, et c'était la seule entrée
     * visible vers cette fonctionnalité.
     */
    id: 'premium-report',
    href: DEMO_PREMIUM_SCREEN_PATH,
    labelKey: 'navigation.premiumReport',
    order: 30,
    protection: { level: 'entitlement', feature: DEMO_PREMIUM_FEATURE },
  },
]
