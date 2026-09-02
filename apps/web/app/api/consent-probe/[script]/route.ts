import { getEnv } from '@repo/config'
import { z } from 'zod'

import { probeEnabled, probeScriptOf } from '../../../../lib/consent'

/**
 * Les **scripts non essentiels de démonstration** de s36.
 *
 * Ils existent parce que le boilerplate ne livre aucun script tiers — c'est s39
 * qui apportera PostHog — et qu'un mécanisme de consentement sans rien à
 * consentir n'est éprouvable ni au navigateur, ni à l'œil. Ils sont servis par
 * l'application, donc joignables sous `script-src 'self'` sans qu'une source
 * entre dans `config/security.ts`.
 *
 * Ce qu'ils font est ce qu'un vrai script tiers ferait de pire : **s'exécuter**.
 * Chacun pousse son identifiant dans `window.__consentProbe`, ce que
 * `e2e/consent.spec.ts` observe. Asserter l'exécution et non la seule présence
 * dans le DOM est ce qui prouve le piège nommé par la story — le consentement
 * conditionne le **chargement**, pas seulement l'envoi d'événements.
 *
 * Opt-in explicite, sur le modèle de la sonde de traduction manquante (s09) :
 * sans `CONSENT_SCRIPT_PROBE=1`, cette route répond 404 et aucun script n'est
 * déclaré. C'est l'état livré du boilerplate.
 */

/**
 * Le segment de route est une **entrée**, donc validé par Zod avant d'être
 * regardé (`docs/security.md` §4). Sa forme acceptée est celle d'un
 * identifiant, et rien d'autre ; un identifiant bien formé mais non déclaré
 * n'existe pas davantage — la liste des scripts décide, pas le chemin.
 */
const scriptParam = z.object({ script: z.string().regex(/^[a-z][a-z0-9-]*$/) })

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  _request: Request,
  context: { readonly params: Promise<Record<string, string | string[] | undefined>> },
): Promise<Response> {
  if (!probeEnabled(getEnv())) {
    return new Response(null, { status: 404 })
  }

  const parsed = scriptParam.safeParse(await context.params)
  const script = parsed.success ? probeScriptOf(parsed.data.script) : null

  if (script === null) {
    return new Response(null, { status: 404 })
  }

  // `JSON.stringify` plutôt qu'une interpolation : l'identifiant vient de la
  // liste déclarée, mais un jour il viendra d'ailleurs, et une chaîne
  // interpolée dans du JavaScript servi est une injection en attente.
  const body = `(globalThis.__consentProbe ??= []).push(${JSON.stringify(script.id)});`

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
      // Aucune mise en cache : la question posée par le parcours est « ce
      // script a-t-il été demandé ? », et une réponse servie depuis le cache du
      // navigateur ne la distingue pas de « il n'a pas été demandé ».
      'cache-control': 'no-store',
    },
  })
}
