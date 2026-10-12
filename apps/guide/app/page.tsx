import { LanguageLinks } from '@/components/language-links'
import { i18n } from '@/lib/i18n'

/**
 * La racine mène au Guide dans sa langue par défaut — le français, qui fait foi.
 *
 * En export statique, aucun serveur ne répond 308, et `redirect()` de Next
 * n'écrit dans `out/index.html` qu'une redirection exécutée par JavaScript —
 * mesuré au build : ni `<meta http-equiv="refresh">`, ni lien. La page
 * l'écrit donc elle-même, avec un lien par langue pour qui n'est pas redirigé.
 */
export default function RootPage() {
  return (
    <html lang={i18n.defaultLanguage}>
      <head>
        <meta httpEquiv="refresh" content={`0; url=/${i18n.defaultLanguage}/`} />
        <title>Guide</title>
      </head>
      <body>
        <LanguageLinks />
      </body>
    </html>
  )
}
