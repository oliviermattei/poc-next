import type { Env } from '@repo/config'

import { contentSecurityPolicySources } from '../../../config/security'

/**
 * **La règle qui décide du stockage**, isolée de ce qui le construit — la même
 * forme que `lib/mailer-config.ts` et `lib/auth-config.ts`, et pour la même
 * raison : elle est réappliquée au **démarrage** par `next.config.ts`, sans que
 * la configuration de Next ait à charger le SDK d'AWS pour poser une question à
 * cinq variables.
 *
 * **Une différence avec le mailer, et elle est structurante** : le mailer est
 * exigé de toute application qui démarre, le stockage seulement quand le module
 * `storage` est activé. C'est le critère 7 de la story — module coupé, aucune
 * route, aucune table, et l'avatar retombe sur les initiales **sans erreur**.
 * Un dépôt qui coupe le stockage n'a donc aucune variable à renseigner, et
 * l'appelant transmet ce qu'il sait de l'état du module.
 */

/**
 * Le dossier de stockage local **suggéré** par `.env.example`.
 *
 * Suggéré, et pas imposé : c'est `STORAGE_LOCAL_DIRECTORY` qui décide, et la
 * valeur n'est jamais devinée. Cette constante existe pour que le `.gitignore`,
 * l'exemple d'environnement et le parcours de test nomment le même dossier.
 */
export const LOCAL_STORAGE_DIRECTORY = '.storage'

export type StorageConfig =
  | {
      readonly kind: 's3'
      readonly bucket: string
      readonly region: string
      readonly accessKeyId: string
      readonly secretAccessKey: string
      readonly endpoint: string | undefined
    }
  | { readonly kind: 'local-disk'; readonly directory: string }

/**
 * Une variable **déclarée vide vaut absente**, ici comme dans `parseEnv`.
 *
 * `getEnv` rend la source telle quelle, sans validation ni normalisation, en
 * phase de build et sous `SKIP_ENV_VALIDATION` — les deux seuls chemins pour
 * lesquels cette garde existe. Sans cette normalisation, le
 * `STORAGE_S3_BUCKET=` vide que livre `.env.example` s'y lirait « seau
 * renseigné », et la branche fournisseur l'emporterait sur le stockage local
 * explicitement demandé. C'est le constat G2 de la revue de s06, transposé.
 */
const declared = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim()

  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

/**
 * L'origine vers laquelle **le navigateur** téléversera.
 *
 * C'est celle du point de terminaison quand il y en a un (R2, MinIO, Spaces),
 * et celle du service S3 de la région sinon — l'adapter impose le style
 * « chemin » (`forcePathStyle`), donc le nom du seau est dans le chemin et non
 * dans le domaine.
 *
 * Une URL de point de terminaison malformée est une erreur de configuration :
 * elle est nommée ici, au démarrage, plutôt qu'au premier téléversement.
 */
export function bucketOriginOf(config: {
  readonly region: string
  readonly endpoint: string | undefined
}): string {
  if (config.endpoint === undefined) {
    return `https://s3.${config.region}.amazonaws.com`
  }

  try {
    return new URL(config.endpoint).origin
  } catch {
    throw new Error(
      `STORAGE_S3_ENDPOINT n’est pas une URL absolue : « ${config.endpoint} ». ` +
        'Attendu une origine complète, par exemple https://<compte>.r2.cloudflarestorage.com.',
    )
  }
}

/** Une origine se compare sans barre oblique finale ni casse. */
const normalizedOrigin = (value: string): string => value.trim().replace(/\/+$/, '').toLowerCase()

