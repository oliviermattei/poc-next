import { z } from 'zod'

/**
 * Contrat d'environnement de l'application.
 *
 * Le schéma est déclaré littéralement — jamais construit dynamiquement — afin
 * que ses clés restent énumérables : le test d'alignement de `.env.example`
 * en dépend.
 */
/**
 * Expéditeur des emails transactionnels : `adresse` ou `Nom <adresse>`.
 *
 * Vérifié ici plutôt qu'à l'envoi : un expéditeur malformé n'échoue qu'au
 * premier email, c'est-à-dire en production, sur un parcours d'inscription.
 */
const EMAIL_FROM_PATTERN = /^(?:[^\s<>@]+@[^\s<>@]+\.[A-Za-z]{2,}|.+<[^\s<>@]+@[^\s<>@]+\.[A-Za-z]{2,}>)$/

/**
 * Les clés du contrat, déclarées littéralement.
 *
 * Extraites dans une constante — et non écrites en ligne dans `z.object` —
 * pour que `ENV_KEYS` reste énumérable une fois la règle croisée posée sur le
 * schéma : `superRefine` rend un schéma qui n'a plus de `shape`.
 */
/**
 * La valeur qui active la capture locale — une seule, littérale.
 *
 * `'1'` comme `SKIP_ENV_VALIDATION` : accepter `true`, `yes` ou `on` multiplie
 * les orthographes d'un même choix, et la faute de frappe devient un envoi réel.
 */
export const EMAIL_LOCAL_CAPTURE_ENABLED = '1'

/**
 * La valeur qui monte la sonde de traduction manquante — même littéral, même
 * raison que ci-dessus.
 */
export const I18N_MISSING_KEY_PROBE_ENABLED = '1'

/**
 * La valeur qui monte le **fournisseur OAuth de développement** — même
 * littéral, même raison : une seule orthographe pour un seul choix.
 */
export const OAUTH_LOCAL_PROVIDER_ENABLED = '1'

