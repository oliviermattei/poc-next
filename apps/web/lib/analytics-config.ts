import type { Env } from '@repo/config'
import { createPostHogAnalytics } from '@repo/adapter-posthog'
import { createSentryMonitoring } from '@repo/adapter-sentry'
import type {
  Analytics,
  AnalyticsLogger,
  AnalyticsResult,
  Monitoring,
  MonitoringLogger,
} from '@repo/ports'

/**
 * **La règle qui décide de l'analytique**, isolée de ce qui la monte — la même
 * forme que `lib/storage-config.ts` et `lib/mailer-config.ts`, et pour la même
 * raison : elle se prouve sans manipuler l'environnement du processus de test.
 *
 * **Le critère 5 de s39 vit ici** : « sans clé configurée, l'application
 * fonctionne normalement et **aucun appel réseau d'analyse n'est émis** ». Il
 * n'est pas tenu par un `if` posé chez l'appelant — un appelant qui l'oublie
 * émettrait —, il est tenu par le fait que **sans configuration, aucun
 * adaptateur n'est construit** : il n'y a alors rien dans le processus qui sache
 * appeler un fournisseur. C'est ce que `tests/analytics.test.ts` mesure sur les
 * appels sortants, avec son plancher.
 *
 * **Ce n'est pas un mode local, et la différence compte.** Le mailer, le
 * stockage, le paiement et les tâches ont chacun un mode local *explicite*
 * (`EMAIL_LOCAL_CAPTURE=1` et ses pareils), parce qu'ils rendent un service dont
 * le développeur a besoin hors ligne. L'analytique, elle, n'a rien à rendre :
 * l'absence de clé n'est pas un repli à opter, c'est l'état livré du
 * boilerplate. Ajouter un drapeau ne ferait qu'inventer une seconde manière de
 * ne rien envoyer.
 */

export interface AnalyticsSettings {
  readonly key: string
  readonly host: string
}

/**
 * Une variable **déclarée vide vaut absente**, ici comme dans `parseEnv`.
 *
 * `getEnv` rend la source telle quelle en phase de build et sous
 * `SKIP_ENV_VALIDATION` : sans cette normalisation, le `POSTHOG_KEY=` vide que
 * livre `.env.example` s'y lirait « clé renseignée » et l'application émettrait
 * vers un fournisseur avec une clé vide (constat G2 de la revue de s06,
 * transposé).
 */
const declared = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim()

  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

/**
 * La configuration, ou `null`.
 *
 * `POSTHOG_HOST` est **obligatoire dès que la clé est là**, et jamais devinée :
 * le fournisseur a plusieurs régions, et deviner enverrait des données
 * personnelles européennes vers un autre continent sans que personne l'ait
 * écrit. L'absence des deux ensemble est validée par le schéma d'environnement,
 * qui nomme la variable manquante au démarrage.
 */
export function resolveAnalyticsConfig(env: Env): AnalyticsSettings | null {
  const key = declared(env.POSTHOG_KEY)
  const host = declared(env.POSTHOG_HOST)

  return key === undefined || host === undefined ? null : { key, host }
}

export interface AnalyticsOverrides {
  readonly fetch?: typeof fetch
  readonly log?: AnalyticsLogger
}

/**
 * **Le port inerte** : il rend une valeur, il n'appelle personne.
 *
 * `not_configured` plutôt qu'un `ok: true` silencieux — un succès simulé
 * rendrait indiscernables « le fournisseur a reçu » et « personne n'a rien
 * reçu », production comprise. C'est la règle que le socle applique aux modes
 * locaux, appliquée à l'absence de mode.
 */
const inert = (log?: AnalyticsLogger): Analytics => {
  const drop = async (name: string): Promise<AnalyticsResult> => {
    log?.({ event: 'analytics.dropped', name, code: 'not_configured', message: null, redacted: [] })

    return { ok: false, error: { code: 'not_configured', message: 'aucune clé configurée' } }
  }

  return {
    track: async (event) => await drop(event.name),
    page: async () => await drop('$pageview'),
  }
}

/**
 * Le port, monté sur la configuration — **jamais sur `NODE_ENV`**.
 *
 * `settings === null` ne construit pas l'adaptateur : ce n'est pas une garde
 * qu'on peut oublier de poser plus loin, c'est une absence.
 */
export function createAnalytics(
  settings: AnalyticsSettings | null,
  overrides: AnalyticsOverrides = {},
): Analytics {
  if (settings === null) {
    return inert(overrides.log)
  }

  return createPostHogAnalytics({
    apiKey: settings.key,
    host: settings.host,
    log: overrides.log,
    fetch: overrides.fetch,
  })
}

