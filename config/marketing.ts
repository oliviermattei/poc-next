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
    // s11 : ni éléments, ni actions — cette nature porte un formulaire. La
    // retirer d'ici retire l'inscription de la page d'accueil ; la déplacer la
    // déplace.
    { id: 'newsletter', kind: 'newsletter' },
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
  /**
   * Les formulaires publics (s11).
   *
   * `contactRecipient` **est de la configuration** : c'est l'adresse qui reçoit
   * les messages du formulaire de contact, et elle change d'un projet à
   * l'autre. Une adresse écrite dans le code du module serait la même partout,
   * et il faudrait modifier un package pour la corriger. Elle est validée au
   * démarrage : malformée, l'application refuse de servir le site en la
   * nommant.
   *
   * `newsletterSource` alimente la colonne `source` de la table d'inscriptions
   * publiques. Cette table est **partagée** avec la liste d'attente de s42, qui
   * déclarera sa propre source : c'est cette colonne qui les distingue, et
   * c'est pour cela qu'il n'y a qu'un modèle d'inscription.
   *
   * `rateLimit` porte **deux seuils qui ne font pas la même chose**, dans une
   * fenêtre partagée entre toutes les instances (`docs/security.md` §7) :
   *
   * - `maxPerClient` **refuse**. Au-delà, l'appelant reçoit 429 et sa
   *   soumission n'a pas lieu. L'identifiant vient d'un en-tête que le client
   *   peut écrire : un appelant qui le falsifie ne nuit donc qu'à lui-même ;
   * - `maxPerForm` **dégrade, il ne refuse jamais**. Au-delà, la soumission est
   *   acceptée et enregistrée — inscription en base, message de contact en
   *   base —, mais **l'email correspondant n'est pas envoyé**. C'est ce qui
   *   borne le coût réel d'une vague de soumissions sans offrir à son auteur ce
   *   qu'il cherchait : s'il refusait, quelques centaines de requêtes
   *   fermeraient les deux formulaires à tous les visiteurs pendant toute la
   *   fenêtre.
   *
   * Baisser `maxPerForm` ne ferme donc rien ; cela suspend plus tôt les envois
   * sortants. Baisser `maxPerClient` durcit le refus opposé à un appelant — et
   * c'est le seul des deux qui borne le **nombre de lignes** qu'une vague de
   * soumissions peut écrire. L'échange est écrit dans
   * `packages/modules/marketing/AGENTS.md` : tant que l'identifiant d'appelant
   * vient d'un en-tête falsifiable, cette borne-là n'en est pas une.
   */
  forms: {
    contactRecipient: 'bonjour@exemple.test',
    newsletterSource: 'newsletter',
    rateLimit: { windowSeconds: 600, maxPerClient: 5, maxPerForm: 200 },
  },
} as const satisfies MarketingConfigurationInput
