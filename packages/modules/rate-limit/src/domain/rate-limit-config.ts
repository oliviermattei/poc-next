import { z } from 'zod'

/**
 * **La lecture de `config/security.ts`** (s28, critère 4) — Zod à la frontière,
 * comme sur toute autre frontière du dépôt (`docs/security.md` §4).
 *
 * Ce fichier est pur : il reçoit une valeur et rend des politiques, ou refuse.
 * Il ne lit ni l'environnement du processus, ni `config/`, ni le disque — c'est
 * le point de composition de l'application qui lui donne ce qu'il a lu. Le
 * balayage de `tests/rate-limiting.test.ts` refuse d'ailleurs toute lecture
 * d'environnement sur ce chemin, jusqu'au nom cité dans un commentaire :
 * l'échappatoire du critère 8 ne doit même pas être écrite ici.
 *
 * **Ce qu'il refuse est le cœur du critère 8.** Un seuil nul ou négatif n'est
 * pas interprété comme « aucune limite » : il fait échouer le démarrage, en
 * nommant la politique et le champ. C'est la seule façon d'être sûr que le
 * fichier de configuration ne devienne pas la variable d'environnement qu'on
 * s'est interdite — un `maxPerClient: 0` silencieusement accepté serait
 * exactement la porte que la story ferme.
 */

const POSITIVE = z.number().int().positive()

const POLICY = z.object({
  windowSeconds: POSITIVE,
  maxPerClient: POSITIVE,
  /** `null` quand la route ne vise aucun compte. Jamais zéro : voir plus haut. */
  maxPerSubject: POSITIVE.nullable(),
})

export type ParsedRateLimitPolicy = z.infer<typeof POLICY>

/**
 * `default` est **obligatoire** : c'est le filet de toute route publique qui ne
 * nomme pas de politique. Sans lui, une route publique ajoutée demain
 * n'appartiendrait à aucune politique, et la couverture dérivée du registre
 * n'aurait plus rien à quoi se raccrocher.
 */
const POLICIES = z.record(z.string(), POLICY).refine((value) => 'default' in value, {
  message:
    'La politique « default » est obligatoire : c’est celle qu’applique toute route publique ' +
    'qui n’en nomme pas d’autre. Déclarez-la dans config/security.ts.',
})

export type RateLimitPolicies = Readonly<Record<string, ParsedRateLimitPolicy>>

export class RateLimitConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RateLimitConfigurationError'
  }
}

export function parseRateLimitPolicies(value: unknown): RateLimitPolicies {
  const parsed = POLICIES.safeParse(value)

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'racine'} : ${issue.message}`)
      .join(' ; ')

    throw new RateLimitConfigurationError(
      `Seuils de limitation refusés (config/security.ts) — ${detail}. Un seuil nul ou négatif ` +
        'n’est pas « aucune limite » : il n’existe aucun moyen de désactiver la limitation ' +
        '(s28, critère 8).',
    )
  }

  return parsed.data
}

/** Ce qu'une route dit d'elle-même au regard de la limitation. */
export interface RateLimitedRouteDeclaration {
  readonly path: string
  readonly rateLimit?: { readonly policy: string; readonly subjectField?: string }
}

/**
 * **Une route qui nomme une politique inexistante refuse le démarrage.**
 *
 * Symétrique d'`assertGatesCoverRoutes` (s21, ADR 043), et pour la même raison :
 * une déclaration que personne ne résout ne refuse rien. Sans cette garde, une
 * faute de frappe dans un nom de politique produirait une route servie **sans
 * limite**, et rien ne rougirait.
 */
export function assertPoliciesCoverRoutes(input: {
  readonly policies: RateLimitPolicies
  readonly routes: readonly RateLimitedRouteDeclaration[]
}): void {
  const missing = input.routes
    .filter(
      (route) => route.rateLimit !== undefined && input.policies[route.rateLimit.policy] === undefined,
    )
    .map((route) => `${route.path} → « ${route.rateLimit?.policy} »`)

  if (missing.length > 0) {
    throw new RateLimitConfigurationError(
      `Politique de limitation inconnue : ${missing.join(', ')}. Les politiques sont déclarées ` +
        'dans config/security.ts ; une route qui en nomme une autre ne serait limitée par ' +
        'personne.',
    )
  }
}

/** Le captcha, tel que `config/security.ts` le décrit. */
export interface CaptchaSettings {
  readonly enabled: boolean
  readonly origin: string | null
}

/**
 * **Activer le captcha réclame son origine dans la politique de sécurité du
 * contenu** (critère 5, ADR 027).
 *
 * Un widget tiers sous `default-src 'self'` est bloqué par le navigateur : le
 * formulaire se ferme, sans message, et l'exploitant découvre la panne par ses
 * visiteurs. Le refus au démarrage est donc la version bruyante du même
 * constat — et il n'ajoute **aucune** origine à la place du propriétaire, qui
 * seul décide d'élargir la politique.
 */
export function assertCaptchaIsServable(
  captcha: CaptchaSettings,
  declaredFrameSources: readonly string[],
): void {
  if (!captcha.enabled) {
    return
  }

  if (captcha.origin === null || captcha.origin === '') {
    throw new RateLimitConfigurationError(
      'Captcha activé sans origin : déclarez l’origine du fournisseur dans config/security.ts ' +
        '(captcha.origin), puis ajoutez-la aux sources frame-src et script-src.',
    )
  }

  if (!declaredFrameSources.includes(captcha.origin)) {
    throw new RateLimitConfigurationError(
      `Captcha activé sur « ${captcha.origin} », mais cette origine n’est déclarée ni en ` +
        'frame-src ni en script-src de contentSecurityPolicySources (config/security.ts). ' +
        'Le navigateur bloquerait le widget et fermerait le formulaire sans un mot.',
    )
  }
}
