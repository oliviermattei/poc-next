import { defineModule, type NavigationEntry } from '@repo/core'

import { MARKETING_MODULE_ID } from './domain/marketing-config'
import enMessages from './messages/en.json' with { type: 'json' }
import frMessages from './messages/fr.json' with { type: 'json' }

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
 * Le contrat du module `marketing`, rempli — les quatorze clés.
 *
 * Ce module ne déclare **ni route, ni table, ni migration**, et c'est sa nature
 * en s10 : ce qu'il apporte, ce sont des **pages** (accueil, mentions légales),
 * que seule l'application peut servir — un `ModuleRoute` est un descripteur
 * monté sous `/api/modules/…` (ADR 017), pas un écran. Sa modularité se joue
 * donc au point de composition, `apps/web/lib/marketing.ts`, exactement comme
 * celle du module `i18n` se joue dans `apps/web/lib/locale-routing.ts`.
 *
 * Le contrat n'en est pas moins rempli au complet, clés vides comprises : en
 * ajouter une plus tard rouvrirait tous les modules déjà écrits (ADR 007).
 *
 * Ce qui viendra, et qui n'est **pas** ici : la table des inscriptions
 * publiques et les messages de contact appartiennent à s11, la limitation de
 * débit de ces formulaires à s28. Les déclarer d'avance produirait un schéma
 * que rien n'écrit et une clé étrangère que rien ne lit.
 */
export const marketingModule = defineModule({
  id: MARKETING_MODULE_ID,
  requires: [],
  schema: {},
  migrations: null,
  routes: [],
  navigation: marketingNavigation,
  messages: { fr: frMessages, en: enMessages },
  emails: [],
  webhooks: [],
  jobs: [],
  // Aucune donnée personnelle : ce module ne détient que du texte de
  // configuration. Déclaré vide, jamais omis.
  dataCategories: [],
  retention: {},
  purge: () => Promise.resolve(),
  export: () => Promise.resolve({}),
})