const envShape = {
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((value) => /^postgres(ql)?:\/\/.+/.test(value), {
      message: 'must be a PostgreSQL connection string (postgres://…)',
    }),
  /**
   * Clé du fournisseur d'emails (Resend), **optionnelle** ici.
   *
   * Optionnelle parce que tout processus ne monte pas un mailer. Ce qui en
   * monte un exige l'une des deux configurations — la clé, ou la capture
   * locale explicite — et refuse de démarrer sans elle
   * (`apps/web/lib/mailer-config.ts`). Le choix se fait toujours sur cette
   * configuration, jamais sur `NODE_ENV`.
   */
  RESEND_API_KEY: z.string().min(1).optional(),
  /**
   * Active la **capture locale** des emails : ils sont rendus et écrits dans
   * `.mail/` au lieu de partir. Opt-in explicite, jamais déduit de `NODE_ENV`
   * ni de l'absence de clé.
   *
   * `docs/reliability.md` §2 autorise la capture « en développement local ».
   * L'étendre à tout déploiement dépourvu de clé rendrait `{ok:true}` sur un
   * email que personne ne recevra — indiscernable d'un envoi réussi. Le mailer
   * se choisit donc toujours sur la configuration, mais il faut avoir dit
   * laquelle : sans clé et sans ce drapeau, l'application qui monte un mailer
   * refuse de démarrer.
   */
  EMAIL_LOCAL_CAPTURE: z.literal(EMAIL_LOCAL_CAPTURE_ENABLED).optional(),
  /**
   * Monte la **sonde de traduction manquante** (`GET /api/i18n-probe`), qui
   * demande une clé qu'aucun catalogue ne livre.
   *
   * Elle existe parce qu'un critère de s09 — « une clé manquante n'est jamais
   * remplacée par elle-même » — se prouve au bout de la chaîne ou pas du tout :
   * la revue a mesuré qu'un test de nœud sur la configuration reste vert quand
   * `apps/web/i18n/request.ts` cesse de la brancher. La sonde fait échouer la
   * requête, dans le vrai serveur, et `e2e/i18n.spec.ts` l'exige.
   *
   * Opt-in explicite, comme la capture locale : sans ce drapeau la route répond
   * 404, donc rien n'est exposé en production. Elle n'est activée que par
   * `playwright.config.ts`.
   */
  I18N_MISSING_KEY_PROBE: z.literal(I18N_MISSING_KEY_PROBE_ENABLED).optional(),
  /**
   * Secret de signature des sessions et des jetons d'authentification.
   *
   * **Optionnelle ici, obligatoire pour qui monte l'authentification** — même
   * raison que `RESEND_API_KEY` : `pnpm db:migrate` ne signe aucun cookie et
   * doit s'exécuter avec le seul `DATABASE_URL` (revue de s06, G3).
   * L'exigence est portée par `apps/web/lib/auth-config.ts`, appliquée au
   * démarrage par `apps/web/next.config.ts`.
   *
   * 32 caractères au minimum : c'est la longueur en dessous de laquelle une clé
   * HMAC cesse d'être hors de portée d'une recherche exhaustive.
   */
  AUTH_SECRET: z.string().min(32).optional(),
  /**
   * URL publique de l'application.
   *
   * Elle n'est pas décorative : c'est elle qui construit les liens envoyés par
   * email et qui borne les origines de confiance. La **déduire** de l'en-tête
   * `Host` de la requête, comme le proposent la plupart des bibliothèques,
   * laisse un attaquant faire pointer un lien de réinitialisation vers son
   * propre domaine (`docs/security.md` §4 : aucune redirection pilotée par un
   * paramètre non validé).
   */
  APP_URL: z
    .string()
    .min(1)
    .refine((value) => URL.canParse(value) && /^https?:$/.test(new URL(value).protocol), {
      message: 'must be an absolute http(s) URL (https://app.example.com)',
    })
    .optional(),
  /**
   * Identifiants des fournisseurs OAuth (s12), **optionnels par paire**.
   *
   * Optionnels parce qu'un projet peut ne proposer aucune connexion externe :
   * les boutons disparaissent alors, et l'application fonctionne
   * (`docs/reliability.md` §2). Ce qui n'est pas optionnel, c'est la
   * **cohérence** : un identifiant sans son secret est refusé par la règle
   * croisée ci-dessous, parce que la bibliothèque, elle, se contenterait d'un
   * avertissement dans le journal et n'échouerait qu'au premier clic.
   */
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  GITHUB_CLIENT_ID: z.string().min(1).optional(),
  GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
  /**
   * Monte le **fournisseur OAuth de développement**, sans aucune clé.
   *
   * Opt-in explicite, comme la capture locale des emails, et jamais déduit de
   * `NODE_ENV` : il ouvre toujours la même adresse de test, et il porte son
   * propre identifiant — il n'emprunte l'identité d'aucun fournisseur réel.
   * Posé en même temps qu'une clé, il est refusé : le choix serait implicite.
   *
   * Il ouvre une session **sans mot de passe** à qui clique sur le bouton :
   * `apps/web/lib/oauth-config.ts` le refuse donc aussi sous
   * `NODE_ENV=production`, au démarrage et en nommant la variable. `NODE_ENV`
   * ne l'active jamais — il ne fait que restreindre l'opt-in.
   */
  OAUTH_LOCAL_PROVIDER: z.literal(OAUTH_LOCAL_PROVIDER_ENABLED).optional(),
  /**
   * Le seau de fichiers (s18) : S3, ou toute API compatible — R2, MinIO,
   * Spaces. **Optionnelles par groupe**, comme les paires OAuth.
   *
   * Optionnelles parce que tout processus ne monte pas un stockage, et parce
   * qu'un projet peut couper le module `storage` : le schéma juge la **forme**
   * des variables, il n'impose de stockage à personne. L'exigence « il faut un
   * stockage » est portée par `apps/web/lib/storage-config.ts`, et seulement
   * quand le module est activé.
   *
   * Ce qui n'est pas optionnel, c'est la **cohérence** : un seau sans région ni
   * identifiants n'échouerait qu'au premier téléversement, en production. La
   * règle croisée ci-dessous nomme l'absente.
   */
  STORAGE_S3_BUCKET: z.string().min(1).optional(),
  STORAGE_S3_REGION: z.string().min(1).optional(),
  STORAGE_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  STORAGE_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  /**
   * Point de terminaison du seau. Absent pour AWS, renseigné pour R2, MinIO ou
   * Spaces. Seul du groupe à rester facultatif quand les quatre autres sont là.
   */
  STORAGE_S3_ENDPOINT: z
    .string()
    .min(1)
    .refine((value) => URL.canParse(value) && /^https?:$/.test(new URL(value).protocol), {
      message: 'must be an absolute http(s) URL (https://accountid.r2.cloudflarestorage.com)',
    })
    .optional(),
  /**
   * Monte le **stockage sur disque**, sans aucune clé : les fichiers sont
   * écrits dans ce dossier, et l'URL présignée reste sur notre propre origine.
   *
   * Opt-in explicite, comme `EMAIL_LOCAL_CAPTURE` et `OAUTH_LOCAL_PROVIDER`, et
   * jamais déduit de `NODE_ENV` ni de l'absence de seau : un repli automatique
   * ferait écrire sur le disque d'un déploiement en rendant un succès que rien
   * ne distingue d'un vrai stockage (`docs/reliability.md` §2). Posé en même
   * temps qu'un seau, il est refusé : le choix serait implicite.
   *
   * C'est un **chemin**, pas un drapeau à `1` : le dossier est injecté, comme
   * celui de la capture d'emails, et il n'est jamais deviné.
   */
  STORAGE_LOCAL_DIRECTORY: z.string().min(1).optional(),
  /** Expéditeur. Obligatoire dès qu'une clé est configurée : voir la règle croisée. */
  EMAIL_FROM: z
    .string()
    .min(1)
    .refine((value) => EMAIL_FROM_PATTERN.test(value), {
      message: 'must be an email address, optionally named (Name <user@example.com>)',
    })
    .optional(),
} as const

