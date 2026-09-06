import { defineModule, type NavigationEntry } from '@repo/core'

import { CHANGELOG_PATH } from './application/changelog-catalog'
import { CHANGELOG_MODULE_ID } from './domain/message-keys'
import { changelogPublicUrls, requireChangelogContent } from './infrastructure/changelog-content'
import enMessages from './messages/en.json' with { type: 'json' }
import frMessages from './messages/fr.json' with { type: 'json' }
import { createChangelogFeedRoutes } from './presentation/feed-routes'

/**
 * **Le point d'accès aux nouveautés est le pied de page du site public**, et il
 * est déclaré — pas écrit dans les écrans.
 *
 * `surface: 'footer'` (s31, ADR 066) est ce qui fait disparaître ce lien avec le
 * module, sans qu'aucune ligne de `apps/web/app` ne nomme le changelog : le
 * registre n'agrège que les modules activés, et le pied de page se dérive de
 * lui. C'est la moitié « le lien disparaît du pied de page » du critère 5,
 * tenue par le mécanisme plutôt que par une condition.
 *
 * Pas d'entrée dans la barre latérale : les nouveautés sont du contenu public,
 * pas une fonctionnalité du produit. Une entrée de plus mettrait une page de
 * lecture au même rang que les écrans applicatifs, et elle serait visible pour
 * un visiteur anonyme qui n'a pas de barre latérale à lui.
 */
const changelogNavigation: readonly NavigationEntry[] = [
  {
    id: 'index',
    href: CHANGELOG_PATH,
    labelKey: 'footer.link',
    order: 10,
    protection: { level: 'public' },
    surface: 'footer',
  },
]

/**
 * Le contrat du module `changelog`, rempli — les quinze clés.
 *
 * **Ce module n'a ni table, ni migration, et c'est structurel** (ADR 053) : son
 * contenu vit dans des fichiers `.mdx` compilés par le bundler, pas dans la
 * base. Il n'a donc rien à purger ni à exporter — une note de version n'est la
 * donnée personnelle de personne, elle est écrite par le propriétaire du dépôt.
 * `dataCategories: []` et `retention: {}` sont **déclarés**, pas omis.
 *
 * **Une route, et une seule** : le flux RSS. C'est elle qui rend « module coupé,
 * aucun flux » dérivé — coupée, elle n'est dans aucune table de routage et le
 * répartiteur répond 404 comme sur un chemin inventé.
 *
 * Ce que ce module apporte par ailleurs est une **page**, que seule
 * l'application peut servir : un `ModuleRoute` est un descripteur monté sous
 * `/api/modules/…` (ADR 017), pas un écran. Sa modularité se joue donc au point
 * de composition, `apps/web/lib/changelog.ts`, exactement comme celle du blog.
 *
 * **Aucun `requires`** : c'est tout l'objet d'ADR 065. Le constructeur de flux
 * vit dans `@repo/core`, que tout module importe déjà ; le réclamer au blog
 * aurait fait perdre les nouveautés à un produit qui coupe le blog.
 */
export const changelogModule = defineModule({
  id: CHANGELOG_MODULE_ID,
  requires: [],
  schema: {},
  migrations: null,
  routes: createChangelogFeedRoutes({
    content: requireChangelogContent,
    messages: { fr: frMessages, en: enMessages },
  }),
  navigation: changelogNavigation,
  /**
   * **Une seule URL : la page.** Les entrées n'ont pas d'adresse propre — elles
   * sont toutes sur la même page, et annoncer une URL par entrée publierait des
   * adresses qui répondent 404.
   */
  publicUrls: changelogPublicUrls,
  messages: { fr: frMessages, en: enMessages },
  emails: [],
  webhooks: [],
  jobs: [],
  dataCategories: [],
  retention: {},
  purge: async () => {},
  export: async () => ({}),
})
