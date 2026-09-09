import { ADMIN_SIGNUPS_SCREEN_PATH } from '@repo/module-marketing'
import { permanentRedirect } from 'next/navigation'

import { appIntl } from '../../../../lib/i18n'

/**
 * **L'ancienne adresse des inscriptions**, et rien d'autre.
 *
 * Elle disait « subscriptions » pour des inscriptions — des adresses email
 * capturées par les formulaires publics, sans compte ni paiement —, quand ce
 * dépôt appelle « abonnement » un contrat récurrent payant. Le mot est
 * corrigé ; l'adresse, elle, a pu être mise en signet, alors elle redirige.
 *
 * **308 et non 302** : la destination remplace l'origine, elle ne la double
 * pas. Un navigateur qui l'apprend cesse de demander l'ancienne.
 *
 * Aucune garde ici, et c'est volontaire : cette adresse ne lit rien et ne dit
 * rien de plus que sa remplaçante, qui refuse, elle, en 404 (`docs/security.md`
 * §3). Y remettre la garde ferait une seconde vérité à tenir.
 */
export default async function AdminSubscriptionsRedirect() {
  const intl = await appIntl()

  permanentRedirect(intl.path(ADMIN_SIGNUPS_SCREEN_PATH))
}
