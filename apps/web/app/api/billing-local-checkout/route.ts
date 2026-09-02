import { dispatchModuleRequest } from '@repo/core'
import { billingScopeReference } from '@repo/module-billing'
import { z } from 'zod'

import { currentViewer } from '../../../lib/auth'
import { billing, billingRoutePath } from '../../../lib/billing'
import { moduleRegistry } from '../../../lib/module-registry'
import { prepareModuleServices } from '../../../lib/module-services'
import { dataOwnerOf } from '../../../lib/organizations'

/**
 * **Le checkout simulé du mode local** — la page hébergée que le fournisseur
 * servirait, tenue par l'application.
 *
 * Elle n'existe que sous `PAYMENTS_LOCAL_MODE=1`. Partout ailleurs —
 * développement avec une clé, production — elle répond **404**, exactement comme
 * la sonde de traduction de s09 : `billing.localCheckout` vaut `null` dès que le
 * port n'est pas la simulation, et `apps/web/lib/billing-config.ts` refuse de
 * toute façon le drapeau sous `NODE_ENV=production`.
 *
 * **Ce qu'elle fait, et pourquoi c'est la bonne forme** : elle fabrique les
 * événements que le fournisseur enverrait, les signe, et les fait passer par la
 * **vraie** route de webhook du module — signature vérifiée, idempotence,
 * ordre, écriture d'état. Le parcours navigateur exerce donc la chaîne entière
 * sans un octet vers l'extérieur. Un raccourci qui écrirait directement en base
 * ne prouverait rien de ce qui compte.
 *
 * **Un `GET` qui écrit**, assumé et borné : cette route tient la place d'une
 * page tierce vers laquelle le navigateur **navigue**, et une navigation est un
 * `GET`. Elle n'existe que sous le drapeau, et le drapeau est refusé en
 * production. C'est la seule route de ce dépôt dans ce cas, et elle est nommée
 * ici plutôt que découverte plus tard.
 *
 * **Elle exige une session, et le périmètre de cette session-là.** Les
 * identifiants de session locale sont déterministes — `cs_local_<empreinte du
 * périmètre>_<prix>` —, donc devinables : sans cette garde, un visiteur
 * terminait le checkout ouvert par quelqu'un d'autre (constat F7 de la revue).
 * Le refus est **404** dans les trois cas — mode local absent, appelant
 * anonyme, session d'un autre périmètre : une réponse qui les distinguerait
 * dirait ce qui existe (`docs/security.md` §7).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Zod à la frontière, y compris sur un paramètre d'URL (`docs/security.md` §4). */
const SESSION_ID = z.string().min(1).max(200)

export async function GET(request: Request): Promise<Response> {
  const local = billing.localCheckout()

  if (local === null) {
    return new Response(null, { status: 404 })
  }

  const parsed = SESSION_ID.safeParse(new URL(request.url).searchParams.get('session'))

  if (!parsed.success) {
    return new Response(null, { status: 404 })
  }

  // **La fonction unique** qui dit à qui appartient une donnée : la même que
  // celle dont le module reçoit le résultat en `ownerOf`. Aucun périmètre n'est
  // accepté en paramètre — il est résolu depuis la session.
  const { session } = await currentViewer()
  const scope = session === null ? null : await dataOwnerOf(session)

  if (scope === null) {
    return new Response(null, { status: 404 })
  }

  prepareModuleServices()

  const deliveries = local.completeCheckout(parsed.data, billingScopeReference(scope))

  for (const delivery of deliveries) {
    // La **vraie** route du module, par le **vrai** répartiteur : rien n'est
    // court-circuité. La requête est construite ici, elle ne passe pas par le
    // réseau.
    await dispatchModuleRequest(
      moduleRegistry,
      new Request(`${new URL(request.url).origin}${billingRoutePath('webhook')}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': delivery.signature,
        },
        body: delivery.payload,
      }),
    )
  }

  const outcome = deliveries.length === 0 ? 'cancelled' : 'success'

  return Response.redirect(new URL(`/billing?checkout=${outcome}`, request.url), 303)
}
