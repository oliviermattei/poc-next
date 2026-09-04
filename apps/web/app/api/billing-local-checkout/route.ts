import { dispatchModuleRequest } from '@repo/core'
import { billingScopeReference } from '@repo/module-billing'
import { z } from 'zod'

import { currentViewer } from '../../../lib/auth'
import { billing, billingRoutePath } from '../../../lib/billing'
import { moduleRegistry } from '../../../lib/module-registry'
import { prepareModuleServices } from '../../../lib/module-services'
import { rateLimitGuard } from '../../../lib/rate-limit'
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

/** Idem pour l'adresse que la page hébergée simulée collecte (s24). */
const GUEST_EMAIL = z.string().trim().toLowerCase().min(3).max(254).pipe(z.email())

/**
 * Fait passer les livraisons par la **vraie** route de webhook du module, par
 * le **vrai** répartiteur : rien n'est court-circuité. Les requêtes sont
 * construites ici, elles ne passent pas par le réseau.
 */
const deliverAll = async (
  deliveries: readonly { readonly payload: string; readonly signature: string }[],
  request: Request,
): Promise<void> => {
  for (const delivery of deliveries) {
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
      // Le webhook est une route publique : le répartiteur la limite, et il est
      // fail-closed. Sans ce garde, le simulateur du mode local se ferait
      // refuser ses propres livraisons.
      { rateLimit: rateLimitGuard() },
    )
  }
}

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

  prepareModuleServices()

  /**
   * **Le tunnel invité** (s24) : aucune session, donc aucun périmètre à
   * comparer — il n'y a personne à qui comparer.
   *
   * Ce que le simulateur termine ici, il ne le termine que si la session porte
   * une référence **invitée** : `billingScopeReference` ne produit jamais de
   * `guest:`, si bien qu'aucun des deux chemins ne peut terminer la session de
   * l'autre.
   *
   * L'adresse tient la place de celle que la page hébergée du fournisseur
   * collecterait. Elle est **dérivée de la session** par défaut, pour qu'un
   * parcours puisse la retrouver sans rien saisir, et remplaçable par un
   * paramètre pour éprouver la branche « cette adresse a déjà un compte ». Rien
   * de tout cela n'existe hors du mode local, qui est refusé en production.
   *
   * **Aucune session n'est ouverte ici**, ni pour l'invité ni pour personne :
   * ce qui arrive au visiteur est un lien envoyé à son adresse.
   */
  if (scope === null) {
    const email = GUEST_EMAIL.safeParse(
      new URL(request.url).searchParams.get('email') ?? `${parsed.data}@guest.local`,
    )

    if (!email.success) {
      return new Response(null, { status: 404 })
    }

    const guestDeliveries = local.completeGuestCheckout(parsed.data, email.data)

    // **404 quand rien n'a été terminé** — session inconnue, ou session d'un
    // compte : le refus garde exactement la forme qu'il avait avant s24, et les
    // cas restent indiscernables. Une réponse qui les distinguerait dirait à un
    // anonyme qu'une session existe pour quelqu'un d'autre (constat F7 de la
    // revue de s19).
    if (guestDeliveries.length === 0) {
      return new Response(null, { status: 404 })
    }

    await deliverAll(guestDeliveries, request)

    return Response.redirect(new URL('/pricing?checkout=success', request.url), 303)
  }

  const deliveries = local.completeCheckout(parsed.data, billingScopeReference(scope))

  await deliverAll(deliveries, request)

  const outcome = deliveries.length === 0 ? 'cancelled' : 'success'

  return Response.redirect(new URL(`/billing?checkout=${outcome}`, request.url), 303)
}
