import { join } from 'node:path'

import { createS3Storage } from '@repo/adapter-s3'
import { getEnv } from '@repo/config'
import { getDatabase } from '@repo/db'
import {
  AVATAR_CONTENT_TYPES,
  fileUrl,
  provideStorage,
  requireStorageService,
  storageModule,
  storageRoutePath,
  type AvatarView,
  type FileOwner,
} from '@repo/module-storage'
import type { Storage, StorageLogRecord, StorageLogger } from '@repo/ports'
import { createLocalDiskStorage } from '@repo/storage-testing'

import { moduleRegistry } from './module-registry'
import { organizations } from './organizations'
import { resolveStorageConfig } from './storage-config'

/**
 * Le point de composition du stockage — le sixième du même modèle, après le
 * mailer, l'authentification, l'i18n, le site public et les organisations.
 *
 * C'est **le seul fichier de l'application** qui connaisse `@repo/adapter-s3`,
 * `@repo/storage-testing` et `@repo/module-storage`. Ailleurs — le shell,
 * l'écran de compte — on lit `storage`, dont la **forme est la même dans les
 * deux états** : un drapeau `available`, un avatar qui vaut `null`. C'est ce
 * qui empêche un `if (le stockage existe)` de se disséminer.
 *
 * | | module activé | module coupé |
 * |---|---|---|
 * | routes de téléversement | montées | **aucune** (404) |
 * | table `storage_file` | créée | absente d'une base vierge |
 * | `avatarOf(session)` | l'avatar, ou `null` | **toujours** `null` |
 * | requêtes en base | celles de l'écran | **aucune** |
 *
 * **Le choix se fait sur la configuration, jamais sur `NODE_ENV`.** Un stockage
 * conditionné par l'environnement est intestable et se trompera un jour
 * d'environnement — en écrivant sur le disque d'une fonction serverless, où le
 * fichier disparaît au redémarrage sans que rien ne le dise.
 */

export { LOCAL_STORAGE_DIRECTORY } from './storage-config'

/**
 * Le **budget d'attente** de l'appelant, choisi ici et pas subi.
 *
 * Aux défauts de l'adapter (10 s de délai, 3 essais), un fournisseur muet ferait
 * attendre ~31 s avant de rendre un échec : au-delà du plafond usuel d'une
 * fonction serverless, la plateforme coupe la requête et il ne reste ni réponse
 * ni journal. Deux essais de 4 s, recul compris, tiennent sous 10 s. Même
 * arbitrage que celui du mailer, pour la même raison.
 */
const APP_STORAGE_TIMEOUT_MS = 4_000
const APP_STORAGE_MAX_ATTEMPTS = 2

/**
 * Journal par défaut.
 *
 * Il n'écrit que ce que `StorageLogRecord` autorise — la forme est fermée, il
 * n'y a aucun champ où mettre une clé d'objet, un octet ou une URL signée
 * (`docs/security.md` §5). Le port de monitoring arrive en s39.
 */
const consoleLogger: StorageLogger = (record: StorageLogRecord): void => {
  console.error(record.event, {
    operation: record.operation,
    code: record.code,
    attempts: record.attempts,
    message: record.message,
  })
}

interface MountedStorage {
  readonly storage: Storage
  readonly localUpload: ((request: Request) => Promise<Response>) | null
}

/** Construit l'implémentation que la configuration désigne, et elle seule. */
const mount = (): MountedStorage => {
  const config = resolveStorageConfig(getEnv())

  if (config.kind === 's3') {
    return {
      storage: createS3Storage({
        bucket: config.bucket,
        region: config.region,
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        ...(config.endpoint === undefined ? {} : { endpoint: config.endpoint }),
        logger: consoleLogger,
        timeoutMs: APP_STORAGE_TIMEOUT_MS,
        maxAttempts: APP_STORAGE_MAX_ATTEMPTS,
      }),
      // Avec un vrai seau, la route de téléversement local **répond 404** : le
      // navigateur écrit directement chez le fournisseur, et l'application
      // n'expose aucun point d'entrée d'écriture de plus.
      localUpload: null,
    }
  }

  const local = createLocalDiskStorage({
    // Le dossier est **injecté**, jamais deviné par l'outil lui-même.
    directory: join(process.cwd(), config.directory),
  })

  return { storage: local.storage, localUpload: local.handleUpload }
}

export interface StorageFeature {
  /** Le module est-il monté ? **Une donnée**, lue par les écrans. */
  readonly available: boolean
  /** Donne au module ce qu'il ne peut pas se procurer, **sans rien construire**. */
  readonly prepare: () => void
  /** L'avatar d'un compte, ou `null`. Toujours `null` module coupé, sans toucher la base. */
  readonly avatarOf: (userId: string) => Promise<AvatarView | null>
}

