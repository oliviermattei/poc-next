import type { ModuleScope } from '@repo/core'

import {
  DATA_EXPORT_EMAIL_TEMPLATE,
  DATA_EXPORT_JOB,
  DATA_EXPORT_JOB_FIELD,
  DATA_EXPORT_SWEEP_MIN_AGE_SECONDS,
  dataExportArchiveSchema,
  dataExportExpiryFrom,
  decideDataExportDownload,
  type DataExportArchiveDocument,
} from '../domain/data-export'
import { describeSecurityEvent } from '../domain/security-event'
import type {
  AuthUserRepository,
  Jobs,
  DataExportDependencies,
  DataExportTrace,
  Mailer,
  SecurityLog,
} from './ports'

/**
 * **L'export de ses données, de la demande au lien** (s35).
 *
 * Ce fichier est le seul endroit où les six pièces se rencontrent : la
 * revendication, la construction, la signature, l'échéance, l'email et
 * l'oubli. Il ne connaît ni la base, ni HTTP, ni le registre — tout lui est
 * donné (`DataExportDependencies`).
 *
 * ## Trois décisions, écrites ici parce que c'est ici qu'elles s'appliquent
 *
 * 1. **une archive partielle n'est jamais livrée.** Un module qui refuse fait
 *    échouer la demande, qui est **nommée en base** (`failed_module_id`) et
 *    reste rejouable : redemander repart de zéro. La personne qui exerce sa
 *    portabilité ne peut pas savoir ce qui manquerait à une archive amputée ;
 * 2. **l'archive vit dans la base de l'application**, dans la ligne de la
 *    demande. Elle hérite donc de la purge du compte — la cascade de
 *    `requested_by` — et de celle du périmètre. Un seau d'objets n'a pas de
 *    clé étrangère : l'archive y aurait survécu à l'effacement du compte ;
 * 3. **l'archive est oubliée à l'échéance**, avec son empreinte de jeton.
 *    L'expiration n'est pas qu'un refus : ce qui n'est plus téléchargeable n'a
 *    plus de raison d'être conservé.
 */

export type RequestDataExportOutcome =
  | { readonly status: 'accepted'; readonly requestId: string }
  | { readonly status: 'already-pending' }
  /** Membre de l'organisation, mais pas propriétaire (`docs/security.md` §3). */
  | { readonly status: 'forbidden' }
  /** Non-membre, organisation inconnue, ou export non câblé : **404**, jamais 403. */
  | { readonly status: 'not-found' }
  /**
   * La mise en file a été refusée : rien ne construira l'archive.
   *
   * Le dire vaut mieux que rendre un accusé de réception pour un travail que
   * personne ne fera — c'est la décision de s34 sur le même port, et la demande
   * est close pour que le périmètre reste demandable.
   */
  | { readonly status: 'unavailable' }

export type DataExportDownloadOutcome =
  | { readonly status: 'served'; readonly archive: DataExportArchiveDocument }
  /** Signature fausse, jeton illisible, demande inconnue : indiscernables. */
  | { readonly status: 'invalid' }
  | { readonly status: 'expired' }
  | { readonly status: 'not-ready' }
  /** L'archive stockée ne correspond pas au schéma documenté : on ne sert pas. */
  | { readonly status: 'malformed' }

export interface DataExportUseCases {
  /** Revendique une demande pour ce périmètre, ou dit pourquoi elle est refusée. */
  requestDataExport(input: {
    readonly userId: string
    readonly scope: ModuleScope
  }): Promise<RequestDataExportOutcome>
  /**
   * Construit l'archive d'une demande, puis envoie le lien.
   *
   * **Rejouable sans effet supplémentaire** : une demande qui n'est plus en
   * cours n'est pas reconstruite, et l'email ne repart pas
   * (`docs/reliability.md` §1).
   */
  buildDataExport(input: { readonly requestId: string }): Promise<void>
  /** Le lien, vérifié puis servi. La signature est contrôlée avant toute lecture. */
  downloadDataExport(input: { readonly token: string }): Promise<DataExportDownloadOutcome>
  /**
   * Le balayage : les archives échues sont oubliées, les demandes restées en
   * cours **depuis assez longtemps** sont reprises. C'est ce que la tâche
   * planifiée exécute quand elle n'est appelée pour aucune demande précise,
   * donc **seulement quand le module `jobs` est activé**.
   *
   * Ce qu'il reprend est une demande mise en file avec succès et jamais
   * exécutée — événement perdu, processus tombé. Une mise en file **refusée**
   * est close sur place et ne repasse jamais par ici.
   */
  sweepDataExports(): Promise<{ readonly forgotten: number; readonly rebuilt: number }>
  /** Les traces d'export du périmètre, telles que l'export du contrat les rend. */
  listDataExportTraces(scope: ModuleScope): Promise<readonly DataExportTrace[]>
  /** Efface les demandes du périmètre — appelée par la purge du contrat. */
  purgeDataExports(scope: ModuleScope): Promise<void>
}