/**
 * **La règle qui décide du monitoring**, du même modèle et pour la même raison.
 *
 * Absent, le port est inerte : aucune erreur n'est remontée, aucun appel n'est
 * émis, et l'application tourne. Le journal du processus reste le journal —
 * cette story ne remonte pas ce que le socle journalise déjà.
 */
export interface MonitoringSettings {
  readonly dsn: string
  readonly release: string | null
}

export function resolveMonitoringConfig(env: Env): MonitoringSettings | null {
  const dsn = declared(env.SENTRY_DSN)

  return dsn === undefined ? null : { dsn, release: declared(env.SENTRY_RELEASE) ?? null }
}

export interface MonitoringOverrides {
  readonly fetch?: typeof fetch
  readonly log?: MonitoringLogger
}

/**
 * **Le port inerte**, symétrique de celui de l'analytique.
 *
 * Il ne lève pas et n'appelle personne : il est le plus souvent invoqué depuis
 * un gestionnaire d'erreur, où lever remplacerait l'erreur d'origine par la
 * nôtre — et où un appel réseau non voulu doublerait la panne.
 */
const inertMonitoring = (log?: MonitoringLogger): Monitoring => ({
  capture: async (event) => {
    log?.({
      event: 'monitoring.dropped',
      origin: event.origin,
      type: event.type,
      code: 'not_configured',
      message: null,
      redacted: [],
    })

    return { ok: false, error: { code: 'not_configured', message: 'aucun DSN configuré' } }
  },
})

export function createMonitoring(
  settings: MonitoringSettings | null,
  overrides: MonitoringOverrides = {},
): Monitoring {
  if (settings === null) {
    return inertMonitoring(overrides.log)
  }

  const port = createSentryMonitoring({
    dsn: settings.dsn,
    log: overrides.log,
    fetch: overrides.fetch,
  })

  /**
   * **La version déployée est posée ici, une fois**, et pas à chaque appelant.
   *
   * C'est elle qui permet au fournisseur de retrouver les cartes source de ce
   * build-là : un événement sans version arrive **minifié**, quelles que soient
   * les cartes envoyées au build. Deux appelants — le crochet serveur et la
   * route du navigateur — l'oublieraient chacun de leur côté ; ils ne peuvent
   * plus, la valeur de l'appelant n'étant lue que si la configuration n'en donne
   * aucune.
   */
  return {
    capture: async (event) =>
      await port.capture(settings.release === null ? event : { ...event, release: settings.release }),
  }
}

export class AnalyticsNotServableError extends Error {
  constructor(host: string, directives: readonly string[]) {
    super(
      `L’analytique est configurée sur ${host}, mais cette origine n’est déclarée ` +
        `ni dans ${directives.join(', ')} de config/security.ts. Le navigateur ` +
        'bloquerait les appels du script et la mesure disparaîtrait sans un mot. ' +
        'Déclarer l’origine, ou retirer POSTHOG_KEY.',
    )
    this.name = 'AnalyticsNotServableError'
  }
}

/**
 * **La garde de démarrage** : une clé configurée dont l'origine n'est pas
 * déclarée à la politique de sécurité du contenu **refuse**, en nommant les
 * directives manquantes.
 *
 * Elle existe pour la raison exacte que `config/security.ts` écrit à propos du
 * captcha : « l'oublier ne casse pas le formulaire en silence — le démarrage
 * refuse ». Ici le silence serait pire, parce qu'il ne se voit nulle part : le
 * script serait chargé (le **nonce** l'autorise, `'strict-dynamic'` faisant
 * ignorer les sources d'hôte à `script-src`), puis chacun de ses appels réseau
 * serait bloqué. Le produit aurait l'air de mesurer et ne mesurerait rien.
 *
 * Deux directives, et il faut les deux : `connect-src` pour l'appel de capture,
 * `img-src` parce que le fournisseur retombe sur un pixel quand `fetch` et
 * `sendBeacon` échouent. Elles sont **passées en argument** — cette fonction ne
 * lit ni `config/security.ts`, ni l'environnement.
 */
export function assertAnalyticsIsReachable(
  settings: AnalyticsSettings | null,
  sources: { readonly connect: readonly string[]; readonly img: readonly string[] },
): void {
  if (settings === null) {
    return
  }

  const missing = [
    ...(sources.connect.includes(settings.host) ? [] : ['connect-src']),
    ...(sources.img.includes(settings.host) ? [] : ['img-src']),
  ]

  if (missing.length > 0) {
    throw new AnalyticsNotServableError(settings.host, missing)
  }
}
