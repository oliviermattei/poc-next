import { defineModule, type NavigationEntry } from '@repo/core'

import { DOCS_PATH } from './application/docs-catalog'
import { DOCS_MODULE_ID } from './domain/message-keys'
import { docsPublicUrls } from './infrastructure/docs-content'
import enMessages from './messages/en.json' with { type: 'json' }
import frMessages from './messages/fr.json' with { type: 'json' }

/**
 * L'entrée de navigation de la documentation.
 *
 * Une seule, et **publique** : c'est elle qui disparaît avec le module, sans
 * qu'aucun composant ne porte de condition — `visibleNavigation` n'agrège que
 * les modules activés. C'est la moitié « le lien disparaît de la navigation
 * publique » du critère 5, tenue par le mécanisme existant.
 *
 * `order: 2` la place après l'entrée du blog (`order: 1`), elle-même après
 * l'accueil du module `marketing` (`order: 0`).
 */
const docsNavigation: readonly NavigationEntry[] = [
  {
    id: 'index',
    href: DOCS_PATH,
    labelKey: 'navigation.docs',
    order: 2,
    protection: { level: 'public' },
  },
]

/**
 * Le contrat du module `docs`, rempli — les quinze clés.
 *
 * **Ce module n'a ni table, ni migration, et c'est structurel** (ADR 053) : son
 * contenu vit dans des fichiers `.mdx` compilés par le bundler, pas dans la
 * base. Il n'a donc rien à purger ni à exporter — une page de documentation
 * n'est la donnée personnelle de personne, elle est écrite par le propriétaire
 * du dépôt. `dataCategories: []` et `retention: {}` sont **déclarés**, pas omis.
 *
 * **Aucune route non plus, et ce n'est pas un oubli.** Ce module apporte des
 * **pages**, que seule l'application peut servir : un `ModuleRoute` est un
 * descripteur monté sous `/api/modules/…` (ADR 017), pas un écran. Sa
 * modularité se joue donc au point de composition, `apps/web/lib/docs.ts`,
 * exactement comme celle de `blog` et de `marketing`. La recherche plein texte,
 * qui aurait pu en demander une, appartient à `s54-docs-recherche`.
 *
 * **`publicUrls`** (la quinzième clé, ADR 054, livrée par s53) est tout ce que
 * cette story a eu à déclarer pour que ses pages entrent dans le `sitemap.xml` :
 * ni `app/sitemap.ts` ni `app/robots.ts` ne connaissent ce module, et c'est
 * exactement ce que s53 a rendu possible.
 */
export const docsModule = defineModule({
  id: DOCS_MODULE_ID,
  requires: [],
  schema: {},
  migrations: null,
  routes: [],
  navigation: docsNavigation,
  publicUrls: docsPublicUrls,
  messages: { fr: frMessages, en: enMessages },
  emails: [],
  webhooks: [],
  jobs: [],
  dataCategories: [],
  retention: {},
  purge: async () => {},
  export: async () => ({}),
})
