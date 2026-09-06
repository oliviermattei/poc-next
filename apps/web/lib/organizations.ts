import { getEnv } from '@repo/config'
import { resolveDataOwner, type ModuleScope, type ModuleSession } from '@repo/core'
import { getDatabase } from '@repo/db'
import { CONSENT_SCREEN_SEGMENT } from '@repo/module-consent'
import {
  allows,
  EMPTY_ORGANIZATIONS_VIEW,
  ORGANIZATION_ACTION,
  INVITATION_SCREEN_PATH,
  organizationRoutePath,
  organizationsModule,
  ORGANIZATIONS_SCREEN_PATH,
  provideOrganizations,
  requireOrganizationsService,
  type InvitationPreview,
  type OrganizationsService,
  type OrganizationsView,
} from '@repo/module-organizations'

import { purgeModules } from '@repo/core'

import { resolveAuthConfig } from './auth-config'
import { localeRouting } from './locale-routing'
import { createAppMailer } from './mailer'
import { moduleRegistry } from './module-registry'
import { seatSyncOf } from './seat-sync'

/**
 * Le point de composition des organisations — le cinquième du même modèle,
 * après `lib/mailer.ts`, `lib/auth.ts`, `lib/locale-routing.ts` et
 * `lib/marketing.ts`.
 *
 * C'est **le seul fichier de l'application** qui connaisse
 * `@repo/module-organizations`, et le seul qui regarde si ce module est monté.
 * Ailleurs — l'écran, la navigation, la résolution du propriétaire d'une
 * donnée — on lit `organizations`, dont la **forme est la même dans les deux
 * états** : un drapeau, une vue à deux champs, une organisation active qui vaut
 * `null`. C'est ce qui empêche les trente stories suivantes de porter une
 * branche « si les organisations existent ».
 *
 * Le choix se lit dans le **registre**, jamais dans `config/features.ts`
 * directement : le registre est déjà la vérité sur ce qui est activé, et
 * l'identifiant vient du module lui-même.
 *
 * | | module activé | module coupé |
 * |---|---|---|
 * | `/organizations` | l'écran | **404** |
 * | entrée de navigation | présente (authentifiée) | absente |
 * | `dataOwnerOf(session)` | l'organisation active, ou le compte | **toujours** le compte |
 * | requêtes en base | celles de l'écran | **aucune** |
 */

