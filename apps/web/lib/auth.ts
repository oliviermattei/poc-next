import { type Env, getEnv } from '@repo/config'
import { getDatabase } from '@repo/db'
import {
  authRoutePath,
  configureAuth,
  readOAuthFailureClass,
  safeRedirectPath,
  type AccountView,
  type AnyOAuthProviderId,
  type AuthService,
  type DataExportTrace,
  type DescribedPasskey,
  type DescribedSession,
  type DescribedSignInMethod,
} from '@repo/module-auth'
import { buildDataExportArchive, purgeModules, type ModuleSession } from '@repo/core'
import { headers } from 'next/headers'
import { after } from 'next/server'

import { resolveAuthConfig } from './auth-config'
import { LOCALE_COOKIE, localeRouting } from './locale-routing'
import { createAppMailer } from './mailer'
import { moduleRegistry } from './module-registry'
import { resolveOAuthConfig } from './oauth-config'

/**
 * Le point de composition de l'authentification.
 *
 * C'est **le seul fichier de l'application** qui connaisse le module `auth`, et
 * c'est la même exception que `lib/mailer.ts` pour le fournisseur d'emails : le
 * reste de l'application ne voit que le registre. Il ne pouvait pas en aller
 * autrement — le crochet `resolveSession` que `dispatchModuleRequest` attend
 * (s03) doit bien venir de quelque part, et `@repo/core` ne peut pas dépendre
 * d'un module sans inverser la dépendance qui fait toute la modularité.
 *
 * Ce fichier assemble ce que le module ne peut pas se procurer lui-même :
 *
 * - la **connexion** à la base — le module ne dépend pas de `@repo/db`, et
 *   c'est ce qui empêche le cycle `@repo/db` → agrégat généré → module (ADR
 *   020) ;
 * - le **mailer**, construit par `lib/mailer.ts` : le module d'authentification
 *   ne connaît que le port `Mailer`, jamais Resend ni la capture locale ;
 * - le **secret** et l'**URL publique**, validés par `lib/auth-config.ts`.
 *
 * La construction est différée à la première requête : `config/features.ts` est
 * aussi chargé par `pnpm ks` et par `pnpm db:generate`, qui n'ont ni base ni
 * mailer.
 */
/**
 * Ce que les écrans ont le droit de connaître du module : le chemin de ses
 * routes et la règle de destination de retour. Réexportés d'ici, pour que
 * l'exception « un seul fichier importe un module » reste vraie.
 */
export { authRoutePath, readOAuthFailureClass, safeRedirectPath }

/**
 * La langue d'une requête entrante, telle que le module d'authentification la
 * reçoit.
 *
 * Les routes du module vivent sous `/api/modules/…` : elles ne portent **aucun**
 * préfixe de locale, et c'est voulu — les préfixer casserait chaque lien envoyé
 * par email. Leur langue se lit donc dans le cookie posé quand l'utilisateur a
 * suivi une URL de langue, et à défaut dans `Accept-Language`. C'est
 * `localeRouting.resolve` qui décide, la même fonction que l'écran : deux
 * lectures divergeraient, et l'email partirait dans une autre langue que la
 * page qui l'a demandé.
 */
