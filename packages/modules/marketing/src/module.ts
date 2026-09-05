import { defineModule, type NavigationEntry } from '@repo/core'

import { MARKETING_MODULE_ID } from './domain/marketing-config'
import { contactMessageEmail } from './emails/contact-message'
import { newsletterConfirmationEmail } from './emails/newsletter-confirmation'
import { marketingPublicUrls } from './infrastructure/marketing-content'
import { requireMarketingService } from './infrastructure/marketing-runtime'
import enMessages from './messages/en.json' with { type: 'json' }
import frMessages from './messages/fr.json' with { type: 'json' }
import { createPublicFormRoutes } from './presentation/public-form-routes'
import { marketingSchema } from './schema'

/**
 * L'entrée de navigation du site public.
 *
 * Une seule, et **publique** : c'est elle qui disparaît avec le module, sans
 * qu'aucun composant ne porte de condition. `order: 0` la place avant l'entrée
 * de connexion du module `auth` — l'accueil est la première chose qu'un
 * visiteur voit.
 *
 * Les pages légales ne sont **pas** dans la navigation : leur point d'accès
 * déclaré est le pied de page (`docs/stories.md`, critère 2 ; finding F57 de la
 * revue de s36). Deux points d'accès concurrents pour le même document
 * divergeraient.
 */
const marketingNavigation: readonly NavigationEntry[] = [
  {
    id: 'home',
    href: '/',
    labelKey: 'navigation.home',
    order: 0,
    protection: { level: 'public' },
  },
]

/**
 * Le contrat du module `marketing`, rempli — les quinze clés.
 *
 * Ce que ce module apporte d'abord, ce sont des **pages** (accueil, mentions
 * légales, contact), que seule l'application peut servir — un `ModuleRoute` est
 * un descripteur monté sous `/api/modules/…` (ADR 017), pas un écran. Sa
 * modularité se joue donc au point de composition, `apps/web/lib/marketing.ts`,
 * exactement comme celle du module `i18n` se joue dans
 * `apps/web/lib/locale-routing.ts`.
 *
 * **s11 lui donne ce qu'il n'avait pas** : deux tables, une migration, deux
 * routes publiques et deux emails. Comme dans `auth` et `organizations`, les cas
 * d'usage ne sont **pas** construits à l'import — ce fichier est chargé par
 * `config/features.ts`, donc par `pnpm ks list` et `pnpm db:generate`, qui n'ont
 * ni base ni mailer. Les routes, la purge et l'export reçoivent un **accès
 * différé** au service (`requireMarketingService`), posé par le point de
 * composition de l'application.
 *
 * Ce qui reste dehors, et pourquoi : `contact_message`, que
 * `docs/architecture.md` attribue à ce module, n'est pas livrée — aucun critère
 * de s11 ne l'écrit ni ne la lit (`docs/research/s11-public-forms.md` §6.1). La
 * limitation de débit a été livrée ici parce que ces deux routes étaient les
 * premiers points d'entrée publics du dépôt ; **s28 a fait converger le
 * compteur** vers son port (ADR 050). La règle des deux seaux reste ce module,
 * `public_form_throttle` n'est plus écrite, et elle n'est pas supprimée.
 */
export const marketingModule = defineModule({
  id: MARKETING_MODULE_ID,
  requires: [],
  schema: marketingSchema,
  migrations: 'packages/modules/marketing/migrations',
  routes: createPublicFormRoutes(requireMarketingService),
  navigation: marketingNavigation,
  /**
   * Les chemins publics du site, contribués comme n'importe quel module de
   * contenu (s53, ADR 054) — accueil, contact et pages légales. Le contenu vient
   * du point de composition de l'application, qui valide `config/marketing.ts`.
   */
  publicUrls: marketingPublicUrls,
  messages: { fr: frMessages, en: enMessages },
  emails: [contactMessageEmail, newsletterConfirmationEmail],
  webhooks: [],
  jobs: [],
  /**
   * Deux catégories, et les deux sont des données personnelles.
   *
   * Une **inscription** publique est une adresse email, et rien qu'elle. Un
   * **message de contact** porte en plus un nom et un texte libre. Les deux sont
   * **effacés**, jamais anonymisés : une inscription anonyme n'est plus une
   * inscription, et un message de contact sans expéditeur n'a plus de réponse
   * possible — dans les deux cas il ne resterait qu'une ligne inutile.
   *
   * `contact_message` a été déclarée ici parce qu'elle est livrée : la revue de
   * s11 a montré qu'un message perdu en cas d'échec d'envoi était un message
   * perdu (constat F8). Une donnée personnelle stockée sans purge ni export
   * n'aurait pas dû être écrite ; ces clés existent pour cela.
   *
   * `public_form_throttle` n'y figure pas : sa clé est un condensat qu'aucune
   * requête de ce module ne peut relier à un compte, et ses lignes ne survivent
   * plus à leur fenêtre (`sweep`). C'est discutable, et c'est écrit comme tel
   * dans `docs/research/s11-public-forms.md` §6.4.
   */
  dataCategories: ['subscription', 'contact-message'],
  retention: { subscription: 'erase', 'contact-message': 'erase' },
  purge: (scope) => requireMarketingService().useCases.purgeVisitorData(scope),
  export: (scope) => requireMarketingService().useCases.exportVisitorData(scope),
})