export interface OrganizationsFeature {
  /**
   * Le module est-il monté ? **Une donnée**, lue par l'écran pour décider s'il
   * existe — pas un `if (module activé)` de plus disséminé dans l'application.
   */
  readonly available: boolean
  /**
   * Donne au module ce qu'il ne peut pas se procurer, **avant** qu'une de ses
   * routes ne soit servie — **sans rien construire**. Sans objet quand le
   * module est coupé.
   *
   * Elle existe parce que les routes d'un module sont montées par le
   * répartiteur, pas par ce fichier : rien dans le chemin d'une requête d'API
   * n'importerait `lib/organizations.ts` autrement, et la première soumission
   * de formulaire échouait sur « le module n'est pas configuré » — mesuré au
   * navigateur.
   *
   * Elle dit **comment** construire, elle ne construit pas. Le répartiteur
   * prépare à chaque requête, y compris celles qu'aucune route ne satisfait :
   * ouvrir une connexion pour répondre 404 sur un chemin inconnu serait un
   * défaut, et `tests/module-off.test.ts` échouait exactement là. Construire à
   * l'import serait pire encore — la base serait ouverte pendant `pnpm build`,
   * qui n'a pas de `DATABASE_URL` et n'a aucune raison d'en avoir une.
   */
  readonly prepare: () => void
  /** L'organisation active du compte, ou `null`. Toujours `null` module coupé. */
  readonly activeOrganizationId: (userId: string) => Promise<string | null>
  /** Ce que l'écran affiche. Vide et immuable module coupé. */
  readonly view: (userId: string) => Promise<OrganizationsView>
  /**
   * Ce que l'écran d'atterrissage d'un lien d'invitation montre, ou `null`.
   *
   * Toujours `null` module coupé, **sans toucher la base** : l'écran répond
   * alors 404, comme `/organizations`.
   */
  readonly invitation: (token: string) => Promise<InvitationPreview | null>
  /**
   * **Le nombre de membres d'une organisation nommée** — s23, et il ne
   * ressemble à rien d'autre dans ce fichier.
   *
   * Tout le reste ici part d'un compte : `view(userId)`,
   * `activeOrganizationId(userId)`. Celle-ci part d'un identifiant
   * d'organisation, ce qui est exactement la forme de lecture que la porte de
   * s15 ferme — et c'est pourquoi elle est **serveur seulement** : aucune route
   * ne l'appelle, aucun écran ne la lit, et rien ne lui transmet une valeur
   * venue du navigateur. Son unique appelant est `pnpm billing:reconcile`, qui
   * n'a pas de session et doit pourtant compter les membres des organisations
   * que le fournisseur de paiement lui nomme.
   *
   * `null` module coupé : il n'y a alors **aucun nombre**, ce qui n'est pas
   * « zéro » — et la différence décide si une facture peut baisser
   * (`billableSeats`, `@repo/module-billing`).
   */
  readonly countMembers: (organizationId: string) => Promise<number | null>
  /**
   * **Les organisations dont ce compte est le seul propriétaire** (s34, critère
   * 6), nommées.
   *
   * Lue par la suppression de compte, qui vit dans le module `auth`. Module
   * coupé : **aucune**, sans toucher la base — un projet sans organisations n'a
   * personne à retenir.
   */
  readonly soleOwnerships: (userId: string) => Promise<readonly string[]>
  /**
   * **Retire ce compte de ses organisations, ou refuse** (s34, constat F1 de la
   * troisième revue) — la revendication atomique qui remplace, au moment
   * d'effacer, la lecture de `soleOwnerships`.
   *
   * Module coupé : **aucune** organisation ne bloque et il n'y a rien à
   * retirer, sans toucher la base.
   */
  readonly releaseOrganizations: (userId: string) => Promise<readonly string[]>
  /**
   * **L'appelant peut-il exporter les données de cette organisation ?** (s35)
   *
   * Trois réponses, et aucun rôle n'en sort : la matrice rôle × action vit dans
   * le module qui possède les rôles, et ce fichier la lit — il ne la rejoue pas
   * (revue de s17, F4). `unknown` couvre le non-membre, l'organisation inconnue
   * **et le module coupé** : les trois répondent 404, l'existence de la
   * ressource d'autrui ne se confirme pas (`docs/security.md` §3).
   *
   * La lecture part d'un **compte** — `view(userId)` —, jamais d'un identifiant
   * d'organisation reçu du client : c'est la forme que la porte de s15 exige.
   */
  readonly exportPermission: (input: {
    readonly userId: string
    readonly organizationId: string
  }) => Promise<'allowed' | 'refused' | 'unknown'>
}

/**
 * L'état « module coupé », qui est une **donnée** et non une condition.
 *
 * Ses deux fonctions n'ouvrent aucune connexion : un dépôt qui coupe les
 * organisations ne paie pas une requête pour apprendre qu'il n'en a pas.
 */
const ABSENT_ORGANIZATIONS: OrganizationsFeature = {
  available: false,
  prepare: () => {},
  activeOrganizationId: () => Promise.resolve(null),
  // Module coupé : aucune organisation n'existe, donc aucune n'est exportable.
  // **Sans toucher la base**, comme le reste de cet état.
  exportPermission: () => Promise.resolve('unknown'),
  view: () => Promise.resolve(EMPTY_ORGANIZATIONS_VIEW),
  invitation: () => Promise.resolve(null),
  countMembers: () => Promise.resolve(null),
  soleOwnerships: () => Promise.resolve([]),
  releaseOrganizations: () => Promise.resolve([]),
}

