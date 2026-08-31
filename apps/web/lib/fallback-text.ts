import { defaultLocale } from '../../../config/i18n'
import enMessages from '../messages/en.json' with { type: 'json' }
import frMessages from '../messages/fr.json' with { type: 'json' }

/**
 * Les textes de l'écran de dernier recours — celui qui s'affiche **quand la
 * racine de l'application a échoué**.
 *
 * `app/global-error.tsx` remplace `app/layout.tsx` : il n'a ni contexte de
 * requête, ni `NextIntlClientProvider`, ni locale résolue, et c'est précisément
 * la couche qui vient de tomber. Il ne peut donc pas passer par `appIntl()`.
 * Deux voies restaient, et la seconde a été écartée :
 *
 * - lire le catalogue de l'application dans la locale par défaut — ce que fait
 *   ce module. Le texte reste une **clé de catalogue**, comme partout ailleurs
 *   (`apps/web/AGENTS.md`), et le prix est connu : un visiteur qui lisait
 *   l'anglais voit la langue du site sur cet écran-là ;
 * - reconstruire le catalogue complet par `lib/messages.ts` — refusé : cela
 *   ferait entrer le registre de modules et `config/features.ts` dans un bundle
 *   **client**, pour une page dont l'existence même signale que ce registre
 *   peut être ce qui a échoué.
 *
 * Aucun repli sur la clé : la règle de s09 vaut ici comme ailleurs — un écran
 * affichant « app.error.title » ne rougirait nulle part.
 */
const CATALOGUES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  fr: frMessages,
  en: enMessages,
}

export function fallbackText(key: string): string {
  const value = CATALOGUES[defaultLocale]?.[key]

  if (value === undefined) {
    throw new Error(
      `Traduction manquante : « ${key} » dans le catalogue de secours (${defaultLocale}). ` +
        'Toute chaîne affichée vient des catalogues ; aucune ne se replie sur sa clé.',
    )
  }

  return value
}

/** La langue de cet écran : celle du site, faute de requête pour en décider une. */
export const fallbackLocale = defaultLocale
