import { defineModule, type NavigationEntry } from '@repo/core'

import { BLOG_PATH } from './application/blog-catalog'
import { BLOG_MODULE_ID } from './domain/message-keys'
import enMessages from './messages/en.json' with { type: 'json' }
import frMessages from './messages/fr.json' with { type: 'json' }

/**
 * L'entrée de navigation du blog.
 *
 * Une seule, et **publique** : c'est elle qui disparaît avec le module, sans
 * qu'aucun composant ne porte de condition — `visibleNavigation` n'agrège que
 * les modules activés. C'est la moitié « le lien disparaît de la navigation
 * publique » du critère 6, tenue par le mécanisme existant.
 *
 * `order: 1` la place après l'accueil du module `marketing` (`order: 0`) et
 * avant l'entrée de connexion.
 */
const blogNavigation: readonly NavigationEntry[] = [
  {
    id: 'index',
    href: BLOG_PATH,
    labelKey: 'navigation.blog',
    order: 1,
    protection: { level: 'public' },
  },
]

/**
 * Le contrat du module `blog`, rempli — les quatorze clés.
 *
 * **Ce module n'a ni table, ni migration, ni route d'API, et c'est structurel**
 * (ADR 053) : son contenu vit dans des fichiers `.mdx` compilés par le bundler,
 * pas dans la base. Il n'a donc rien à purger ni à exporter — un article n'est
 * la donnée personnelle de personne, il est écrit par le propriétaire du dépôt.
 * `dataCategories: []` et `retention: {}` sont **déclarés**, pas omis.
 *
 * Ce que ce module apporte, ce sont des **pages**, que seule l'application peut
 * servir : un `ModuleRoute` est un descripteur monté sous `/api/modules/…`
 * (ADR 017), pas un écran. Sa modularité se joue donc au point de composition,
 * `apps/web/lib/blog.ts`, exactement comme celle de `marketing` dans
 * `apps/web/lib/marketing.ts`.
 *
 * **Ce que ce module ne fait pas encore, et volontairement** : ni flux RSS, ni
 * image Open Graph par défaut, ni contribution au plan de site. Ces trois-là
 * demandent une décision sur le contrat de module (`ModuleDefinition` n'a
 * aucune clé de plan de site) et sont la story `s53-blog-syndication`.
 */
export const blogModule = defineModule({
  id: BLOG_MODULE_ID,
  requires: [],
  schema: {},
  migrations: null,
  routes: [],
  navigation: blogNavigation,
  messages: { fr: frMessages, en: enMessages },
  emails: [],
  webhooks: [],
  jobs: [],
  dataCategories: [],
  retention: {},
  purge: async () => {},
  export: async () => ({}),
})
