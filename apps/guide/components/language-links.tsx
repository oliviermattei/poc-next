import type { Localized } from '@/lib/i18n'
import { i18n } from '@/lib/i18n'

const GUIDE_IN: Localized = {
  fr: 'Guide en français',
  en: 'Guide in English',
}

/** Un lien vers l'accueil de chaque langue, dérivé de `i18n.languages`. */
export function LanguageLinks() {
  return (
    <p>
      {i18n.languages.map((lang, index) => (
        <span key={lang}>
          {index > 0 ? ' · ' : null}
          <a href={`/${lang}/`}>{GUIDE_IN[lang]}</a>
        </span>
      ))}
    </p>
  )
}