/**
 * Rend la configuration du stockage, ou lève en nommant les variables.
 *
 * Le stockage sur disque est un **opt-in, pas un repli** : en faire la
 * conséquence automatique d'un seau absent ferait écrire dans un dossier
 * temporaire de production en rendant un succès que rien ne distingue d'un vrai
 * stockage — c'est la faute que la revue de s06 a corrigée sur les emails (F3),
 * et elle serait ici encore plus silencieuse, puisqu'un avatar téléversé
 * s'afficherait bel et bien jusqu'au prochain redémarrage.
 *
 * **Deux refus de plus, posés par la revue de s18, et chacun ferme un échec
 * qu'aucune commande ne voyait :**
 *
 * 1. **un seau réel dont l'origine n'est pas déclarée dans `config/security.ts`,
 *    champ `connect`.** Le navigateur téléverse directement vers cette origine,
 *    et `connect-src 'self'` la refuse. Quatre variables renseignées passaient
 *    `pnpm dev`, `pnpm build` et la CI ; l'échec n'arrivait que chez le premier
 *    utilisateur, invisible côté serveur. Ce fichier **lit** `config/security.ts`
 *    et refuse de démarrer — il ne le modifie pas : ce fichier appartient à s45,
 *    et l'élargir « pour faire marcher » est ce que `docs/security.md` §1
 *    refuse ;
 * 2. **le stockage sur disque sous `NODE_ENV=production`.** Même arbitrage que
 *    `OAUTH_LOCAL_PROVIDER` (`lib/oauth-config.ts`) : le drapeau reste l'unique
 *    opt-in, `NODE_ENV` ne l'arme jamais, il le **restreint**. Un `.env`
 *    recopié d'un poste écrirait les avatars sur le disque éphémère d'une
 *    fonction serverless, et le symptôme — un avatar qui disparaît au
 *    redéploiement — arriverait longtemps après la cause.
 *
 * `declaredConnectSources` est un argument pour que la règle reste éprouvable
 * dans les deux sens ; sa valeur par défaut est **la vraie**, celle que le
 * propriétaire du projet édite.
 */
export function resolveStorageConfig(
  env: Env,
  declaredConnectSources: readonly string[] = contentSecurityPolicySources.connect,
): StorageConfig {
  const bucket = declared(env.STORAGE_S3_BUCKET)
  const region = declared(env.STORAGE_S3_REGION)
  const accessKeyId = declared(env.STORAGE_S3_ACCESS_KEY_ID)
  const secretAccessKey = declared(env.STORAGE_S3_SECRET_ACCESS_KEY)

  if (
    bucket !== undefined &&
    region !== undefined &&
    accessKeyId !== undefined &&
    secretAccessKey !== undefined
  ) {
    const endpoint = declared(env.STORAGE_S3_ENDPOINT)
    const origin = bucketOriginOf({ region, endpoint })

    if (!declaredConnectSources.map(normalizedOrigin).includes(normalizedOrigin(origin))) {
      throw new Error(
        `Le seau « ${bucket} » est configuré, mais son origine ${origin} n’est pas déclarée ` +
          'dans `config/security.ts`, champ `connect`. Le navigateur téléverse directement ' +
          'vers cette origine, et `connect-src \'self\'` refuse la requête — le téléversement ' +
          'échouerait chez l’utilisateur, sans trace côté serveur. Ajoutez-la à ' +
          '`contentSecurityPolicySources.connect`, ou revenez au stockage local ' +
          '(STORAGE_LOCAL_DIRECTORY).',
      )
    }

    return {
      kind: 's3',
      bucket,
      region,
      accessKeyId,
      secretAccessKey,
      endpoint,
    }
  }

  const directory = declared(env.STORAGE_LOCAL_DIRECTORY)

  if (directory !== undefined) {
    if (env.NODE_ENV === 'production') {
      throw new Error(
        'STORAGE_LOCAL_DIRECTORY est posé avec NODE_ENV=production : les avatars seraient ' +
          'écrits sur le disque du processus, qui disparaît au redéploiement — et rien ne le ' +
          'dirait, l’image s’affichant jusque-là. Retirez STORAGE_LOCAL_DIRECTORY de cet ' +
          'environnement, ou configurez un vrai seau (STORAGE_S3_BUCKET, STORAGE_S3_REGION, ' +
          'STORAGE_S3_ACCESS_KEY_ID, STORAGE_S3_SECRET_ACCESS_KEY).',
      )
    }

    return { kind: 'local-disk', directory }
  }

  throw new Error(
    'Module « storage » activé mais aucun stockage configuré : renseignez ' +
      'STORAGE_S3_BUCKET, STORAGE_S3_REGION, STORAGE_S3_ACCESS_KEY_ID et ' +
      'STORAGE_S3_SECRET_ACCESS_KEY (plus STORAGE_S3_ENDPOINT hors AWS) pour un seau réel, ' +
      `ou STORAGE_LOCAL_DIRECTORY=${LOCAL_STORAGE_DIRECTORY} pour écrire sur le disque sans ` +
      'aucune clé. Sinon, coupez le module : `pnpm ks toggle storage`.',
  )
}