/**
 * Les identifiants publics que le produit se **réserve**.
 *
 * Trois sources, et deux d'entre elles sont dérivées :
 *
 * 1. les premiers segments des `href` de la navigation du registre — un module
 *    activé qui pose `/billing` réserve `billing` sans que personne n'y pense ;
 * 2. les **langues servies** — un identifiant `fr` entrerait en collision avec
 *    le préfixe de locale posé par `proxy.ts` ;
 * 3. les segments des écrans que l'application sert elle-même. Ceux-là sont
 *    écrits, parce qu'aucune valeur d'exécution ne les porte — et
 *    `tests/organizations.test.ts` **dérive du disque** les segments de premier
 *    niveau de `apps/web/app` et exige que chacun soit refusé. Ajouter un écran
 *    sans réserver son segment fait rougir `pnpm test`.
 */
const APPLICATION_SEGMENTS = [
  'account',
  'api',
  // L'écran de facturation (s19) : un segment que l'application sert, donc un
  // identifiant qu'aucune organisation ne peut prendre. Il est écrit ici en
  // plus d'être dérivé de la navigation du registre, parce que le fichier
  // d'écran existe sur le disque **même quand le module est coupé** — et
  // `tests/organizations.test.ts` dérive les segments du disque, pas du
  // registre.
  'billing',
  // Les deux écrans du blog (s29) : ils sont aussi dérivés de la navigation du
  // registre, mais leurs fichiers existent sur le disque **même quand le
  // module `blog` est coupé** — et c'est du disque que
  // `tests/organizations.test.ts` dérive. Même raison que `billing` juste
  // au-dessus, mesurée par `pnpm test:minimal-profile`, qui coupe ce module.
  'blog',
  // Les deux écrans de la documentation (s30), exactement pour la même raison,
  // et trouvée de la même façon : `pnpm test` était vert — module activé, son
  // entrée de navigation suffisait —, et `pnpm test:minimal-profile`, qui coupe
  // ce module, a rougi. Une garde qui ne mord que dans une configuration est
  // une garde que la CI peut ne jamais exécuter.
  'docs',
  // L'écran de contact du site public (s11) : un segment que l'application
  // sert, donc un identifiant qu'aucune organisation ne peut prendre.
  'contact',
  // L'écran de préférences de cookies (s36) : le segment vient du module, il
  // n'est pas recopié — le renommer là-bas le réserve ici sans qu'on y pense.
  CONSENT_SCREEN_SEGMENT,
  'forgot-password',
  // L'écran d'atterrissage d'un lien d'invitation (s16) : un écran servi par
  // l'application, donc un identifiant qu'aucune organisation ne peut prendre.
  'invitations',
  'legal',
  // Le rebond same-site du retour de fournisseur (s12) : un écran servi par
  // l'application, donc un identifiant qu'aucune organisation ne peut prendre.
  'oauth',
  // Le centre de notifications (s32) : il est aussi dérivé de la navigation du
  // registre, mais son fichier d'écran existe sur le disque **même quand le
  // module est coupé** — et c'est du disque que `tests/organizations.test.ts`
  // dérive. Même raison que `billing` et `blog` plus haut.
  'notifications',
  'organizations',
  // L'écran d'une fonctionnalité réservée à une offre payante (s21) : un écran
  // servi par l'application, donc un identifiant qu'aucune organisation ne peut
  // prendre. Il existe sur le disque quel que soit l'état du module de
  // facturation, et c'est du disque que `tests/organizations.test.ts` dérive.
  'premium',
  // La page publique de tarifs (s22) : elle est aussi dérivée de la navigation
  // du registre, mais son fichier d'écran existe sur le disque **même quand le
  // module de facturation est coupé** — et c'est du disque que
  // `tests/organizations.test.ts` dérive. Même raison que `billing` plus haut.
  'pricing',
  'reset-password',
  'sign-in',
  'sign-up',
  // L'écran de vérification du second facteur (s13). Servi à qui vient de
  // prouver son mot de passe : une organisation qui s'appellerait `two-factor`
  // le masquerait.
  'two-factor',
  'verify-email',
] as const

