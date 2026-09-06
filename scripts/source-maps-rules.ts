/**
 * **Les règles de l'envoi des cartes source** (s39, critère 1), isolées de ce
 * qui les exécute — même forme que `scripts/minimal-profile-rules.ts` et
 * `scripts/socle-rules.ts` : elles se prouvent sans build, sans réseau et sans
 * jeton.
 *
 * Le critère demande une **trace lisible chez le fournisseur**. Trois choses le
 * composent, et les trois échouent séparément :
 *
 * 1. les cartes sont **générées** — `productionBrowserSourceMaps` dans
 *    `apps/web/next.config.ts` ;
 * 2. elles sont **envoyées**, sous le **même nom de version** que les
 *    événements (`SENTRY_RELEASE`). Une carte envoyée sous un autre nom n'est
 *    jamais retrouvée, et l'erreur arrive minifiée sans que rien ne le dise ;
 * 3. elles ne sont **pas servies publiquement**. C'est la moitié de sécurité :
 *    une carte est le code source, et `.next/static` est servi à qui le demande
 *    sous `/_next/static`. Générer sans élaguer *exposerait* le code serveur du
 *    produit — le contraire du but.
 */

/** Le préfixe sous lequel le fournisseur retrouve un artefact du bundle Next. */
export const ARTIFACT_PREFIX = '~/_next'

/**
 * **Le dossier servi publiquement**, et le seul.
 *
 * `.next/static` est monté sur `/_next/static` par le serveur autonome comme par
 * `next start` ; `.next/server` ne l'est jamais. La distinction n'est pas
 * cosmétique : elle décide de ce qui doit disparaître avant qu'une image ne
 * parte.
 */
export const PUBLIC_SEGMENT = 'static'

export class EmptyReleaseError extends Error {
  constructor(root: string) {
    super(
      `Aucune carte source trouvée sous ${root} : il n’y a rien à envoyer. ` +
        'Construire d’abord (`pnpm build`), et vérifier que ' +
        '`productionBrowserSourceMaps` est activé dans apps/web/next.config.ts. ' +
        'Un envoi qui n’envoie rien est un vert qui ne prouve rien.',
    )
    this.name = 'EmptyReleaseError'
  }
}

export interface SourceMapPlanEntry {
  /** Chemin de la carte, relatif à `.next`. */
  readonly path: string
  /** Nom sous lequel le fournisseur la retrouvera. */
  readonly artifact: string
  /** Servie au visiteur si elle reste là ? Alors elle doit être élaguée. */
  readonly publiclyServed: boolean
}

export interface SourceMapPlan {
  readonly uploads: readonly SourceMapPlanEntry[]
  /** Ce qui doit disparaître avant que le build ne soit servi ou empaqueté. */
  readonly prunes: readonly SourceMapPlanEntry[]
}

/**
 * Une carte est-elle servie au visiteur ?
 *
 * La question porte sur le **premier segment** — `static/chunks/…` est servi,
 * `server/app/…` ne l'est pas —, et jamais sur une sous-chaîne : un dossier
 * `server/static-pages/` serait sinon compté comme public, et une carte serveur
 * disparaîtrait de l'envoi sans que personne le voie.
 */
export const isPubliclyServed = (relativePath: string): boolean =>
  relativePath.split('/')[0] === PUBLIC_SEGMENT

/**
 * **Les deux seuls dossiers dont une carte concerne le produit servi.**
 *
 * `.next` en porte d'autres, et la revue les a comptés : 326 fichiers `.map`
 * sous `.next`, dont **25** sont des chunks navigateur. Le reste vient de
 * `.next/build` — l'outillage du bundler, qu'aucune trace du produit ne nomme —
 * et de `.next/standalone`, qui **recopie** la sortie : les mêmes cartes, sous
 * un autre chemin, envoyées une seconde fois sous des noms d'artefacts que le
 * fournisseur ne retrouvera jamais.
 *
 * Le filtrage est ici, et non dans le parcours du disque, pour la même raison
 * que le reste de ce fichier : il se prouve sans build.
 */
export const RELEASABLE_SEGMENTS = [PUBLIC_SEGMENT, 'server'] as const

export const isReleasableMap = (relativePath: string): boolean =>
  (RELEASABLE_SEGMENTS as readonly string[]).includes(relativePath.split('/')[0] ?? '')

/**
 * **Le plan**, dérivé des cartes réellement présentes.
 *
 * Il **refuse un ensemble vide**, et c'est le point de la story : le régime
 * `recorded` du parcours doré a montré qu'une recette qui n'a rien à jouer passe
 * au vert et fait croire à une garantie. Ici, « rien à envoyer » est une erreur
 * nommée, jamais un succès silencieux.
 */