const readRequestLocale = (request: Request): string => {
  const cookie = request.headers.get('cookie') ?? ''
  const match = new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([^;]*)`).exec(cookie)

  return localeRouting.resolve({
    pathname: '/',
    cookieLocale: match?.[1] === undefined ? null : decodeURIComponent(match[1]),
    acceptLanguage: request.headers.get('accept-language'),
  })
}

export interface AppAuthOptions {
  readonly env?: Env
}

let service: AuthService | null = null

export function appAuth(options: AppAuthOptions = {}): AuthService {
  if (service === null) {
    const env = options.env ?? getEnv()
    const { secret, appUrl } = resolveAuthConfig(env)

    service = configureAuth({
      db: getDatabase().db,
      mailer: createAppMailer(),
      secret,
      appUrl,
      // Les fournisseurs externes, **décidés par la configuration** et jamais
      // par le module : il ne lit aucune variable d'environnement, et une paire
      // incomplète a déjà arrêté le démarrage en nommant la variable absente.
      // Aucun fournisseur configuré est un état valide : il n'y a alors ni
      // bouton, ni route de rappel joignable.
      oauth: resolveOAuthConfig(env),
      // La langue des emails, transmise comme le reste : le module ne connaît
      // ni `config/i18n.ts`, ni le module `i18n`, ni le nom du cookie. Il reçoit
      // les locales servies, celle par défaut, et **comment** lire la langue
      // d'une requête entrante. Un destinataire sans requête — invitation,
      // guest checkout, liste d'attente — n'a aucune langue connue et reçoit
      // celle du site, par la même règle.
      locales: localeRouting.locales,
      defaultLocale: localeRouting.defaultLocale,
      readRequestLocale,
      // L'envoi de l'email de réinitialisation sort du temps de réponse, sans
      // quoi seul un compte **existant** le paie et son existence se lit au
      // chronomètre (`docs/security.md` §7). `after` est ce qui garantit que le
      // travail est malgré tout exécuté là où le processus est gelé dès la
      // réponse rendue — un `void promise` y perdrait l'email.
      runInBackground: (task) => {
        after(async () => {
          await task
        })
      },
      /**
       * **L'effacement de tous les modules activés** (s34), branché sur le
       * registre de l'application.
       *
       * Le module `auth` ne connaît pas le registre — il ne peut pas —, il
       * reçoit la fonction comme il reçoit son mailer. `lib/organizations.ts`
       * fait le même branchement pour le périmètre organisation : deux
       * appelants, un par périmètre du contrat.
       */
      purgeScope: async (scope) => await purgeModules(moduleRegistry, scope),
      /**
       * **Les organisations dont ce compte est le seul propriétaire** (critère
       * 6), lues par le module qui les porte.
       *
       * Module `organizations` coupé : la liste est vide, sans ouvrir de
       * connexion, et rien ne bloque une suppression de compte.
       *
       * **L'import est différé**, pour la raison exacte de `seatSync` :
       * `lib/organizations.ts` importe ce fichier-ci, et un import statique en
       * sens inverse fermerait le cycle.
       */
      soleOwnerships: async (userId) =>
        await (await import('./organizations')).organizations.soleOwnerships(userId),
      /**
       * **La revendication atomique du départ** (s34, constat F1 de la
       * troisième revue), branchée sur le même module et différée pour la même
       * raison de cycle.
       */
      releaseOrganizations: async (userId) =>
        await (await import('./organizations')).organizations.releaseOrganizations(userId),
      /**
       * **Le port d'émission de tâches** (s33) : l'effacement quitte la requête
       * quand le module `jobs` est activé, et s'exécute dedans quand il est
       * coupé. `lib/jobs.ts` décide, ce fichier ne le sait pas.
       *
       * Différé pour la même raison de cycle : `lib/jobs.ts` construit ses
       * adaptateurs à l'appel, jamais à l'import.
       */
      jobs: {
        emit: async (emission) => await (await import('./jobs')).appJobs().emit(emission),
      },
      /**
       * **Le port d'analytique** (s39) : le seul chemin par lequel ce module
       * mesure, et il est décidé ici.
       *
       * Module `analytics` coupé, ou aucune clé configurée : `lib/analytics.ts`
       * rend un port inerte, qui n'émet **aucun appel réseau**. Ce module ne
       * connaît pas la différence — c'est le critère 5, et la moitié du
       * critère 8.
       *
       * Différé pour la même raison de cycle que `jobs` : les ports sont
       * construits au premier appel, jamais à l'import.
       */
      analytics: {
        track: async (event) => await (await import('./analytics')).appAnalytics().track(event),
        page: async (view) => await (await import('./analytics')).appAnalytics().page(view),
      },
      /**
       * **L'export de ses données** (s35) — les deux choses que le module ne
       * peut pas se procurer.
       *
       * `collectArchive` traverse **tous les modules activés** : seul le
       * registre sait lesquels le sont, et `@repo/module-auth` ne peut pas
       * l'importer sans inverser la dépendance qui fait toute la modularité.
       * C'est le pendant exact de `purgeScope` ci-dessus — deux clés du contrat
       * que le socle déclarait et que rien n'appelait, branchées ici toutes les
       * deux.
       *
       * `authorizeOrganization` est la décision du module qui possède les
       * rôles, lue par `lib/organizations.ts` — la matrice ne se rejoue pas
       * ici. **L'import est différé**, pour la raison exacte de `soleOwnerships`.
       *
       * Le port de tâches n'est **pas** répété ici : l'export emprunte celui du
       * module (`jobs` ci-dessus), comme l'effacement de compte. Deux ports
       * pour deux tâches du même module seraient deux vérités sur « où
       * s'exécute une tâche ».
       */
      dataExport: {
        collectArchive: async (scope) => await buildDataExportArchive(moduleRegistry, scope),
        authorizeOrganization: async (input) =>
          await (await import('./organizations')).organizations.exportPermission(input),
      },
    })
  }

  return service
}

/**
 * Le crochet que le répartiteur de modules attend.
 *
 * Sans lui, toute route non publique répond 401 — c'est le sens fermé livré par
 * s03, et cette story est celle qui le branche.
 */
export const resolveModuleSession = (request: Request): Promise<ModuleSession | null> =>
  appAuth().resolveSession(request)

/**
 * La session de la requête en cours, pour un composant serveur.
 *
 * Les écrans n'ont pas de `Request` sous la main : Next leur donne les
 * en-têtes. La session est résolue par le **même** service que les routes —
 * une seconde lecture du cookie, ailleurs, serait une seconde vérité.
 */
export async function currentSession(): Promise<ModuleSession | null> {
  return await appAuth().resolveSession(await incomingRequest())
}

/**
 * La requête en cours, reconstruite pour le module.
 *
 * Les écrans n'ont pas de `Request` sous la main : Next leur donne les
 * en-têtes. Tout ce qui suit passe par le **même** service que les routes — une
 * seconde lecture du cookie, ailleurs, serait une seconde vérité.
 *
 * **Exportée depuis s37b2** : le back-office est fait de composants serveur, et
 * sa garde interroge le socle sur la **requête** — savoir si la session de
 * l'appelant est empruntée ne se lit pas autrement qu'en présentant son cookie.
 * Reconstruire cette requête dans `lib/admin.ts` en aurait fait une seconde
 * lecture, donc une seconde vérité.
 */
export async function incomingRequest(): Promise<Request> {
  return new Request(new URL('/', resolveAuthConfig(getEnv()).appUrl), {
    headers: await headers(),
  })
}

/** Ce que le shell a besoin de savoir de l'appelant, en une seule résolution. */
export interface Viewer {
  readonly session: ModuleSession | null
  readonly account: AccountView | null
  /**
   * **L'emprunteur de la session en cours**, ou `null` (s37b2, critère 5).
   *
   * Il arrive **avec** la session, dans la même résolution : la coquille en
   * tire son bandeau sans rien relire. Il était résolu à part — un second
   * `getSession` plus une lecture de la ligne de session — soit deux
   * allers-retours de base à chaque page authentifiée, dans toutes les
   * configurations, module `admin` coupé compris (revue de s37b2, F3).
   */
  readonly impersonatedBy: string | null
}

/**
 * L'appelant, vu par un composant serveur : sa session **et** son compte.
 *
 * Les deux ensemble, parce que le shell a besoin des deux et qu'une seconde
 * résolution serait une seconde lecture du cookie. La session reste celle que
 * le module rend — elle n'est jamais reconstruite à partir du compte, sans quoi
 * les rôles de s17 disparaîtraient en silence dans la navigation.
 *
 * Le compte lu est **celui de la session**, jamais un identifiant reçu d'un
 * paramètre : aucun chemin n'affiche le compte d'un autre (`docs/security.md`
 * §3).
 */
export async function currentViewer(): Promise<Viewer> {
  const auth = appAuth()
  const resolved = await auth.resolveActiveSession(await incomingRequest())
  const session = resolved?.session ?? null

  return {
    session,
    account: session === null ? null : await auth.useCases.viewAccount(session.userId),
    // **Aucune seconde lecture** : l'emprunt sort de la résolution ci-dessus.
    // Il vaut `null` pour un anonyme comme pour un compte non vérifié — ni
    // l'un ni l'autre n'a de session à emprunter.
    impersonatedBy: session === null ? null : (resolved?.impersonatedBy ?? null),
  }
}

/**
 * Les fournisseurs externes **montés**, pour les écrans qui affichent un bouton.
 *
 * La liste vient du service, donc de la configuration : un écran n'a aucune
 * branche sur « OAuth est-il activé ? », il rend une liste qui peut être vide.
 * C'est la même forme que la navigation dérivée du registre — pas de condition
 * dans un composant.
 */
export function oauthProviders(): readonly AnyOAuthProviderId[] {
  return appAuth().oauthProviders
}

/** Les moyens de connexion de l'appelant, sans jeton ni empreinte. */
export async function currentSignInMethods(): Promise<readonly DescribedSignInMethod[]> {
  const auth = appAuth()
  const session = await auth.resolveSession(await incomingRequest())

  return session === null ? [] : await auth.useCases.listSignInMethods(session.userId)
}

/**
 * Les passkeys de l'appelant, **sans clé publique ni identifiant de
 * justificatif** (s14).
 *
 * La lecture passe par un cas d'usage, pas par le point d'entrée
 * `list-user-passkeys` du greffon : celui-ci rend la ligne entière, et le
 * module énumère ses colonnes depuis s07.
 */
export async function currentPasskeys(): Promise<readonly DescribedPasskey[]> {
  const auth = appAuth()
  const session = await auth.resolveSession(await incomingRequest())

  return session === null ? [] : await auth.useCases.listPasskeys(session.userId)
}

/** Les sessions actives de l'appelant, la sienne en tête. Aucun jeton n'en sort. */
export async function currentSessions(): Promise<readonly DescribedSession[]> {
  const auth = appAuth()
  const request = await incomingRequest()
  const session = await auth.resolveSession(request)

  if (session === null) {
    return []
  }

  return await auth.useCases.listSessions({
    userId: session.userId,
    currentSessionId: await auth.resolveSessionId(request),
  })
}

/**
 * **Les demandes d'export de l'appelant — leur état, jamais leur lien** (s34b).
 *
 * La trace que le module rend porte trois champs : l'instant de la demande, son
 * état, l'échéance du lien. **Aucun jeton n'en sort**, et c'est la propriété qui
 * compte : le lien de téléchargement part par email et sa route est **publique**
 * (s35), donc le faire transiter par un écran le laisserait dans l'historique du
 * navigateur et dans les journaux d'accès.
 *
 * Le périmètre est celui du **compte de la session**, jamais un identifiant
 * reçu en paramètre (`docs/security.md` §3). Export non câblé — ou personne de
 * connecté — : aucune demande, sans toucher la base.
 */
export async function currentDataExportRequests(): Promise<readonly DataExportTrace[]> {
  const auth = appAuth()
  const session = await auth.resolveSession(await incomingRequest())
  const dataExport = auth.useCases.dataExport

  if (session === null || dataExport === null) {
    return []
  }

  return await dataExport.listDataExportTraces({ kind: 'user', userId: session.userId })
}