const firstSegmentOf = (href: string): string => href.split('/').filter(Boolean)[0] ?? ''

export const reservedSlugs: ReadonlySet<string> = new Set(
  [
    ...APPLICATION_SEGMENTS,
    ...localeRouting.locales,
    ...moduleRegistry.navigation.map((entry) => firstSegmentOf(entry.href)),
  ].filter((segment) => segment !== ''),
)

/**
 * Le module, monté ou non.
 *
 * La construction du service est **différée** à la première utilisation :
 * `config/features.ts` est aussi chargé par `pnpm ks` et par
 * `pnpm db:generate`, qui n'ont pas de base.
 */
const mounted = moduleRegistry.moduleIds.includes(organizationsModule.id)

/**
 * Comment construire le service du module — **et non sa construction**.
 *
 * C'est ici que la **connexion** est donnée au module — il ne dépend pas de
 * `@repo/db` et ne va pas la chercher (ADR 020) —, ainsi que les identifiants
 * réservés, que lui non plus ne peut pas connaître.
 */
const provide = (): void => {
  provideOrganizations(() => ({
    db: getDatabase().db,
    reservedSlugs,
    // Le **port** d'envoi, jamais un fournisseur : `lib/mailer.ts` est le seul
    // fichier qui sache qu'il existe Resend et une capture locale, et le module
    // ne connaît que `Mailer` — exactement comme `lib/auth.ts` le fait.
    mailer: createAppMailer(),
    // L'URL publique, **jamais déduite d'un en-tête `Host`** : la déduire
    // laisserait un attaquant faire pointer un lien d'invitation vers son
    // propre domaine. C'est la même règle et la même variable que celles qui
    // construisent les liens de vérification (`lib/auth-config.ts`).
    appUrl: resolveAuthConfig(getEnv()).appUrl,
    // Un destinataire dont rien n'est connu reçoit la langue **du site** : il
    // n'a pas de requête, donc pas de préférence. La règle est celle du module
    // `auth` (`AuthService.localeOf`), appliquée ici sans le détour.
    emailLocale: localeRouting.defaultLocale,
    // **La taille de l'organisation part chez le fournisseur de paiement avant
    // que l'écriture qui l'a changée soit validée** (s23, ADR 046).
    //
    // Le module ne sait pas qu'il existe une facturation — `requires: []` du
    // module `billing` est une décision (ADR 034) —, et il n'a pas à
    // l'apprendre : le couplage est **ici**, au point de composition, comme
    // celui du mailer. La règle, elle, vit dans `lib/seat-sync.ts`, pour la
    // raison qui a sorti `canManage` de ce fichier : ce qui est écrit ici n'est
    // neutralisable par aucun test.
    //
    // **L'import est différé** : `lib/billing.ts` importe ce fichier-ci (pour
    // `dataOwnerOf`), et un import statique en sens inverse fermerait le cycle.
    seatSync: seatSyncOf(async () => (await import('./billing')).billing),
    // **Le module ne connaît pas les notifications** — il ne les requiert pas,
    // et le produit doit rester utilisable ce module coupé. Il nomme l'événement
    // qu'il possède ; ce qui en est fait se décide dans l'émission unique
    // (`lib/notifications.ts`), sur les préférences du compte destinataire.
    //
    // **L'import est différé**, pour la raison exacte qui diffère celui de la
    // facturation : `lib/notifications.ts` importe ce fichier-ci (pour le
    // périmètre de lecture d'un compte), et un import statique en sens inverse
    // fermerait le cycle.
    notify: async (input) => await (await import('./notifications')).emitNotification(input),
    /**
     * **L'effacement de tous les modules activés** (s34), branché sur le
     * registre de l'application.
     *
     * Le module ne connaît pas le registre — il ne peut pas, le registre est
     * construit à partir des modules. Ce qui est rendu est réduit à ce dont la
     * règle a besoin : a-t-elle abouti ? Le module fautif est journalisé ici,
     * jamais rendu à l'appelant.
     */
    purgeScope: async (scope) => {
      const outcome = await purgeModules(moduleRegistry, scope)

      if (!outcome.ok) {
        console.error(
          `[organizations.purge_failed] module=${outcome.failed} purgés=${outcome.purged.length} ${outcome.message}`,
        )
      }

      return { ok: outcome.ok }
    },
    /**
     * **L'annulation de l'abonnement du périmètre** (critère 5), par le même
     * chemin différé que `seatSync` et pour la même raison de cycle.
     *
     * Facturation coupée : rien à annuler, et **aucune connexion ouverte** pour
     * l'apprendre — par la valeur, pas par une condition sur un nom de module.
     */
    cancelBilling: async (organizationId) => {
      const billing = (await import('./billing')).billing

      if (!billing.available) {
        return { ok: true }
      }

      const outcome = await billing.cancelSubscriptions({ kind: 'organization', organizationId })

      return { ok: outcome.status !== 'failed' }
    },
  }))
}