export function planRelease(root: string, maps: readonly string[]): SourceMapPlan {
  const retained = maps.filter((path) => isReleasableMap(path))

  // **Après filtrage, et pas avant** : un `.next` qui ne porterait que
  // l'outillage du bundler n'a rien à envoyer non plus, et passer au vert
  // là-dessus serait exactement la faute que cette erreur existe pour empêcher.
  if (retained.length === 0) {
    throw new EmptyReleaseError(root)
  }

  const entries = retained.map((path) => ({
    path,
    artifact: `${ARTIFACT_PREFIX}/${path}`,
    publiclyServed: isPubliclyServed(path),
  }))

  return {
    // **Envoyées** : les cartes JavaScript, serveur et navigateur — c'est la
    // trace que le critère 1 demande lisible. Une carte CSS n'apparaît dans
    // aucune trace d'erreur ; l'envoyer ne ferait que peser.
    uploads: entries.filter((entry) => entry.path.endsWith('.js.map')),
    // **Élaguées** : tout ce qui serait servi, cartes CSS comprises — une carte
    // est du code source, quel qu'en soit le langage. Les cartes serveur
    // restent : elles ne sont jamais servies, et les retirer ôterait la seule
    // copie locale d'un diagnostic.
    prunes: entries.filter((entry) => entry.publiclyServed),
  }
}

/**
 * **Le dossier `.next` dont les cartes seront envoyées.**
 *
 * Par défaut celui du dépôt — le cas d'un déploiement construit sur l'hôte. Mais
 * l'image de production **rejoue son propre `pnpm build`** (`.dockerignore`
 * exclut `.next` du contexte) : ses empreintes de chunks ne sont pas celles de
 * l'hôte, et envoyer celles de l'hôte livre des traces non symbolisées sans que
 * rien ne le dise — le constat 7 de la revue de s39. La recette extrait donc
 * `.next` de l'étape `builder` de l'image et le désigne par cette variable.
 *
 * Une valeur vide vaut absente, ici comme partout ailleurs dans ce dépôt.
 */
export const resolveNextRoot = (
  source: Readonly<Record<string, string | undefined>>,
  fallback: string,
): string => {
  const declared = (source.SOURCEMAPS_NEXT_DIR ?? '').trim()

  return declared === '' ? fallback : declared
}

export interface ReleaseCredentials {
  readonly org: string
  readonly project: string
  readonly token: string
  readonly release: string
}

export class MissingReleaseCredentialsError extends Error {
  constructor(missing: readonly string[]) {
    super(
      `Envoi des cartes source impossible : ${missing.join(', ')} ${
        missing.length === 1 ? 'est absente' : 'sont absentes'
      }. ` +
        'Cette commande est un geste de déploiement : elle refuse plutôt que ' +
        'de sauter l’envoi en silence, ce qui livrerait des traces minifiées ' +
        'sans que rien ne le dise.',
    )
    this.name = 'MissingReleaseCredentialsError'
  }
}

/**
 * Les identifiants de l'envoi — **lus une fois, et refusés en nommant ce qui
 * manque**.
 *
 * `SENTRY_AUTH_TOKEN` n'entre **pas** dans le schéma d'environnement de
 * l'application : elle ne le lit jamais, et une variable dans le schéma est une
 * variable que `.env.example` doit documenter comme si l'application en avait
 * besoin. C'est de l'outillage, comme `GOLDEN_PATH_PAYMENTS` et
 * `INNGEST_LIVE_TEST`.
 */
export function readReleaseCredentials(
  source: Readonly<Record<string, string | undefined>>,
): ReleaseCredentials {
  const required = ['SENTRY_ORG', 'SENTRY_PROJECT', 'SENTRY_AUTH_TOKEN', 'SENTRY_RELEASE'] as const
  const missing = required.filter((key) => (source[key] ?? '').trim() === '')

  if (missing.length > 0) {
    throw new MissingReleaseCredentialsError(missing)
  }

  return {
    org: (source.SENTRY_ORG ?? '').trim(),
    project: (source.SENTRY_PROJECT ?? '').trim(),
    token: (source.SENTRY_AUTH_TOKEN ?? '').trim(),
    release: (source.SENTRY_RELEASE ?? '').trim(),
  }
}

/** L'URL de dépôt d'un artefact de version, telle que le fournisseur la documente. */
export const releaseFilesUrl = (credentials: ReleaseCredentials, host: string): string =>
  `${host.replace(/\/$/, '')}/api/0/projects/${credentials.org}/${credentials.project}` +
  `/releases/${encodeURIComponent(credentials.release)}/files/`
