import { defineModule } from '@repo/core'

import enMessages from './messages/en.json' with { type: 'json' }
import frMessages from './messages/fr.json' with { type: 'json' }

/**
 * Le contrat du module `i18n`, rempli.
 *
 * Ce module ne déclare **ni route, ni table, ni migration**, et c'est sa nature :
 * ce qu'il apporte est la forme des URL et le sélecteur de langue, pas un
 * point d'entrée de plus. Le contrat reste rempli au complet — clés vides
 * comprises —, sans quoi l'ajout d'une clé rouvrirait tous les modules (ADR
 * 007).
 *
 * Ce qu'il apporte, en revanche, est **lu** : ses traductions entrent dans le
 * catalogue de l'application par le registre, et le couper les en retire. C'est
 * le critère « désactiver un module retire ses clés sans casser le chargement
 * des autres », observable sur ce module-ci comme sur n'importe quel autre.
 *
 * `localePrefixRouting` n'est pas au contrat : le contrat ne porte pas de
 * capacité de routage, et l'y ajouter obligerait à rouvrir tous les modules
 * pour une clé qu'un seul remplira jamais. C'est le point de composition de
 * l'application qui l'assemble, exactement comme il assemble le service
 * d'authentification et le mailer.
 */
export const i18nModule = defineModule({
  id: 'i18n',
  requires: [],
  schema: {},
  migrations: null,
  routes: [],
  navigation: [],
  messages: { fr: frMessages, en: enMessages },
  emails: [],
  webhooks: [],
  jobs: [],
  dataCategories: [],
  retention: {},
  purge: () => Promise.resolve(),
  export: () => Promise.resolve({}),
})