export const envSchema = z.object(envShape).superRefine((value, ctx) => {
  const captureEnabled = value.EMAIL_LOCAL_CAPTURE === EMAIL_LOCAL_CAPTURE_ENABLED

  // Règle croisée : une clé sans expéditeur part avec un `from` vide, et
  // l'échec n'apparaît qu'au premier email refusé par le fournisseur.
  if (value.RESEND_API_KEY !== undefined && value.EMAIL_FROM === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['EMAIL_FROM'],
      message: 'is required when RESEND_API_KEY is set',
    })
  }

  // Ce schéma ne dit **pas** qu'il faut un mailer : il juge la forme des
  // variables, pour tout processus qui lit cet environnement. `pnpm db:migrate`
  // n'envoie aucun email et doit s'exécuter avec le seul `DATABASE_URL` (revue
  // de s06, G3). L'exigence « il faut un mailer » appartient à ce qui en monte
  // un : `apps/web/lib/mailer-config.ts`, appliquée au démarrage de
  // l'application par `apps/web/next.config.ts`.

  // Les deux à la fois : le choix du mailer deviendrait implicite, et un
  // déploiement muni d'une clé pourrait taire ses emails sans que rien ne le
  // dise.
  if (value.RESEND_API_KEY !== undefined && captureEnabled) {
    ctx.addIssue({
      code: 'custom',
      path: ['EMAIL_LOCAL_CAPTURE'],
      message: 'cannot be enabled while RESEND_API_KEY is set: choose one',
    })
  }

  // Les fournisseurs OAuth : chaque identifiant va avec son secret, et
  // l'absente est **nommée**. La bibliothèque n'échouerait qu'au premier clic,
  // en production, sur un journal que personne ne lit.
  const oauthPairs = [
    { id: 'GOOGLE_CLIENT_ID', secret: 'GOOGLE_CLIENT_SECRET' },
    { id: 'GITHUB_CLIENT_ID', secret: 'GITHUB_CLIENT_SECRET' },
  ] as const

  let anyOAuthKey = false

  for (const pair of oauthPairs) {
    const id = value[pair.id]
    const secret = value[pair.secret]

    anyOAuthKey = anyOAuthKey || id !== undefined || secret !== undefined

    if (id !== undefined && secret === undefined) {
      ctx.addIssue({ code: 'custom', path: [pair.secret], message: `is required when ${pair.id} is set` })
    }

    if (secret !== undefined && id === undefined) {
      ctx.addIssue({ code: 'custom', path: [pair.id], message: `is required when ${pair.secret} is set` })
    }
  }

  // Même règle que la capture locale des emails : le mode local est un choix,
  // pas un repli. Les deux à la fois, et plus personne ne sait si le bouton
  // parle au vrai fournisseur.
  if (anyOAuthKey && value.OAUTH_LOCAL_PROVIDER === OAUTH_LOCAL_PROVIDER_ENABLED) {
    ctx.addIssue({
      code: 'custom',
      path: ['OAUTH_LOCAL_PROVIDER'],
      message: 'cannot be enabled while a provider client id or secret is set: choose one',
    })
  }

  // Le seau de fichiers (s18) : les quatre variables vont ensemble, et
  // l'absente est **nommée**. Un seau sans identifiants n'échouerait qu'au
  // premier téléversement, en production, sur un journal que personne ne lit.
  // `STORAGE_S3_ENDPOINT` n'en fait pas partie : il est absent chez AWS.
  const s3Keys = [
    'STORAGE_S3_BUCKET',
    'STORAGE_S3_REGION',
    'STORAGE_S3_ACCESS_KEY_ID',
    'STORAGE_S3_SECRET_ACCESS_KEY',
  ] as const

  const declaredS3 = s3Keys.filter((key) => value[key] !== undefined)

  if (declaredS3.length > 0) {
    for (const key of s3Keys) {
      if (value[key] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `is required when ${declaredS3[0]} is set`,
        })
      }
    }
  }

  // Même règle que la capture locale des emails et que le fournisseur OAuth de
  // développement : le mode local est un **choix**, pas un repli. Les deux à la
  // fois, et plus personne ne sait si un téléversement atteint le seau.
  if (declaredS3.length > 0 && value.STORAGE_LOCAL_DIRECTORY !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['STORAGE_LOCAL_DIRECTORY'],
      message: 'cannot be set while an S3 bucket is configured: choose one',
    })
  }
})

