import type { ContentSecurityPolicySources } from '../../../config/security'

export type { ContentSecurityPolicySources }

/**
 * Le socle d'en-têtes de sécurité (`docs/security.md` §1), construit sans effet
 * de bord.
 *
 * **Une seule source, et c'est une décision.** Poser une partie des en-têtes
 * ici et une autre dans `headers()` de `next.config.ts` ferait partir deux
 * `Content-Security-Policy` sur les chemins couverts par les deux : les
 * navigateurs appliquent alors l'**intersection** des politiques, et la plus
 * stricte gagne silencieusement — un mode de panne qui ne ressemble à rien de
 * ce qu'on a écrit. Tout part donc de `apps/web/proxy.ts`, qui appelle cette
 * fonction.
 *
 * Fonction pure, et c'est ce qui la rend contrôlable : le mode, le nonce, les
 * sources et le chemin du collecteur arrivent tous en argument, si bien qu'un
 * test peut exiger la politique de production sans être en production.
 */

/** L'en-tête par lequel le nonce de la requête atteint les composants serveur. */
export const NONCE_HEADER = 'x-nonce'

/**
 * Où les violations sont collectées — en développement seulement.
 *
 * Exportée pour que l'appelant la passe en argument et que la route qui reçoit
 * cite la même : le constructeur, lui, ne connaît aucun chemin.
 */
export const CSP_REPORT_PATH = '/api/csp-report'

/**
 * Un an et un jour, en secondes. `docs/security.md` §1 exige « `max-age` ≥ 1 an,
 * `includeSubDomains` ». Pas de `preload` : l'inscription à la liste des
 * navigateurs est une porte à sens unique, elle appartient au propriétaire du
 * domaine, pas au boilerplate.
 */
const HSTS_MAX_AGE = 63_072_000

export type PolicyMode = 'development' | 'production'

export interface SecurityHeadersOptions {
  readonly mode: PolicyMode
  /** Le nonce de **cette** requête. Un nonce réutilisé ne vaut rien. */
  readonly nonce: string
  readonly sources: ContentSecurityPolicySources
  /**
   * Où le navigateur poste ses rapports de violation, en mode développement.
   *
   * En argument et non en constante de module : la politique et la route qui
   * reçoit ne doivent pas pouvoir diverger sans que l'appelant l'ait écrit.
   */
  readonly reportPath: string
}

/**
 * Le mode d'application de la politique, dérivé du mode d'exécution.
 *
 * Il n'est **pas** dérivé d'un drapeau posé par le développeur, contrairement à
 * la capture locale des emails (`lib/mailer-config.ts`), et la différence est de
 * nature : là-bas, `docs/reliability.md` §2 interdit de déduire le comportement
 * de `NODE_ENV` parce qu'un email capturé serait indiscernable d'un email
 * envoyé. Ici, ce qui change entre les deux modes est le **bundle React
 * lui-même** — en développement il appelle `eval` pour reconstruire les piles
 * d'appel serveur, mesuré (recherche §2.3). Aucun drapeau ne peut décrire cela,
 * et une politique trop stricte ne se cache pas : la page ne s'affiche plus.
 */
export function policyMode(nodeEnv: 'development' | 'test' | 'production'): PolicyMode {
  return nodeEnv === 'production' ? 'production' : 'development'
}

const directive = (name: string, sources: readonly string[]): string =>
  `${name} ${sources.join(' ')}`.trim()

/**
 * La politique de sécurité du contenu.
 *
 * Les quatre directives qui ne retombent **pas** sur `default-src` sont
 * écrites : `object-src`, `base-uri`, `form-action`, `frame-ancestors`. Les
 * omettre laisse une politique qui a l'air stricte et ne l'est pas — un
 * `<base href>` injecté suffit alors à détourner chaque URL relative de la page.
 *
 * `'strict-dynamic'` : le script d'amorçage de Next insère lui-même les morceaux
 * de l'application. Les navigateurs qui comprennent le mot-clé ignorent alors
 * `'self'` et ne font confiance qu'à ce que le script nonçé charge ; ceux qui ne
 * le comprennent pas retombent sur `'self'`. Dans les deux cas, jamais plus
 * permissif.
 *
 * Le développement assouplit **deux** points, et pas un de plus (recherche
 * §2.3) : `'unsafe-eval'` pour React, `'unsafe-inline'` de style pour le CSS que
 * Turbopack injecte par JavaScript. `'unsafe-inline'` n'entre **jamais** dans
 * `script-src`, pas même là — c'est ce qui permet à un parcours Playwright, qui
 * tourne sur `next dev`, de démontrer qu'un script en ligne sans nonce ne
 * s'exécute pas.
 */
function contentSecurityPolicy({
  mode,
  nonce,
  sources,
  reportPath,
}: SecurityHeadersOptions): string {
  const development = mode === 'development'

  return [
    directive('default-src', ["'self'"]),
    directive('script-src', [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(development ? ["'unsafe-eval'"] : []),
      ...sources.script,
    ]),
    directive('style-src', [
      "'self'",
      ...(development ? ["'unsafe-inline'"] : [`'nonce-${nonce}'`]),
      ...sources.style,
    ]),
    directive('img-src', ["'self'", ...sources.img]),
    directive('font-src', ["'self'", ...sources.font]),
    directive('connect-src', ["'self'", ...sources.connect]),
    // `frame-src` est la seule directive dont l'état livré n'est pas `'self'` :
    // l'application n'intègre aucun iframe, et `frame-ancestors 'none'` dit
    // déjà qu'elle refuse d'être encadrée. Dès qu'une source est déclarée, elle
    // **s'ajoute** à `'self'` comme partout ailleurs — la remplacer couperait
    // les iframes de même origine le jour où un captcha est déclaré.
    directive('frame-src', sources.frame.length > 0 ? ["'self'", ...sources.frame] : ["'none'"]),
    directive('object-src', ["'none'"]),
    directive('base-uri', ["'self'"]),
    directive('form-action', ["'self'", ...sources.formAction]),
    directive('frame-ancestors', ["'none'"]),
    ...(development
      ? // `report-uri` est marqué obsolète et reste le seul mécanisme que les
        // navigateurs honorent sans en-tête `Reporting-Endpoints` séparé. Absent
        // en production : la route qui le sert n'y existe pas non plus.
        [directive('report-uri', [reportPath])]
      : // Sur un serveur de développement servi en clair sur `localhost`, cette
        // directive ferait tenter le https sur chaque sous-ressource.
        [`upgrade-insecure-requests`]),
  ].join('; ')
}

/**
 * Les six en-têtes du socle §1, en minuscules : c'est la forme normalisée des
 * en-têtes HTTP/2, et elle évite qu'un appelant en pose un second sous une
 * casse différente.
 */
export function securityHeaders(options: SecurityHeadersOptions): Record<string, string> {
  return {
    'content-security-policy': contentSecurityPolicy(options),
    'strict-transport-security': `max-age=${HSTS_MAX_AGE}; includeSubDomains`,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    // Refusées par défaut pour l'application **et** pour ce qu'elle intègre :
    // la liste vide est ce qui ferme la fonctionnalité à tout le monde.
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    // Doublon assumé de `frame-ancestors 'none'` : les navigateurs récents
    // suivent la directive CSP, les plus anciens ne connaissent que cet en-tête.
    'x-frame-options': 'DENY',
  }
}