export interface DataExportUseCasesDependencies {
  readonly dataExport: DataExportDependencies
  /**
   * **Le port de tâches du module** (s33), celui-là même que l'effacement de
   * compte emprunte (s34).
   *
   * Il n'y en a qu'un : deux ports pour deux tâches du même module seraient
   * deux vérités sur « où s'exécute une tâche ». Module `jobs` activé,
   * l'émission part chez le fournisseur ; coupé, le port du point de
   * composition l'exécute dans la requête appelante — le module ne connaît pas
   * la différence, et c'est le critère 2.
   */
  readonly jobs: Jobs
  readonly users: AuthUserRepository
  readonly mailer: Mailer
  readonly log: SecurityLog
  readonly emailLocaleFor: (knownLocale: string | null | undefined) => string
  /** L'URL absolue du lien de téléchargement, construite par les cas d'usage d'`auth`. */
  readonly downloadUrl: (token: string) => string
  readonly now: () => Date
}

export function createDataExportUseCases(
  dependencies: DataExportUseCasesDependencies,
): DataExportUseCases {
  const { dataExport, jobs, users, mailer, log, emailLocaleFor, downloadUrl, now } = dependencies
  const { requests, signer, collectArchive, authorizeOrganization, generateId } = dataExport

  const buildDataExport: DataExportUseCases['buildDataExport'] = async ({ requestId }) => {
    const request = await requests.findById(requestId)

    // Rejouée sur une demande déjà servie — ou effacée — la tâche ne fait rien.
    if (request === null || request.status !== 'pending') {
      return
    }

    const collected = await collectArchive(request.scope)
    const at = now()

    if (!collected.ok) {
      await requests.markFailed({ id: requestId, moduleId: collected.failed, at })
      log(
        describeSecurityEvent({
          event: 'auth.data_export_failed',
          actor: { userId: request.requestedBy },
          details: { module: collected.failed },
        }),
      )

      return
    }

    const token = signer.issue(requestId)

    await requests.markReady({
      id: requestId,
      tokenDigest: signer.digest(token),
      expiresAt: dataExportExpiryFrom(at),
      // Sérialisée telle qu'elle sera relue : un `Date` traversant JSON en
      // sortirait en chaîne, et l'archive servie ne serait pas celle qui a été
      // validée.
      archive: JSON.parse(JSON.stringify(collected.archive)) as unknown,
      at,
    })

    const account = await users.findById(request.requestedBy)

    if (account === null) {
      return
    }

    const result = await mailer.send({
      to: account.email,
      template: `auth.${DATA_EXPORT_EMAIL_TEMPLATE}`,
      locale: emailLocaleFor(null),
      data: { url: downloadUrl(token) },
    })

    log(
      describeSecurityEvent({
        event: 'auth.data_export_ready',
        actor: { userId: request.requestedBy },
        details: { delivery: result.ok ? 'sent' : result.error.code },
      }),
    )
  }

  return {
    requestDataExport: async ({ userId, scope }) => {
      if (scope.kind === 'organization') {
        const role = await authorizeOrganization({ userId, organizationId: scope.organizationId })

        // **404 et non 403 pour un non-membre** (`docs/security.md` §3) :
        // l'existence de l'organisation d'autrui ne se confirme pas. Le membre
        // à qui la matrice refuse l'action, lui, sait déjà qu'elle existe : il
        // reçoit 403.
        if (role === 'unknown') {
          return { status: 'not-found' }
        }

        if (role === 'refused') {
          return { status: 'forbidden' }
        }
      }

      /**
       * **L'oubli des archives échues, ici et pas seulement dans le balayage.**
       *
       * Le balayage périodique n'existe que si le module `jobs` est activé :
       * son unique déclencheur est l'ordonnanceur. Module coupé — et
       * `config/profiles.ts` le coupe —, la tâche n'est jamais appelée sans
       * `requestId`, donc une archive échue restait en base indéfiniment,
       * `status = ready`, avec la copie complète des données d'une personne. Le
       * constat de la revue de s35, mesuré.
       *
       * Une garantie de conservation ne peut pas dépendre d'un module
       * optionnel : elle est donc accrochée au seul geste qui existe dans
       * **toutes** les configurations, la demande d'export. L'effacement porte
       * sur **toutes** les archives échues, pas sur celles du demandeur — c'est
       * ce qui fait qu'une personne partie n'attend pas son propre retour.
       *
       * Ce que cela ne couvre pas, et il faut le dire : un dépôt où plus
       * personne ne demande d'export, `jobs` coupé, garde ses archives échues
       * jusqu'à l'effacement du compte. Sans ordonnanceur, il n'existe aucun
       * moment où du code s'exécute.
       */
      await requests.forgetExpiredArchives(now())

      const requestId = generateId()
      const claimed = await requests.claim({ id: requestId, scope, requestedBy: userId, at: now() })

      if (claimed === 'already-pending') {
        return { status: 'already-pending' }
      }

      /**
       * **Le critère 2, et il n'a qu'un chemin.**
       *
       * Le port de tâches décide : module `jobs` activé, l'archive se construit
       * hors de la requête ; coupé, le port du point de composition l'exécute
       * **dans** la requête appelante (`apps/web/lib/jobs.ts`). Le module ne
       * sait pas lequel des deux le sert, et c'est ce que le port existe pour
       * garantir — il n'y a donc pas de second repli écrit ici.
       */
      const emitted = await jobs.emit({
        job: `auth.${DATA_EXPORT_JOB}`,
        key: requestId,
        // Des **références**, jamais une donnée personnelle : la charge utile
        // est écrite chez le fournisseur et relue à l'exécution
        // (`docs/security.md` §5).
        data: { [DATA_EXPORT_JOB_FIELD]: requestId },
      })

      if (!emitted.ok) {
        /**
         * **La demande est close, pas différée.**
         *
         * Rien ne construira l'archive et **le balayage ne la reprendra pas** :
         * il ne rend que les demandes encore `pending`, et celle-ci n'en est
         * plus une. La laisser « en cours » bloquerait le périmètre derrière une
         * demande qui n'aboutira jamais, et le critère 7 refuserait la suivante.
         * C'est la décision de s34 sur le même port, avec sa conséquence propre
         * à l'export — le refus n'est celui d'aucun module, donc
         * `failed_module_id` reste vide.
         */
        await requests.markFailed({ id: requestId, moduleId: null, at: now() })
        log(
          describeSecurityEvent({
            event: 'auth.data_export_refused',
            actor: { userId },
            details: { class: emitted.error.code },
          }),
        )

        return { status: 'unavailable' }
      }

      return { status: 'accepted', requestId }
    },

    buildDataExport,

    downloadDataExport: async ({ token }) => {
      /**
       * **La signature, avant tout effet.**
       *
       * Aucune lecture de base tant qu'elle n'est pas vérifiée : un jeton forgé
       * ne fait pas travailler le serveur et ne peut pas servir à énumérer des
       * identifiants de demandes.
       */
      const requestId = signer.verify(token)

      if (requestId === null) {
        return { status: 'invalid' }
      }

      const request = await requests.findById(requestId)

      if (request === null || request.tokenDigest !== signer.digest(token)) {
        return { status: 'invalid' }
      }

      const decision = decideDataExportDownload({ request, now: now() })

      if (decision === 'expired' || decision === 'forgotten') {
        return { status: 'expired' }
      }

      if (decision === 'not-ready') {
        return { status: 'not-ready' }
      }

      /**
       * **Le schéma est une garde, pas une description** (critère 6).
       *
       * Ce qui sort de la base est validé contre le schéma documenté avant
       * d'être remis. Une archive qui n'y correspond pas n'est pas servie —
       * sans quoi « un schéma documenté décrit l'archive » serait une phrase
       * que rien n'exécute.
       */
      const parsed = dataExportArchiveSchema.safeParse(request.archive)

      return parsed.success
        ? { status: 'served', archive: parsed.data }
        : { status: 'malformed' }
    },

    sweepDataExports: async () => {
      const at = now()
      const forgotten = await requests.forgetExpiredArchives(at)
      // **Seulement ce qui est resté en plan.** Une demande émise à l'instant est
      // peut-être en cours d'exécution chez le fournisseur, et rien ne
      // déduplique les deux chemins : la reprendre construit l'archive deux
      // fois et envoie deux fois le même email.
      const pending = await requests.listPending(
        new Date(at.getTime() - DATA_EXPORT_SWEEP_MIN_AGE_SECONDS * 1000),
      )

      for (const request of pending) {
        await buildDataExport({ requestId: request.id })
      }

      return { forgotten, rebuilt: pending.length }
    },

    listDataExportTraces: async (scope) => await requests.listForScope(scope),

    purgeDataExports: async (scope) => {
      await requests.deleteScope(scope)
    },
  }
}