export type Env = z.infer<typeof envSchema>

export type EnvSource = Record<string, string | undefined>

/** Clés lues par l'application, dans l'ordre de déclaration du schéma. */
export const ENV_KEYS = Object.keys(envShape) as (keyof Env)[]

export class EnvValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EnvValidationError'
  }
}

/**
 * Valide une source d'environnement. Lève une `EnvValidationError` dont le
 * message nomme chaque variable fautive.
 */
/**
 * Une variable **déclarée vide vaut absente**.
 *
 * `dotenv` charge `CLE=` en chaîne vide, et c'est la forme naturelle d'une
 * variable optionnelle dans `.env.example` : on la déclare, on la documente, on
 * la laisse vide. Sans cette normalisation, `optional()` — qui n'accepte que
 * `undefined` — refuse la chaîne vide, et copier `.env.example` en `.env`
 * empêche l'application de démarrer sur une variable annoncée optionnelle.
 *
 * Normalisé **à la source** plutôt que clé par clé : la prochaine variable
 * optionnelle hériterait sinon du même défaut, et le seul test qui l'attrape
 * (`tests/env-example.test.ts`) ne le dirait qu'après coup.
 */
const withoutBlanks = (source: EnvSource): EnvSource =>
  Object.fromEntries(
    Object.entries(source).filter(([, value]) => value === undefined || value.trim() !== ''),
  )

export function parseEnv(source: EnvSource): Env {
  const result = envSchema.safeParse(withoutBlanks(source))

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')

    throw new EnvValidationError(`Invalid environment variables:\n${details}`)
  }

  return result.data
}

/**
 * Variables qui désactivent la validation, et la valeur qui les déclenche.
 *
 * Elles ne sont pas dans le schéma : elles ne sont pas posées par le
 * développeur mais par l'outillage (`NEXT_PHASE` par `next build`) ou à la main
 * pour un build hors ligne (`SKIP_ENV_VALIDATION`). Elles sont malgré tout lues
 * par ce module, donc énumérées ici et documentées dans `.env.example`.
 */
const BUILD_PHASE_TRIGGERS = {
  NEXT_PHASE: 'phase-production-build',
  SKIP_ENV_VALIDATION: '1',
} as const

/** Clés lues par la garde de build, dérivées des déclencheurs ci-dessus. */
export const BUILD_ENV_KEYS = Object.keys(BUILD_PHASE_TRIGGERS) as (keyof typeof BUILD_PHASE_TRIGGERS)[]

/**
 * Le build de Next s'exécute sans les secrets d'exécution : y valider
 * l'environnement ferait échouer `next build` en CI comme en conteneur.
 */
export function isBuildPhase(source: EnvSource): boolean {
  return BUILD_ENV_KEYS.some((key) => source[key] === BUILD_PHASE_TRIGGERS[key])
}

/**
 * Phase que Next transmet à `next.config.ts` pendant `next build`. Elle arrive
 * en argument, alors que `NEXT_PHASE` n'est posée dans l'environnement que plus
 * tard dans le build : à la lecture de la configuration, l'argument est le seul
 * signal disponible.
 */
export const NEXT_BUILD_PHASE = BUILD_PHASE_TRIGGERS.NEXT_PHASE

export interface AssertStartupEnvOptions {
  /** Phase transmise par Next. Absente hors de `next.config.ts`. */
  readonly phase?: string
  readonly source?: EnvSource
}

