import type { EmailTemplate } from '@repo/core'

/**
 * Un template d'email et **toutes** ses locales.
 *
 * Le type l'impose : `locales` est indexé par les locales de `messages`. Retirer
 * l'entrée `en` ci-dessous ne fait pas échouer un test, ça fait échouer
 * `pnpm typecheck` — la vérification arrive avant l'exécution, donc avant
 * l'envoi d'un email dans une langue qui n'existe pas.
 *
 * Les templates React Email arrivent avec le mailer (s06) : ce module déclare la
 * forme, pas le rendu.
 */
export const welcomeEmail: EmailTemplate<'fr' | 'en'> = {
  id: 'welcome',
  locales: {
    fr: {
      subject: 'Bienvenue',
      body: 'Votre premier élément de démonstration vous attend.',
    },
    en: {
      subject: 'Welcome',
      body: 'Your first demo item is waiting for you.',
    },
  },
}
