/**
 * **La déclaration** du script d'analyse, et **ce qu'il fait une fois chargé**.
 *
 * Le critère 6 de s39 est une **déclaration, pas un mécanisme** : `s36` a déjà
 * construit le crochet — `CONSENT_CATEGORIES`, `NonEssentialScript`,
 * `resolveConsentState` et `ConsentScripts`. Ce fichier ne réimplémente rien de
 * cela ; il dit sous quelle **finalité** ce produit charge un tiers.
 *
 * **Il n'importe pas `@repo/module-consent`, et c'est délibéré.** La forme
 * déclarée est structurellement celle de `NonEssentialScript` — c'est le point
 * de composition (`apps/web/lib/consent.ts`) qui les réunit, comme il réunit
 * déjà le lien de pied de page et le module `marketing`. Un module qui importe
 * un autre module fait un couplage de code là où le contrat n'en demande qu'un
 * de configuration (`requires`).
 *
 * **Ce que la première écriture de cette story avait manqué** (constat 6 de la
 * revue) : elle déclarait le **chargeur** du fournisseur et rien d'autre. Le
 * chargeur pose `window.posthog` et n'initialise rien sans un
 * `posthog.init(clé, …)` en file — il n'y avait aucune clé de projet nulle part
 * dans le bundle du navigateur. L'exploitant qui posait `POSTHOG_KEY` obtenait
 * une bannière, un téléchargement chez un tiers, et **zéro mesure**.
 * `analyticsBootstrap` est la moitié qui manquait, et `tests/analytics.test.ts`
 * l'**exécute** dans un DOM minimal plutôt que de la relire.
 */

export const ANALYTICS_MODULE_ID = 'analytics'

/**
 * L'identifiant du script, tel que le registre de consentement et l'attribut
 * `data-consent-script` le portent.
 */
export const ANALYTICS_SCRIPT_ID = 'posthog'

/**
 * La **finalité**, pas le fournisseur : `analytics` est l'une des deux
 * catégories que s36 a fermées, et un visiteur y lit « mesure d'audience ».
 * Écrire `posthog` ici nommerait une société, ce que la loi ne demande pas et
 * qu'un visiteur ne peut pas juger.
 */
export const ANALYTICS_SCRIPT_CATEGORY = 'analytics'

/** Le chemin du chargeur chez le fournisseur, tel qu'il le documente. */
export const ANALYTICS_LOADER_FILE = '/static/array.js'

export interface DeclaredAnalyticsScript {
  readonly id: string
  readonly category: typeof ANALYTICS_SCRIPT_CATEGORY
  readonly src: string
}

/**
 * Ce que le navigateur a besoin de savoir pour mesurer : une clé de projet et
 * une origine.
 *
 * La clé est **publiable** — c'est ce que le fournisseur appelle une clé de
 * projet, celle qu'un bundle client porte par construction. Le secret du
 * fournisseur, lui, n'entre jamais dans ce produit.
 */
export interface AnalyticsBrowserSettings {
  readonly key: string
  readonly host: string
}

/**
 * Le script à charger — **une fois le consentement accordé**, jamais avant.
 *
 * `src` est servi par **notre propre origine** (la route de ce module), et non
 * par le fournisseur : c'est la seule façon de faire parvenir la clé de projet
 * et l'hôte au navigateur sans script en ligne, que la politique de sécurité
 * livrée refuse. Le chargeur du fournisseur est ensuite injecté par ce
 * script-ci, ce que `'strict-dynamic'` autorise (ADR 036).
 */
export const analyticsScript = (src: string): DeclaredAnalyticsScript => ({
  id: ANALYTICS_SCRIPT_ID,
  category: ANALYTICS_SCRIPT_CATEGORY,
  src,
})

/**
 * **Le script servi au navigateur**, dérivé de la configuration de l'exploitant.
 *
 * Trois choses, et les trois sont nécessaires pour qu'une mesure existe :
 *
 * 1. il insère le **chargeur** du fournisseur, dérivé de l'hôte configuré — le
 *    fournisseur a plusieurs régions, et une adresse figée enverrait des données
 *    personnelles européennes ailleurs ;
 * 2. il **initialise** le fournisseur avec la clé de projet, une fois le
 *    chargeur arrivé. Sans cet appel, `window.posthog` existe et ne mesure rien ;
 * 3. il demande la capture des affichages de page (`capture_pageview`), qui est
 *    l'événement que le fournisseur émet de lui-même à l'initialisation puis à
 *    chaque navigation.
 *
 * **Il ne lève jamais.** Il s'exécute dans la page du produit : un bloqueur qui
 * sert une réponse vide à la place du chargeur ne doit pas casser l'écran pour
 * une mesure.
 *
 * Les valeurs sont insérées par `JSON.stringify` et jamais concaténées : elles
 * viennent de l'environnement, et une apostrophe suffirait sinon à produire un
 * script illisible — ou pire, exécutable autrement qu'écrit.
 */
export const analyticsBootstrap = (settings: AnalyticsBrowserSettings): string => {
  const key = JSON.stringify(settings.key)
  const host = JSON.stringify(settings.host.replace(/\/$/, ''))

  return `(function () {
  var key = ${key};
  var host = ${host};
  var loader = document.createElement('script');

  loader.src = host + ${JSON.stringify(ANALYTICS_LOADER_FILE)};
  loader.async = true;
  loader.addEventListener('load', function () {
    var provider = window.posthog;

    if (!provider || typeof provider.init !== 'function') {
      return;
    }

    provider.init(key, {
      api_host: host,
      capture_pageview: true,
      persistence: 'localStorage+cookie'
    });
  });

  document.head.appendChild(loader);
})();
`
}
