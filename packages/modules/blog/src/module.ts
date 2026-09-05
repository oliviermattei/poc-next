import { defineModule, type NavigationEntry } from '@repo/core'

import { BLOG_PATH } from './application/blog-catalog'
import { BLOG_MODULE_ID } from './domain/message-keys'
import { blogPublicUrls, requireBlogContent } from './infrastructure/blog-content'
import enMessages from './messages/en.json' with { type: 'json' }
import frMessages from './messages/fr.json' with { type: 'json' }
import { createBlogFeedRoutes } from './presentation/feed-routes'

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
 * Le contrat du module `blog`, rempli — les quinze clés.
 *
 * **Ce module n'a ni table, ni migration, et c'est structurel** (ADR 053) : son
 * contenu vit dans des fichiers `.mdx` compilés par le bundler, pas dans la
 * base. Il n'a donc rien à purger ni à exporter — un article n'est la donnée
 * personnelle de personne, il est écrit par le propriétaire du dépôt.
 * `dataCategories: []` et `retention: {}` sont **déclarés**, pas omis.
 *
 * **Une route, et une seule, depuis s53** : le flux RSS. Il déclarait
 * `routes: []` jusque-là ; la ligne « ni route d'API » de cet en-tête a survécu
 * à la story qui l'a démentie, et c'est un constat de revue.
 *
 * Ce que ce module apporte, ce sont des **pages**, que seule l'application peut
 * servir : un `ModuleRoute` est un descripteur monté sous `/api/modules/…`
 * (ADR 017), pas un écran. Sa modularité se joue donc au point de composition,
 * `apps/web/lib/blog.ts`, exactement comme celle de `marketing` dans
 * `apps/web/lib/marketing.ts`.
 *
 * **Ce que s53 a livré**, et que cet en-tête annonçait encore comme à faire :
 * le flux RSS (route du module, ci-dessous), la contribution au plan de site
 * (`publicUrls`, la quinzième clé du contrat — ADR 054) et l'image Open Graph
 * par défaut, qui n'est **pas** ici : elle appartient à l'application
 * (`apps/web/lib/og-image.ts`), parce qu'elle vaut pour tout le produit.
 *
 * **Ce que ce module ne fait toujours pas** : servir ses propres écrans. Un
 * `ModuleRoute` n'est pas une page (ADR 017), et le design system n'a **aucun
 * gabarit d'image sociale** — c'est un manque signalé, pas un manque comblé
 * (`scripts/og-image.ts`).
 */
export const blogModule = defineModule({
  id: BLOG_MODULE_ID,
  requires: [],
  schema: {},
  migrations: null,
  /**
   * Le flux RSS (s53) — la première route du module.
   *
   * C'est elle qui rend « module coupé, aucun flux » **dérivé** : coupée, la
   * route n'est dans aucune table et le répartiteur répond 404 comme sur un
   * chemin inventé.
   */
  routes: createBlogFeedRoutes({
    content: requireBlogContent,
    messages: { fr: frMessages, en: enMessages },
  }),
  navigation: blogNavigation,
  /**
   * Les URL des articles (s53, ADR 054) — la moitié de la syndication qu'aucune
   * clé existante ne pouvait porter, le contenu n'étant connu qu'après lecture
   * du disque.
   */
  publicUrls: blogPublicUrls,
  messages: { fr: frMessages, en: enMessages },
  emails: [],
  webhooks: [],
  jobs: [],
  dataCategories: [],
  retention: {},
  purge: async () => {},
  export: async () => ({}),
})
