import { defineModule } from '@repo/core'

import { CONSENT_MODULE_ID } from './domain/consent-category'
import { requireConsentService } from './infrastructure/consent-runtime'
import enMessages from './messages/en.json' with { type: 'json' }
import frMessages from './messages/fr.json' with { type: 'json' }
import { createConsentRoutes } from './presentation/consent-routes'

/**
 * Le contrat du module `consent`, rempli — les quinze clés.
 *
 * **Il ne persiste rien** (ADR 035). `schema`, `migrations`, `dataCategories` et
 * `retention` sont vides parce que le choix d'un visiteur vit sur l'appareil de
 * ce visiteur, dans un cookie strictement nécessaire. L'enregistrer côté serveur
 * demanderait d'attribuer un identifiant persistant à un anonyme — c'est-à-dire
 * de le pister pour noter son refus d'être pisté —, et le lier à un compte
 * priverait de leur choix les visiteurs qui n'en ont pas. `purge` et `export`
 * n'ont donc rien à faire : `tests/consent.test.ts` l'affirme au lieu de le
 * laisser en commentaire.
 *
 * **`requires: []`, et c'est la story qui le décide.** Le pied de page appartient
 * au module `marketing`, qui est optionnel ; ce module est socle. Déclarer
 * `marketing` en requis rendrait le consentement indisponible sur une
 * installation qui coupe le site public — exactement la non-conformité que le
 * finding F57 a relevée. Le couplage va dans l'autre sens : c'est s39, qui
 * apporte un script d'analyse, qui déclarera `requires: ['consent']`.
 *
 * **Il n'a pas d'état off propre** : il est inerte par construction quand aucun
 * script non essentiel n'est déclaré. Aucune bannière, aucun cookie, rien
 * d'injecté — c'est l'état livré du boilerplate, et le critère 7 de la story.
 *
 * La route reçoit un **accès différé** au service, comme celles de `marketing` :
 * ce fichier est chargé par `config/features.ts`, donc par `pnpm ks list` et
 * `pnpm db:generate`, qui ne connaissent aucun script.
 */
export const consentModule = defineModule({
  id: CONSENT_MODULE_ID,
  requires: [],
  schema: {},
  migrations: null,
  routes: createConsentRoutes(requireConsentService),
  /**
   * Aucune entrée de navigation.
   *
   * L'écran `/cookies` est servi par l'application, pas par une route de module,
   * et ses deux points d'accès sont **contextuels** : le pied de page du site
   * public, et la carte des paramètres de compte. Une entrée de plus dans la
   * barre latérale mettrait un réglage de confidentialité au même rang que les
   * fonctionnalités du produit, et elle serait visible pour un visiteur anonyme
   * qui n'a pas de barre latérale à lui.
   */
  navigation: [],
  /**
   * Aucune URL publique : ce module ne publie pas de page indexable (s53).
   *
   * Déclaré vide, jamais omis — le compilateur refuse l'omission
   * (`tests/fixtures/typing/missing-public-urls.ts`).
   */
  publicUrls: () => [],
  messages: { fr: frMessages, en: enMessages },
  emails: [],
  webhooks: [],
  jobs: [],
  dataCategories: [],
  retention: {},
  purge: () => Promise.resolve(),
  export: () => Promise.resolve({}),
})
