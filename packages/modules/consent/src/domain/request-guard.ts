/**
 * Deux gardes sur une soumission de consentement, et rien d'autre : d'où elle
 * vient, et où elle a le droit de renvoyer.
 */

/** L'en-tête est-il **absent** ? Absent n'est pas la même chose qu'opaque. */
const isAbsent = (value: string | null | undefined): value is null | undefined | '' =>
  typeof value !== 'string' || value === ''

/** L'hôte d'une URL, ou `null` si la valeur n'en est pas une. */
const hostOf = (value: string): string | null =>
  URL.canParse(value) ? new URL(value).host : null

export interface SubmissionOrigin {
  /** En-tête `Origin` de la requête. Tout navigateur l'envoie sur un `POST`. */
  readonly origin: string | null
  readonly referer: string | null
  /** L'URL de la requête telle que le serveur la voit. */
  readonly requestUrl: string
}

/**
 * La soumission vient-elle de ce site ?
 *
 * Une soumission inter-site poserait un consentement **au nom** du visiteur : un
 * consentement forgé, ce qui est pire qu'un refus perdu. Le cookie est
 * `SameSite=Lax`, ce qui l'empêche d'être **lu** ailleurs mais pas d'être
 * **écrit** par une requête venue d'ailleurs.
 *
 * La comparaison porte sur l'**hôte**, pas sur le schéma : derrière une
 * terminaison TLS, le navigateur a vu `https://` là où `request.url` porte
 * `http://`, et comparer les schémas refuserait toutes les soumissions en
 * production.
 *
 * **Absent et opaque sont deux cas différents, et le code les sépare.**
 *
 * - *Absent* (`Origin` et `Referer` manquent tous les deux) : **accepté**, et
 *   c'est un choix écrit. Un attaquant ne peut pas faire **retirer** `Origin`
 *   au navigateur d'une victime, donc refuser ici ne fermerait aucune attaque,
 *   tandis que certains outils de confidentialité les suppriment chez des
 *   visiteurs qui sont précisément ceux que cet écran sert.
 * - *Présent mais pas une URL* — au premier chef `Origin: null` : **refusé**.
 *   Un attaquant obtient cette valeur sans effort, par un
 *   `<iframe sandbox="allow-forms">`, un document `data:` ou une chaîne de
 *   redirections inter-origines : le navigateur de la victime émet alors une
 *   origine **opaque**. La confondre avec une absence laisse forger un
 *   consentement complet — mesuré sur le serveur de production, revue de s36,
 *   constat C1. Une origine opaque ne prouve rien : elle ne peut donc pas
 *   valoir laissez-passer.
 *
 * Le **premier en-tête présent décide** : `Origin` s'il est là, sinon
 * `Referer`. Un `Origin` opaque n'est pas rattrapé par un `Referer` de bonne
 * mine — les deux sont écrits par le même appelant.
 */
export function isSameSiteSubmission({ origin, referer, requestUrl }: SubmissionOrigin): boolean {
  const expected = hostOf(requestUrl)

  for (const declared of [origin, referer]) {
    if (isAbsent(declared)) {
      continue
    }

    const host = hostOf(declared)

    return host !== null && expected !== null && host === expected
  }

  return true
}

/**
 * Où renvoyer après la soumission : la page d'où le visiteur vient.
 *
 * La liste blanche est une **forme**, pas une énumération de chemins — la même
 * que `safeRedirectPath` du module `auth` (`docs/security.md` §4). Est accepté
 * ce qui reste sur ce site : un chemin absolu d'une seule barre oblique. Les
 * trois écritures qui sortent du site sans en avoir l'air — l'URL absolue,
 * l'URL protocole-relative (`//evil.test`) et la barre oblique inversée, que
 * les navigateurs normalisent en `/` — retombent sur le repli.
 *
 * La fonction ne peut pas importer celle du module `auth` : `consent` ne
 * déclare aucun requis, et une clé étrangère comme un import inter-modules
 * demanderait de le déclarer (ADR 018). Douze lignes en double valent mieux
 * qu'un couplage que la story a écarté.
 */
export function safeReturnPath(referer: string | null | undefined, fallback: string): string {
  if (typeof referer !== 'string' || referer === '') {
    return fallback
  }

  const candidate = URL.canParse(referer)
    ? `${new URL(referer).pathname}${new URL(referer).search}`
    : referer

  const normalized = candidate.replaceAll('\\', '/')

  if (!normalized.startsWith('/') || normalized.startsWith('//')) {
    return fallback
  }

  return normalized
}
