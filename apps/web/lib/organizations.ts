import { getEnv } from '@repo/config'
import { resolveDataOwner, type ModuleScope, type ModuleSession } from '@repo/core'
import { getDatabase } from '@repo/db'
import {
  EMPTY_ORGANIZATIONS_VIEW,
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

import { resolveAuthConfig } from './auth-config'
import { localeRouting } from './locale-routing'
import { createAppMailer } from './mailer'
import { moduleRegistry } from './module-registry'

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
  view: () => Promise.resolve(EMPTY_ORGANIZATIONS_VIEW),
  invitation: () => Promise.resolve(null),
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
  // L'écran de contact du site public (s11) : un segment que l'application
  // sert, donc un identifiant qu'aucune organisation ne peut prendre.
  'contact',
  'forgot-password',
  // L'écran d'atterrissage d'un lien d'invitation (s16) : un écran servi par
  // l'application, donc un identifiant qu'aucune organisation ne peut prendre.
  'invitations',
  'legal',
  // Le rebond same-site du retour de fournisseur (s12) : un écran servi par
  // l'application, donc un identifiant qu'aucune organisation ne peut prendre.
  'oauth',
  'organizations',
  'reset-password',
  'sign-in',
  'sign-up',
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
