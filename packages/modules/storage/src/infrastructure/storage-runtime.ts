import { randomUUID } from 'node:crypto'

import type { Storage } from '@repo/ports'

import {
  createStorageUseCases,
  type AvatarView,
  type StorageUseCases,
} from '../application/storage-use-cases'
import type { FileOwner } from '../domain/avatar'
import { createDrizzleFileRepository, type StorageDatabase } from './drizzle-file-repository'

/**
 * Le service du module, **construit à la première requête**, pas à l'import.
 *
 * `config/features.ts` charge le contrat du module, et ce fichier est lu par
 * `pnpm ks list` comme par `pnpm db:generate`, qui n'ont ni base ni stockage.
 * Les routes reçoivent donc un accès **différé** au service, posé par le point
 * de composition de l'application (`apps/web/lib/storage.ts`). C'est le patron
 * de `auth`, `organizations` et `marketing`, repris à l'identique.
 */

export interface ConfigureStorageOptions {
  /** Connexion Drizzle, fournie par le point de composition (jamais lue ici). */
  readonly db: StorageDatabase
  /**
   * Le **port**, jamais un fournisseur. Le module ne sait pas s'il parle à un
   * seau S3 ou à un dossier sur disque, et c'est exactement ce que le port
   * existe pour garantir.
   */
  readonly storage: Storage
  /**
   * La porte du **mode local**, ou son absence.
   *
   * Présente, la route de téléversement local sert ; absente, elle répond 404.
   * C'est ce qui fait qu'un déploiement muni d'un vrai seau n'expose aucun point
   * d'entrée d'écriture supplémentaire — la route existe dans la table de
   * routage, mais elle ne mène nulle part.
   */
  readonly localUpload?: (request: Request) => Promise<Response>
  /**
   * Les périmètres qu'un compte a le droit de **lire**.
   *
   * Le module ne connaît ni `auth`, ni `organizations`, et n'a pas le droit de
   * lire leurs tables : l'appartenance lui est **donnée** par le point de
   * composition, exactement comme `emailOfScope` l'est à `marketing` et
   * `reservedSlugs` à `organizations`. C'est ce qui tient le critère 5 sans
   * qu'aucune clé étrangère ne lie les deux modules.
   */
  readonly readableScopes: (userId: string) => Promise<readonly FileOwner[]>
  /**
   * **Le périmètre de l'avatar d'un compte — un seul, pour les trois chemins.**
   *
   * Écriture, affichage et suppression le résolvent par cette fonction et par
   * elle seule : c'est ce qui rend impossible la divergence mesurée en revue
   * (constat F1), où le téléversement partait dans le périmètre de
   * l'organisation active pendant que l'écran lisait celui du compte —
   * l'avatar ne s'affichait pas, et « Retirer » effaçait la ressource d'un
   * autre périmètre en rendant un succès.
   *
   * Elle vit dans l'application parce qu'elle peut dépendre d'un module que
   * celui-ci ne requiert pas ; le module, lui, ne connaît aucune autre source
   * d'appartenance à l'écriture.
   */
  readonly ownerOf: (userId: string) => Promise<FileOwner>
  readonly generateId?: () => string
  readonly generateObjectId?: () => string
  readonly now?: () => Date
}

export interface StorageService {
  readonly useCases: StorageUseCases
  readonly localUpload: ((request: Request) => Promise<Response>) | null
  readonly readableScopes: (userId: string) => Promise<readonly FileOwner[]>
  readonly ownerOf: (userId: string) => Promise<FileOwner>
  /**
   * **L'avatar tel que l'écran d'un compte le lit.**
   *
   * C'est la porte d'affichage, et elle existe pour qu'il n'y en ait qu'une :
   * l'application ne fabrique aucun `FileOwner`, elle donne un identifiant de
   * compte et reçoit ce que le périmètre d'écriture contient. Le point de
   * composition écrivait ici son propre `{ kind: 'user' }`, et c'est ainsi que
   * l'écriture et l'affichage ont pu désigner deux propriétaires différents.
   */
  readonly avatarOfUser: (userId: string) => Promise<AvatarView | null>
}

export class StorageNotConfiguredError extends Error {
  constructor() {
    super(
      'Le module « storage » n’est pas configuré : le point de composition ' +
        'de l’application doit appeler provideStorage() avant de servir une requête.',
    )
    this.name = 'StorageNotConfiguredError'
  }
}

let service: StorageService | null = null
let provider: (() => ConfigureStorageOptions) | null = null

const build = (options: ConfigureStorageOptions): StorageService => {
  const useCases = createStorageUseCases({
    repository: createDrizzleFileRepository(options.db),
    storage: options.storage,
    newId: options.generateId ?? (() => `file_${randomUUID()}`),
    // Le nom de l'objet dans le seau : **du hasard, et rien d'autre**. Il ne
    // porte ni l'identifiant de la ligne, ni le nom du fichier téléversé.
    newObjectId: options.generateObjectId ?? (() => randomUUID().replaceAll('-', '')),
    now: options.now ?? (() => new Date()),
  })

  return {
    useCases,
    localUpload: options.localUpload ?? null,
    readableScopes: options.readableScopes,
    ownerOf: options.ownerOf,
    // **La même résolution que l'écriture**, et c'est tout ce que cette ligne
    // fait. Un `{ kind: 'user', id: userId }` écrit ici serait un second
    // propriétaire, invisible tant que les deux coïncident.
    avatarOfUser: async (userId) => await useCases.avatarOf(await options.ownerOf(userId)),
  }
}

/** Construit le service **maintenant**. C'est la forme qu'une suite de tests emploie. */
export function configureStorage(options: ConfigureStorageOptions): StorageService {
  service = build(options)

  return service
}

/**
 * Dit **comment** construire le service, sans le construire.
 *
 * Le répartiteur de modules prépare les services à **chaque** requête, y compris
 * celles qu'aucune route ne satisfait : construire aussitôt ouvrirait une
 * connexion à la base pour répondre 404 sur un chemin inconnu — mesuré en s15,
 * `tests/module-off.test.ts` échouait exactement là.
 */
export function provideStorage(factory: () => ConfigureStorageOptions): void {
  provider = factory
}

export function requireStorageService(): StorageService {
  if (service !== null) {
    return service
  }

  if (provider === null) {
    throw new StorageNotConfiguredError()
  }

  service = build(provider())

  return service
}

/** Remet le module à son état non configuré. Réservé aux suites de tests. */
export function resetStorageService(): void {
  service = null
  provider = null
}
