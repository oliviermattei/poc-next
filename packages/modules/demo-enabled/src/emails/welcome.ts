import type { EmailTemplate } from '@repo/core'

/**
 * Un template d'email et **toutes** ses locales.
 *
 * Le type l'impose : `locales` est indexé par les locales de `messages`. Retirer
 * l'entrée `en` ci-dessous ne fait pas échouer un test, ça fait échouer
 * `pnpm typecheck` — la vérification arrive avant l'exécution, donc avant
 * l'envoi d'un email dans une langue qui n'existe pas.
 *
 * Le texte porte ses données entre accolades : `@repo/emails` les interpole au
 * rendu, dans le sujet comme dans le corps, et **refuse** un envoi dont une
 * donnée manque plutôt que d'expédier « Bonjour {name} » à un destinataire.
 *
 * C'est le template de démonstration du moteur d'emails (s06). Le module
 * déclare le texte et ses locales ; la mise en page est celle de
 * `TransactionalEmail`, commune à tous les modules.
 */
export const welcomeEmail: EmailTemplate<'fr' | 'en'> = {
  id: 'welcome',
  locales: {
    fr: {
      subject: 'Bienvenue {name}',
      body: 'Bonjour {name}, votre premier élément de démonstration vous attend.',
    },
    en: {
      subject: 'Welcome {name}',
      body: 'Hello {name}, your first demo item is waiting for you.',
    },
  },
}
