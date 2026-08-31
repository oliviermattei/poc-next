/**
 * Les sources tierces de la politique de sécurité du contenu — le fichier que
 * le propriétaire édite.
 *
 * **C'est le seul endroit d'où une source peut entrer dans la politique.**
 * `docs/security.md` §1 l'exige en toutes lettres : « les sources tierces sont
 * déclarées, jamais élargies par commodité », et « ajouter une source à la
 * politique de sécurité du contenu exige une justification écrite dans la
 * story ». La règle est exécutable, pas documentaire :
 * `tests/security-headers.test.ts` découpe la politique construite et refuse
 * tout jeton qui n'est ni un mot-clé CSP (`'self'`, `'none'`, le nonce de la
 * requête) ni une ligne de ce fichier. Un domaine écrit en dur dans
 * `apps/web/lib/security-headers.ts` — le geste naturel quand on « fait
 * marcher » un script d'analyse — fait donc échouer `pnpm test`.
 *
 * Ce que ce fichier ne fait pas : décider de la **forme** de la politique. Les
 * directives, les mots-clés et la différence entre développement et production
 * appartiennent au constructeur ; ici on ne déclare que des origines.
 *
 * Les clients connus de ce fichier, et aucun n'existe encore : le captcha de
 * s28, l'analytique de s39, et le fournisseur d'identité de s12 s'il finit par
 * recevoir un formulaire plutôt qu'une redirection. Chacun devra aussi passer
 * par le registre de consentement de s36 : déclarer une origine ici l'autorise,
 * cela ne la charge pas.
 *
 * Une origine s'écrit sans barre oblique finale (`https://exemple.test`), et
 * jamais en `*` : un joker rend la politique inutile sur la directive qu'il
 * couvre.
 */
export interface ContentSecurityPolicySources {
  /** `script-src` — un script exécuté par la page. */
  readonly script: readonly string[]
  /** `style-src` — une feuille de style chargée par la page. */
  readonly style: readonly string[]
  /** `connect-src` — `fetch`, `XMLHttpRequest`, `WebSocket`, balise réseau. */
  readonly connect: readonly string[]
  /** `img-src` — une image, y compris un pixel de mesure. */
  readonly img: readonly string[]
  /** `font-src` — une police servie par un domaine externe. */
  readonly font: readonly string[]
  /** `frame-src` — un iframe intégré (widget de paiement, captcha). */
  readonly frame: readonly string[]
  /** `form-action` — la destination d'un `<form>` qui sort de l'application. */
  readonly formAction: readonly string[]
}

/**
 * L'état livré : **aucune source tierce**. Mesuré sur les onze réponses
 * balayées par `docs/research/s45-security-headers.md` §2.1 — polices et CSS
 * sont servies par l'application, les icônes sont des SVG en ligne, aucune
 * image externe. `default-src 'self'` suffit donc, sans exception.
 */
export const contentSecurityPolicySources: ContentSecurityPolicySources = {
  script: [],
  style: [],
  connect: [],
  img: [],
  font: [],
  frame: [],
  formAction: [],
}
