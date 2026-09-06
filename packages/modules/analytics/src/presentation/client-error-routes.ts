import { MODULE_ROUTE_PREFIX, type ModuleRoute } from '@repo/core'
import type { Monitoring } from '@repo/ports'
import { z } from 'zod'

/**
 * **La route par laquelle une erreur du navigateur atteint le fournisseur.**
 *
 * Le critère 1 de s39 demande qu'une erreur non gérée soit remontée **côté
 * serveur et côté client**. Le serveur a son crochet (`instrumentation.ts`) ; le
 * navigateur, lui, n'en a pas — et lui donner le DSN pour qu'il appelle
 * directement le fournisseur coûterait une origine de plus dans `connect-src`,
 * pour un appel que la page peut faire à sa propre origine. Elle passe donc
 * ici, où le **serveur** filtre avant d'émettre : un filtrage fait dans le
 * navigateur est un filtrage que l'appelant contrôle.
 *
 * Elle est `public` : une erreur non gérée arrive souvent **avant** qu'une
 * session existe — c'est même le cas le plus intéressant. Le répartiteur lui
 * applique donc la limitation de débit dérivée du registre (ADR 050), sans que
 * rien n'ait à le demander ici.
 *
 * **L'arbitrage, écrit parce qu'il ne l'était nulle part** (constat mineur de la
 * revue) : un appelant anonyme peut donc pousser jusqu'au seuil de la politique
 * `default` — 120 par minute et par appelant au moment où ceci est écrit,
 * `config/security.ts` fait foi — d'événements d'environ 21 Ko chacun (les
 * bornes du schéma ci-dessous) dans le quota du fournisseur de l'exploitant.
 * C'est **borné**, et c'est le prix du critère : authentifier la route perdrait
 * les erreurs d'avant la session. Le seuil se resserre en nommant une politique
 * sur la route ; il n'existe aucun moyen de l'éteindre.
 *
 * Elle répond **204, toujours**. Ce que le fournisseur a fait de l'événement ne
 * regarde pas l'appelant, et une réponse qui distinguerait « remonté » de « pas
 * remonté » dirait à n'importe qui si la télémétrie est configurée.
 */

const PATHS = { clientError: '/analytics/client-error' } as const

/** Le chemin public de la route, préfixe de montage compris. */
export const CLIENT_ERROR_PATH = `${MODULE_ROUTE_PREFIX}${PATHS.clientError}`

/**
 * Zod à la frontière (`docs/security.md` §4).
 *
 * Les bornes ne sont pas décoratives : ce corps vient d'un appelant anonyme, et
 * il est recopié vers un tiers. Une trace non bornée serait un canal
 * d'exfiltration payé par notre quota chez le fournisseur.
 */
export const clientErrorSchema = z.object({
  message: z.string().min(1).max(1_000),
  type: z.string().min(1).max(200).default('Error'),
  stack: z.string().max(20_000).nullable().default(null),
  /** Le chemin de la page, jamais l'URL : une query emporte les jetons. */
  path: z
    .string()
    .max(500)
    .refine((value) => value.startsWith('/') && !value.includes('//'), {
      message: 'must be a path of this site',
    })
    .optional(),
})

export type ClientErrorReport = z.infer<typeof clientErrorSchema>

export function createAnalyticsRoutes(monitoring: () => Monitoring): readonly ModuleRoute[] {
  return [
    {
      method: 'POST',
      path: PATHS.clientError,
      protection: { level: 'public' },
      handler: async (request) => {
        const parsed = clientErrorSchema.safeParse(await request.json().catch(() => null))

        if (!parsed.success) {
          return new Response(null, { status: 400 })
        }

        // Le port ne lève jamais : son échec est une valeur, et il est ignoré
        // **ici et seulement ici**. Un tiers absent dégrade
        // (`docs/reliability.md` §2) — une remontée perdue ne doit pas devenir
        // une seconde erreur pour le visiteur qui en signalait une première.
        await monitoring().capture({
          message: parsed.data.message,
          type: parsed.data.type,
          stack: parsed.data.stack,
          origin: 'client',
          release: null,
          context: parsed.data.path === undefined ? {} : { path: parsed.data.path },
        })

        return new Response(null, { status: 204 })
      },
    },
  ]
}
