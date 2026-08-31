import { I18N_MISSING_KEY_PROBE_ENABLED, getEnv } from '@repo/config'
import { getTranslations } from 'next-intl/server'

/**
 * La **sonde de traduction manquante** : le seul endroit du dépôt qui demande
 * une clé qu'aucun catalogue ne livre.
 *
 * Elle existe pour rendre observable, au bout de la chaîne, le critère 9 de s09
 * — « une clé manquante est refusée, jamais remplacée par elle-même ». La revue
 * a mesuré le trou : la configuration qui refuse (`i18n/request-config.ts`) est
 * bien éprouvée par un test de nœud, mais **rien ne prouvait qu'elle était
 * encore branchée**. `i18n/request.ts` ramené à `{ locale, messages }` laissait
 * six commandes vertes, alors qu'un écran aurait affiché « app.account.title ».
 *
 * Ici, la question passe par toute la chaîne réelle : le greffon
 * `createNextIntlPlugin`, `i18n/request.ts`, sa configuration, puis le
 * traducteur. Si le refus n'est plus branché, cette route rend **200** avec le
 * chemin de la clé au lieu d'échouer, et `e2e/i18n.spec.ts` rougit.
 *
 * Opt-in explicite, sur le modèle de `EMAIL_LOCAL_CAPTURE` : sans
 * `I18N_MISSING_KEY_PROBE=1`, elle répond 404 et n'expose rien. Le drapeau n'est
 * posé que par `playwright.config.ts`. Il n'est **jamais** déduit de `NODE_ENV`
 * — une sonde qui décide seule de l'environnement où elle s'allume est
 * exactement ce que le socle interdit.
 */

/** Une clé qu'aucun catalogue ne livre, et qui ne doit jamais en livrer. */
const MISSING_KEY = 'app.probe.absent'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(): Promise<Response> {
  if (getEnv().I18N_MISSING_KEY_PROBE !== I18N_MISSING_KEY_PROBE_ENABLED) {
    return new Response(null, { status: 404 })
  }

  const t = await getTranslations()

  // Doit lever. Un 200 signifie que le repli silencieux est revenu.
  return new Response(t(MISSING_KEY), {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}
