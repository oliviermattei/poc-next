import { MODULE_ROUTE_PREFIX, type ModuleRoute, type NavigationEntry } from '@repo/core'

import type { StorageUseCases } from '../application/storage-use-cases'
import type { FileOwner } from '../domain/avatar'

/**
 * Les routes du module, **énumérées une par une**, avec leur niveau de
 * protection (ADR 007 et 017). Ce qui n'est pas dans cette liste n'existe pas :
 * le répartiteur répond 404 sans atteindre le module, et un module coupé n'a
 * aucune de ces routes dans la table de routage.
 *
 * **Les cinq sont `authenticated`**, y compris le téléversement local — le
 * répartiteur refuse donc avant d'appeler le gestionnaire, et le refus n'atteint
 * ni la règle, ni la base, ni le stockage.
 *
 * La lecture d'un fichier en fait partie, et ce n'est pas une évidence : un
 * avatar n'est pas public. Le rendre public dispenserait de la session, et
 * n'importe qui pourrait alors énumérer les identifiants de fichiers pour voir
 * les avatars d'une organisation dont il n'est pas membre — le critère 5,
 * exactement.
 *
 * ## Pourquoi la lecture passe par nous
 *
 * ADR 032. Deux raisons, et la première est mesurable : `img-src 'self'`
 * (s45, `config/security.ts` livre la liste vide) refuse une image servie par le
 * domaine du seau. La seconde est structurelle : une URL présignée de lecture
 * est une capacité **détachée de l'appartenance**, donc incapable de tenir « un
 * fichier d'organisation n'est lisible que par ses membres » à chaque requête.
 */

const PATHS = {
  presignAvatar: '/storage/avatar/presign',
  confirmAvatar: '/storage/avatar/confirm',
  removeAvatar: '/storage/avatar/remove',
  file: '/storage/file',
  localUpload: '/storage/local-upload',
} as const

/** Le chemin public d'une route du module, préfixe de montage compris. */
export const storageRoutePath = (path: keyof typeof PATHS): string =>
  `${MODULE_ROUTE_PREFIX}${PATHS[path]}`

/**
 * L'URL de lecture d'un fichier, telle qu'un `<img src>` la porte.
 *
 * `v` est un **jeton de fraîcheur**, ignoré par la route : il change à chaque
 * remplacement, ce que l'identifiant de ligne ne fait pas. Sans lui, l'attribut
 * `src` reste identique après un remplacement et le navigateur continue
 * d'afficher l'ancienne image — mesuré, et `cache-control: private, no-store`
 * n'y change rien, puisque rien ne demande la nouvelle.
 */
export const fileUrl = (fileId: string, version?: string): string =>
  `${storageRoutePath('file')}?id=${encodeURIComponent(fileId)}` +
  (version === undefined ? '' : `&v=${encodeURIComponent(version)}`)

/**
 * Ce que rend un fichier que l'appelant n'a pas le droit de voir.
 *
 * **404, jamais 403** (`docs/security.md` §3) : un 403 confirmerait que ce
 * fichier existe. La réponse est donc exactement celle d'un identifiant inventé.
 */
const notFound = (): Response => Response.json({ error: 'not_found' }, { status: 404 })

/** Le corps d'une soumission, quelle que soit sa forme. Le `domain` valide ensuite. */
const submittedBody = async (request: Request): Promise<unknown> => {
  const contentType = request.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    return await request.json().catch(() => null)
  }

  return await request
    .formData()
    .then((form) => Object.fromEntries(form.entries()))
    .catch(() => null)
}

export interface StorageRouteService {
  readonly useCases: StorageUseCases
  readonly localUpload: ((request: Request) => Promise<Response>) | null
  readonly readableScopes: (userId: string) => Promise<readonly FileOwner[]>
  /**
   * Le périmètre auquel appartient l'avatar d'un compte — **le même pour
   * écrire, afficher et retirer**.
   *
   * Le module ne le calcule pas : `docs/security.md` §3 exige qu'une donnée ait
   * **une** résolution de propriétaire, et celle-ci vit dans l'application. Les
   * trois routes d'écriture passent par elle, et l'affichage aussi
   * (`avatarOfUser`) : c'est ce qui interdit à l'écran de lire un périmètre que
   * le téléversement n'écrit pas (constat F1 de la revue de s18).
   */
  readonly ownerOf: (userId: string) => Promise<FileOwner>
}

