/**
 * La destination de retour après authentification (`docs/security.md` §4 :
 * « Redirections : liste blanche de destinations. Aucune redirection pilotée
 * par un paramètre non validé »).
 *
 * La liste blanche est ici une **forme**, pas une énumération de chemins : est
 * accepté ce qui reste sur ce site, c'est-à-dire un chemin absolu d'une seule
 * barre oblique. Tout le reste retombe sur le repli. Une énumération des
 * chemins d'écran obligerait chaque story qui ajoute une page à revenir ici, et
 * la première qui l'oublierait renverrait l'utilisateur à l'accueil sans que
 * rien ne le dise.
 *
 * Les trois formes refusées sont celles qui sortent du site sans en avoir
 * l'air : l'URL absolue, l'URL protocole-relative (`//evil.test`) et la barre
 * oblique inversée, que les navigateurs normalisent en `/`.
 */
export function safeRedirectPath(candidate: string | null | undefined, fallback: string): string {
  if (typeof candidate !== 'string' || candidate === '') {
    return fallback
  }

  const normalized = candidate.replaceAll('\\', '/')

  if (!normalized.startsWith('/') || normalized.startsWith('//')) {
    return fallback
  }

  return normalized
}
