/**
 * La racine mène au Guide en français, qui fait foi.
 *
 * En export statique, aucun serveur ne répond 308, et `redirect()` de Next
 * n'écrit dans `out/index.html` qu'une redirection exécutée par JavaScript —
 * mesuré au build : ni `<meta http-equiv="refresh">`, ni lien. La page
 * l'écrit donc elle-même, avec les deux liens pour qui n'est pas redirigé.
 */
export default function RootPage() {
  return (
    <html lang="fr">
      <head>
        <meta httpEquiv="refresh" content="0; url=/fr/" />
        <title>Guide</title>
      </head>
      <body>
        <p>
          <a href="/fr/">Guide en français</a> · <a href="/en/">Guide in English</a>
        </p>
      </body>
    </html>
  )
}