const organizationsService = (): OrganizationsService => {
  provide()

  return requireOrganizationsService()
}

export const organizations: OrganizationsFeature = mounted
  ? {
      available: true,
      prepare: provide,
      activeOrganizationId: async (userId) =>
        await organizationsService().useCases.activeOrganizationId(userId),
      view: async (userId) => await organizationsService().useCases.viewOrganizations(userId),
      invitation: async (token) =>
        await organizationsService().useCases.describeInvitation(token),
      countMembers: async (organizationId) =>
        await organizationsService().useCases.countMembers(organizationId),
      soleOwnerships: async (userId) =>
        await organizationsService().useCases.soleOwnerships(userId),
      releaseOrganizations: async (userId) =>
        await organizationsService().useCases.releaseMemberships(userId),
      exportPermission: async ({ userId, organizationId }) => {
        const membership = (
          await organizationsService().useCases.viewOrganizations(userId)
        ).memberships.find((organization) => organization.id === organizationId)

        if (membership === undefined) {
          return 'unknown'
        }

        return allows(membership.role, ORGANIZATION_ACTION.exportData) ? 'allowed' : 'refused'
      },
    }
  : ABSENT_ORGANIZATIONS

/**
 * **Le propriétaire de la donnée que l'appelant manipule.**
 *
 * Une seule fonction pour les deux configurations (`docs/architecture.md`,
 * « Data model » ; `docs/security.md` §3) : elle rend un périmètre organisation
 * quand une organisation est active, un périmètre compte sinon. Module coupé,
 * `activeOrganizationId` rend toujours `null` **sans toucher la base**, et
 * l'appelant ne le sait pas — c'est tout l'intérêt.
 *
 * Elle reçoit la session plutôt que d'aller la chercher, et ce n'est pas une
 * préférence de style : lire le cookie ici importerait `next/headers`, donc
 * rendrait ce fichier inutilisable hors d'un contexte de requête — les parcours
 * Playwright, qui en dérivent leurs attentes, ne pourraient plus l'importer.
 * L'appelant a déjà sa session : il l'a résolue une fois.
 *
 * `null` quand personne n'est connecté : il n'y a alors pas de propriétaire, et
 * aucune requête n'est émise.
 */
export async function dataOwnerOf(session: ModuleSession | null): Promise<ModuleScope | null> {
  if (session === null) {
    return null
  }

  return resolveDataOwner({
    session,
    activeOrganizationId: await organizations.activeOrganizationId(session.userId),
  })
}

/** Ce que les écrans ont le droit de connaître du module : ses chemins. */
export { INVITATION_SCREEN_PATH, ORGANIZATIONS_SCREEN_PATH, organizationRoutePath }