/**
 * L'état « module coupé », qui est une **donnée** et non une condition.
 *
 * Ses fonctions n'ouvrent aucune connexion : un dépôt qui coupe le stockage ne
 * paie pas une requête pour apprendre qu'il n'en a pas.
 */
const ABSENT_STORAGE: StorageFeature = {
  available: false,
  prepare: () => {},
  avatarOf: () => Promise.resolve(null),
}

const mounted = moduleRegistry.moduleIds.includes(storageModule.id)

/**
 * Les périmètres qu'un compte a le droit de **lire**.
 *
 * Son propre compte, plus **chaque organisation dont il est membre** — pas
 * seulement l'organisation active. Un avatar d'organisation doit rester visible
 * depuis la bascule d'organisation, et c'est ce que le critère 5 demande :
 * « lisible par ses membres ».
 *
 * Le module ne peut pas calculer cette liste : il ne connaît pas
 * `organizations`, et n'a pas le droit de lire ses tables. Elle lui est donnée,
 * comme `emailOfScope` l'est à `marketing`. Module `organizations` coupé, la vue
 * est vide **sans toucher la base**, et il ne reste que le compte.
 */
const readableScopes = async (userId: string): Promise<readonly FileOwner[]> => {
  const view = await organizations.view(userId)

  return [
    { kind: 'user', id: userId },
    ...view.memberships.map((membership) => ({ kind: 'organization' as const, id: membership.id })),
  ]
}

/**
 * **Le périmètre d'un avatar : la personne, et rien d'autre.**
 *
 * C'est la tranche du constat F1 de la revue. L'écran qui téléverse est
 * `/account` — « ma photo de profil » —, et il n'existe aucun écran d'avatar
 * d'organisation dans cette story. Faire suivre l'organisation active à
 * l'écriture produisait trois défauts d'un coup, mesurés au navigateur : le
 * fichier partait dans `avatars/organization/…` pendant que l'écran lisait
 * `avatars/user/…`, donc l'avatar ne changeait pas ; « Retirer » supprimait la
 * ressource **partagée** de l'organisation en rendant 204 ; et cette écriture
 * n'était gardée par aucun rôle, alors que s17 refuse à un `member` les six
 * autres actions d'organisation.
 *
 * La règle de `docs/security.md` §3 — « une seule fonction résout le
 * propriétaire d'une donnée » — est tenue **ici** : celle-ci est l'unique
 * source d'appartenance donnée au module, et le module la rejoue pour les trois
 * chemins (écrire, afficher, retirer) par `avatarOfUser`. `dataOwnerOf` reste
 * la résolution des données d'organisation ; un avatar n'en est pas une.
 *
 * **Le périmètre organisation demeure dans le `domain` du module, et il est
 * inatteignable par cette application** : aucun chemin livré ne fabrique un
 * `FileOwner` d'organisation à l'écriture. `readableScopes` continue de les
 * énumérer — la lecture est prête pour le jour où un écran d'organisation
 * existera, et elle ne trouve aujourd'hui aucun fichier à y lire.
 */
const ownerOf = (userId: string): Promise<FileOwner> =>
  Promise.resolve({ kind: 'user', id: userId })

/**
 * Comment construire le service du module — **et non sa construction**.
 *
 * C'est ici que le module reçoit la **connexion** (ADR 020), le **port**
 * `Storage` — jamais un fournisseur — et les deux fonctions d'appartenance qu'il
 * ne peut pas se procurer. La construction reste différée : le répartiteur
 * prépare les services à chaque requête, y compris celles qu'aucune route ne
 * satisfait.
 */
const provide = (): void => {
  provideStorage(() => {
    const { storage, localUpload } = mount()

    return {
      db: getDatabase().db,
      storage,
      ...(localUpload === null ? {} : { localUpload }),
      readableScopes,
      ownerOf,
    }
  })
}

export const storage: StorageFeature = mounted
  ? {
      available: true,
      prepare: provide,
      avatarOf: async (userId) => {
        provide()

        // **Par la porte du module**, jamais en fabriquant un propriétaire ici :
        // c'est la seule forme où l'affichage ne peut pas désigner un autre
        // périmètre que l'écriture (constat F1 de la revue).
        return await requireStorageService().avatarOfUser(userId)
      },
    }
  : ABSENT_STORAGE

/**
 * Ce que les écrans ont le droit de connaître du module : ses chemins, et la
 * liste des types qu'il accepte.
 *
 * Cette dernière est **réexportée** plutôt que recopiée : l'attribut `accept`
 * d'un champ de fichier et la règle du serveur doivent nommer les mêmes types,
 * et deux listes divergeraient au premier format ajouté. C'est le `domain` qui
 * décide, ici comme ailleurs.
 */
export { AVATAR_CONTENT_TYPES, fileUrl, storageRoutePath }
