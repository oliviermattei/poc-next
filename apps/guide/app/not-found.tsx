/**
 * La page 404 de l'export (`out/404.html`), qu'un hébergeur statique sert
 * pour une adresse inconnue. La racine étant transparente, elle pose sa
 * propre balise `<html>`.
 */
export default function NotFound() {
  return (
    <html lang="fr">
      <body>
        <h1>Page introuvable · Page not found</h1>
        <p>
          <a href="/fr/">Guide en français</a> · <a href="/en/">Guide in English</a>
        </p>
      </body>
    </html>
  )
}
