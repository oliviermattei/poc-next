import {
  EMPTY_MARKETING_SITE,
  marketingModule,
  resolveMarketingSite,
  type MarketingSite,
} from '@repo/module-marketing'

import { marketingConfiguration } from '../../../config/marketing'
import { moduleRegistry } from './module-registry'

/**
 * Le point de composition du site public — le quatrième du même modèle, après
 * `lib/mailer.ts` (quel fournisseur d'emails), `lib/auth.ts` (quel service
 * d'authentification) et `lib/locale-routing.ts` (quelle forme d'URL).
 *
 * C'est **le seul fichier de l'application** qui connaisse
 * `@repo/module-marketing`, et le seul qui regarde si ce module est monté.
 * Ailleurs — écrans, plan de site, robots — on lit `marketingSite`, dont la
 * **forme est la même dans les deux états** : trois listes, vides quand le
 * module est coupé. C'est ce qui empêche la racine, les pages légales et les
 * fichiers de métadonnées de porter chacun une branche « si le marketing
 * existe » (`apps/web/AGENTS.md`).
 *
 * Le choix se lit dans le **registre**, jamais dans `config/features.ts`
 * directement : le registre est déjà la vérité sur ce qui est activé, et
 * l'identifiant vient du module lui-même — pas d'une chaîne recopiée qu'un
 * renommage laisserait fausse.
 *
 * La configuration n'est **validée que lorsque le module est monté**, et c'est
 * volontaire : un dépôt qui coupe le marketing n'a pas à maintenir un
 * `config/marketing.ts` cohérent, et une configuration devenue fausse ne doit
 * pas empêcher une application sans site public de démarrer. Module activé, en
 * revanche, une configuration fausse arrête le démarrage en nommant la section
 * fautive — c'est la même règle que pour un requis manquant.
 *
 * | | module activé | module coupé |
 * |---|---|---|
 * | `/` pour un visiteur | accueil marketing | redirection vers la connexion |
 * | `/legal/<slug>` | servi pour un slug déclaré | 404 |
 * | `sitemap.xml` | les chemins publics, dans chaque langue | aucune entrée |
 * | `robots.txt` | les chemins publics autorisés, plan de site annoncé | tout interdit |
 * | pied de page | liens légaux | absent, avec les pages |
 */
export const marketingSite: MarketingSite = moduleRegistry.moduleIds.includes(marketingModule.id)
  ? resolveMarketingSite(marketingConfiguration)
  : EMPTY_MARKETING_SITE

/**
 * Le site public a-t-il des formulaires ? **Une donnée**, lue par les écrans.
 *
 * C'est elle qui fait répondre 404 à `/contact` quand le module est coupé, sans
 * qu'une ligne d'écran ne nomme un module.
 *
 * Ce fichier ne **construit** pas le service du module et ne dit même pas
 * comment le construire : ce câblage-là vit dans `lib/module-services.ts`.
 * La raison est mesurée : le harnais de parcours importe ce fichier **hors de
 * Next** pour en dériver ses attentes (`e2e/support/locale.ts`), et y importer
 * `lib/auth` — qui lit `next/headers` — fait échouer le chargement des
 * parcours avant qu'aucun test ne s'exécute.
 */
export const marketingFormsAvailable = marketingSite.forms !== null
