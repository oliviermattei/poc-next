import type { MarketingConfigurationInput } from '@repo/module-marketing'

/**
 * Le site public — le fichier que le propriétaire édite.
 *
 * **L'ordre du tableau est l'ordre de la page.** Réordonner deux entrées
 * réordonne les sections ; en retirer une la retire du site. Aucun composant
 * n'est à modifier pour l'un ni pour l'autre : c'est le premier critère de
 * s10, et c'est ce que `packages/modules/marketing` éprouve.
 *
 * Ce fichier ne porte **pas la prose** : elle vit dans les catalogues du module
 * (`packages/modules/marketing/src/messages/`), sans quoi le site ne serait
 * traduisible dans aucune langue. Ce que chaque entrée déclare, ce sont des
 * **identifiants**, dont les clés de traduction sont dérivées :
 *
 * | Déclaré | Clés attendues |
 * |---|---|
 * | une section `<id>` | `section.<id>.title`, `section.<id>.description` |
 * | un élément `<item>` | `section.<id>.item.<item>.title` et `.body` |
 * | une action `<action>` | `section.<id>.action.<action>` |
 * | un document `<slug>` | `legal.<slug>.title`, `.description`, et par section `legal.<slug>.section.<s>.title` et `.body` |
 *
 * Une clé manquante n'est pas un texte manquant : l'écran tombe (s09 refuse
 * tout repli sur le nom de la clé). `tests/marketing.test.ts` confronte donc
 * cette configuration aux catalogues, dans **chaque** locale du projet — un
 * ajout ici sans traduction fait échouer `pnpm test`, pas la page en
 * production.
 *
 * Les natures de section disponibles sont `hero`, `features`, `testimonials`,
 * `faq` et `cta`. Une nature inconnue est **refusée** au démarrage, en la
 * nommant : un bloc que personne n'affiche ne doit pas passer inaperçu.
 *
 * Ce que ce fichier ne fait pas : décider si le site public existe. C'est le
 * module `marketing` de `config/features.ts` qui le décide ; coupé, la racine
 * redirige vers la connexion et aucune page publique n'est servie.
 */
export const marketingConfiguration = {
  sections: [
    {
      id: 'hero',
      kind: 'hero',
      actions: [
        { id: 'signUp', href: '/sign-up', variant: 'default' },
        { id: 'signIn', href: '/sign-in', variant: 'outline' },
      ],
    },
    { id: 'features', kind: 'features', items: ['modules', 'toggle', 'compliance'] },
    { id: 'testimonials', kind: 'testimonials', items: ['indie', 'cto'] },
    { id: 'faq', kind: 'faq', items: ['stack', 'disable', 'theme'] },
    {
      id: 'cta',
      kind: 'cta',
      actions: [{ id: 'signUp', href: '/sign-up', variant: 'default' }],
    },
  ],
  legalDocuments: [
    { slug: 'privacy', sections: ['data', 'retention', 'rights'] },
    { slug: 'terms', sections: ['object', 'account', 'liability'] },
  ],
} as const satisfies MarketingConfigurationInput
