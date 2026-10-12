import { LanguageLinks } from '@/components/language-links'
import { i18n } from '@/lib/i18n'

/**
 * La page 404 de l'export (`out/404.html`), qu'un hébergeur statique sert
 * pour une adresse inconnue. La racine étant transparente, elle pose sa
 * propre balise `<html>`.
 */
export default function NotFound() {
  return (
    <html lang={i18n.defaultLanguage}>
      <body>
        <h1>Page introuvable · Page not found</h1>
        <LanguageLinks />
      </body>
    </html>
  )
}