export function createStorageRoutes(
  service: () => StorageRouteService,
): readonly ModuleRoute[] {
  const presign: ModuleRoute = {
    method: 'POST',
    path: PATHS.presignAvatar,
    protection: { level: 'authenticated' },
    handler: async (request, context) => {
      if (context.session === null) {
        return notFound()
      }

      const outcome = await service().useCases.presignAvatar({
        // Le périmètre vient de la **session**, jamais du corps : aucun chemin
        // ne laisse écrire au nom d'un autre (`docs/security.md` §3).
        owner: await service().ownerOf(context.session.userId),
        body: await submittedBody(request),
      })

      return outcome.status === 'ok'
        ? Response.json({
            key: outcome.key,
            url: outcome.url,
            method: outcome.method,
            headers: outcome.headers,
            expiresAt: outcome.expiresAt.toISOString(),
          })
        : // Un **code** de refus, jamais une phrase : la traduction appartient
          // au catalogue du module, et une phrase dans une réponse serait un
          // texte affiché qui ne vient pas d'un catalogue.
          Response.json({ error: outcome.refusal }, { status: 422 })
    },
  }

  const confirm: ModuleRoute = {
    method: 'POST',
    path: PATHS.confirmAvatar,
    protection: { level: 'authenticated' },
    handler: async (request, context) => {
      if (context.session === null) {
        return notFound()
      }

      const outcome = await service().useCases.confirmAvatar({
        owner: await service().ownerOf(context.session.userId),
        body: await submittedBody(request),
      })

      if (outcome.status === 'not_found') {
        return notFound()
      }

      // **Le même 404, un autre motif.** Une confirmation rejouée est refusée
      // comme une clé inconnue — le statut ne bouge pas, donc rien ne se déduit
      // du code de réponse (`docs/security.md` §3) —, mais l'écran a besoin de
      // savoir que l'avatar a bel et bien changé pour ne pas dire le contraire.
      if (outcome.status === 'already_confirmed') {
        return Response.json({ error: 'already_confirmed' }, { status: 404 })
      }

      return outcome.status === 'ok'
        ? Response.json({ fileId: outcome.fileId })
        : Response.json({ error: outcome.refusal }, { status: 422 })
    },
  }

  const remove: ModuleRoute = {
    method: 'POST',
    path: PATHS.removeAvatar,
    protection: { level: 'authenticated' },
    handler: async (_request, context) => {
      if (context.session === null) {
        return notFound()
      }

      const outcome = await service().useCases.removeAvatar(
        await service().ownerOf(context.session.userId),
      )

      return outcome.status === 'ok'
        ? new Response(null, { status: 204 })
        : Response.json({ error: outcome.refusal }, { status: 422 })
    },
  }

  const file: ModuleRoute = {
    method: 'GET',
    path: PATHS.file,
    protection: { level: 'authenticated' },
    handler: async (request, context) => {
      if (context.session === null) {
        return notFound()
      }

      const current = service()
      const outcome = await current.useCases.readFile({
        fileId: new URL(request.url).searchParams.get('id') ?? '',
        // **Tous** les périmètres que l'appelant peut lire : le sien, et chaque
        // organisation dont il est membre. C'est l'application qui les donne.
        scopes: await current.readableScopes(context.session.userId),
      })

      if (outcome.status === 'not_found') {
        return notFound()
      }

      // `Uint8Array<ArrayBufferLike>` n'est pas un `BodyInit` : le tampon
      // sous-jacent peut être partagé, et la plateforme ne l'accepte donc pas
      // tel quel. La tranche donne un `ArrayBuffer` propre à cette réponse.
      return new Response(outcome.bytes.slice().buffer as ArrayBuffer, {
        status: 200,
        headers: {
          'content-type': outcome.contentType,
          // Un avatar est une donnée personnelle servie derrière une session :
          // aucun cache partagé n'a le droit de le garder, et un cache privé n'a
          // pas de raison de le servir après une révocation.
          'cache-control': 'private, no-store',
          // Le type servi est celui vérifié sur les octets ; `nosniff` interdit
          // au navigateur d'en deviner un autre. La ceinture par-dessus les
          // bretelles du contrôle de contenu.
          'x-content-type-options': 'nosniff',
          'content-disposition': 'inline',
        },
      })
    },
  }

  /**
   * Le téléversement du **mode local**.
   *
   * Elle est déclarée en permanence — une route conditionnelle serait un
   * `if (module activé)` déguisé — mais elle ne mène quelque part que si le
   * point de composition a monté le stockage sur disque. Avec un vrai seau,
   * `localUpload` vaut `null` et cette route répond 404 : un déploiement de
   * production n'expose donc **aucun** point d'entrée d'écriture de plus.
   */
  const localUpload: ModuleRoute = {
    method: 'PUT',
    path: PATHS.localUpload,
    protection: { level: 'authenticated' },
    handler: async (request, context) => {
      if (context.session === null) {
        return notFound()
      }

      const handle = service().localUpload

      return handle === null ? notFound() : await handle(request)
    },
  }

  return [presign, confirm, remove, file, localUpload]
}

/**
 * La navigation du module : **aucune entrée**.
 *
 * Le stockage n'a pas d'écran à lui. Il s'affiche dans les paramètres du compte
 * et dans le menu du shell, qui appartiennent à l'application. Une entrée de
 * navigation vers une route d'API serait un mensonge : elle ne mène à rien
 * qu'un visiteur puisse lire.
 */
export const storageNavigation: readonly NavigationEntry[] = []