/**
 * Validation au démarrage du serveur : lève une `EnvValidationError` nommant
 * chaque variable fautive, avant que le processus ne serve la moindre requête.
 *
 * Une base éteinte n'est pas une erreur de configuration : seule la forme des
 * variables est jugée ici. Un `DATABASE_URL` bien formé mais injoignable laisse
 * le serveur démarrer, et `/api/health` répond 503.
 *
 * Le build est exempté : `next build` s'exécute sans les variables d'exécution,
 * en CI comme en conteneur.
 *
 * Deux frontières connues, mesurées en revue de s01 (N15, N16) :
 * - la garde ne couvre que le **démarrage auto-hébergé**. En serverless (Vercel)
 *   comme en `output: 'standalone'`, `next.config.ts` n'est pas exécuté à la
 *   requête : une variable malformée s'y déploie sans bruit et dégrade en 503
 *   silencieux. La sonde `/api/health` reste alors le seul signal ;
 * - `next info` charge la configuration avec sa propre phase, non exemptée : la
 *   commande de diagnostic s'interrompt précisément quand l'environnement est
 *   cassé. Contournement : `SKIP_ENV_VALIDATION=1 next info`.
 *
 * Rend l'environnement **validé**, ou `undefined` quand la validation a été
 * sautée. Ce qui doit être vérifié au démarrage en plus du schéma — le choix du
 * mailer, que seule l'application qui en monte un exige — se greffe sur ce
 * retour et hérite ainsi des mêmes échappatoires, sans les redéclarer.
 */
export function assertStartupEnv(options: AssertStartupEnvOptions = {}): Env | undefined {
  if (options.phase === NEXT_BUILD_PHASE) {
    return undefined
  }

  const source = options.source ?? process.env
  const env = getEnv(source)

  // `getEnv` rend la source telle quelle, sans rien vérifier, en phase de build
  // et sous `SKIP_ENV_VALIDATION` : ne la rendre que lorsqu'elle a réellement
  // été validée évite qu'un appelant ne décide sur des valeurs non vérifiées.
  return isBuildPhase(source) ? undefined : env
}

/**
 * Le **mode d'exécution seul**, sans juger le reste de l'environnement.
 *
 * `getEnv` valide tout le contrat et lève si `DATABASE_URL` manque : c'est ce
 * qu'on veut au démarrage, et exactement ce qu'on ne veut pas dans un proxy
 * appelé à chaque requête pour construire une politique de sécurité du contenu.
 * Cet accesseur reste malgré tout **dans le module de configuration** : le socle
 * (`docs/security.md` §5) interdit de lire `process.env` ailleurs, et une
 * exception de commodité pour une seule variable en aurait ouvert d'autres.
 *
 * Une valeur inconnue vaut `development`, comme le défaut du schéma. **Ce repli
 * est le plus permissif des deux** — c'est le mode `production` qui interdit
 * `'unsafe-eval'` et `'unsafe-inline'` —, et ce n'est donc pas lui qui protège :
 * ce qui protège est la validation au démarrage. Un `NODE_ENV=prod` mal
 * orthographié n'obtient pas la politique de développement, il obtient un
 * processus qui refuse de démarrer en nommant la variable (`parseEnv`, appelé
 * par `assertStartupEnv` depuis `apps/web/next.config.ts`). Ce repli-ci ne sert
 * que les appelants qui lisent le mode **sans** exiger le reste du contrat.
 */
export function getNodeEnv(source: EnvSource = process.env): Env['NODE_ENV'] {
  const parsed = envShape.NODE_ENV.safeParse(source.NODE_ENV ?? undefined)

  return parsed.success ? parsed.data : 'development'
}

/**
 * Point d'accès unique à l'environnement. Aucun autre module du dépôt ne lit
 * `process.env` directement.
 *
 * En phase de build, l'environnement est renvoyé tel quel, sans validation :
 * les variables d'exécution peuvent alors manquer. Ce qui les consomme doit
 * donc refuser explicitement une valeur absente plutôt que se rabattre sur un
 * défaut — c'est ce que fait `createDatabaseClient`.
 */
export function getEnv(source: EnvSource = process.env): Env {
  if (source.SKIP_ENV_VALIDATION === BUILD_PHASE_TRIGGERS.SKIP_ENV_VALIDATION) {
    console.warn(
      'SKIP_ENV_VALIDATION=1 : validation de l’environnement désactivée. ' +
        'Les variables ne sont ni vérifiées ni complétées — réservé au build.',
    )

    return source as unknown as Env
  }

  if (isBuildPhase(source)) {
    return source as unknown as Env
  }

  return parseEnv(source)
}
