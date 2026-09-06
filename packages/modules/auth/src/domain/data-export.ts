import { z } from 'zod'

/**
 * **L'export de ses données** (s35) — les règles, sans aucune primitive.
 *
 * Le `domain` ne connaît ni `node:crypto`, ni la base, ni HTTP
 * (`packages/modules/auth/AGENTS.md`) : ici vivent la **forme** du jeton, la
 * décision d'échéance et le **schéma exécutable de l'archive**. Le HMAC vit
 * dans `infrastructure/`, le magasin aussi.
 */

/**
 * **La durée de validité du lien, décidée par le serveur.**
 *
 * Vingt-quatre heures : assez pour qu'un email lu le soir serve le lendemain,
 * assez peu pour qu'une boîte compromise trois jours plus tard ne rende pas
 * l'archive. Le client ne la choisit pas et ne la porte pas — le lien ne
 * contient que l'identifiant de la demande et sa signature, et l'échéance est
 * relue en base à chaque téléchargement. Une échéance transportée dans l'URL
 * serait une échéance que l'appelant peut réécrire, la signature ne couvrant
 * jamais ce qu'on décide de ne pas signer.
 */
export const DATA_EXPORT_LINK_TTL_SECONDS = 24 * 60 * 60

/** L'identifiant du template d'email, partagé par le contrat et les cas d'usage. */
export const DATA_EXPORT_EMAIL_TEMPLATE = 'data-export-ready'

/**
 * L'identifiant de la tâche, et le champ de sa charge utile.
 *
 * Nommés ici pour la même raison que ceux de la purge de compte (s34) : le
 * contrat qui la déclare, le cas d'usage qui l'émet et la tâche qui la lit
 * doivent dire le même mot, et un mot recopié trois fois diverge.
 */
export const DATA_EXPORT_JOB = 'data-export'
export const DATA_EXPORT_JOB_FIELD = 'requestId'

/**
 * **La période du balayage, écrite une fois** — et c'est la seule occurrence de
 * ce nombre.
 *
 * Deux choses en dépendent, et elles doivent rester d'accord : l'expression
 * cron de la tâche (`module.ts`) et l'âge minimal d'une demande qu'elle
 * reprend. Les écrire séparément laissait une justification — « quinze minutes,
 * c'est-à-dire une période d'ordonnancement » — que rien ne reliait à
 * l'ordonnancement réel : elles pouvaient dériver en silence, dans les deux
 * sens. Les deux sont donc **dérivées d'ici**.
 *
 * **Ce que le démarrage refuse, et ce qu'il ne refuse pas** — mesuré sur
 * `assertJobSchedulesAreValid` et `cronMatches` (`@repo/core`), le 6 septembre
 * 2026, plutôt que supposé :
 *
 * - `0` produit un pas nul, **refusé** au démarrage en nommant la tâche ;
 * - une valeur au-delà de 59 produit un pas plus grand que le champ des
 *   minutes : elle est **acceptée**, et l'expression dégénère en « à la minute
 *   zéro de chaque heure ». Le balayage tourne alors moins souvent que la
 *   période annoncée, et le seuil d'âge devient **plus petit** que la période
 *   réelle.
 *
 * Ce second cas ne rouvre pas le défaut que le seuil ferme : la fenêtre
 * dangereuse est celle où le balayage reprend une demande **que le fournisseur
 * exécute encore**, c'est-à-dire les premières secondes. Un balayage plus
 * espacé la manque de plus loin ; il retarde seulement la reprise d'une demande
 * réellement restée en plan. La dérive est donc bornée du bon côté — mais elle
 * n'est refusée par personne, et c'est pour cela que ce nombre est écrit ici et
 * nulle part ailleurs.
 */
export const DATA_EXPORT_SWEEP_PERIOD_MINUTES = 15

/** L'expression cron de la tâche, dérivée de la période. */
export const DATA_EXPORT_SWEEP_SCHEDULE = `*/${DATA_EXPORT_SWEEP_PERIOD_MINUTES} * * * *`

/**
 * **L'âge minimal d'une demande que le balayage reprend** — une période.
 *
 * Le balayage et l'exécution du fournisseur n'ont pas la même clé
 * d'idempotence — l'un est déclenché par l'ordonnanceur, l'autre porte
 * l'identifiant de la demande —, donc rien ne les déduplique. Reprendre une
 * demande émise à l'instant, c'est la construire deux fois : mesuré, deux
 * emails partent. Ils portent le même lien et il fonctionne — le jeton dérive
 * de l'identifiant de la demande, il n'est pas tiré au hasard —, mais le
 * parcours d'export est payé deux fois et la personne reçoit deux fois le même
 * message.
 *
 * Une période d'ordonnancement, donc : au-delà, une demande encore en cours
 * n'est plus en train d'être exécutée, elle est restée en plan.
 */
export const DATA_EXPORT_SWEEP_MIN_AGE_SECONDS = DATA_EXPORT_SWEEP_PERIOD_MINUTES * 60

/** Le chemin de téléchargement, **public** : le lien part par email. */
export const DATA_EXPORT_DOWNLOAD_PATH = '/auth/data-export/download'

/** Le corps d'une demande. Le périmètre est déclaré, jamais deviné. */
export const dataExportRequestBodySchema = z.union([
  z.object({ scope: z.literal('user') }),
  z.object({ scope: z.literal('organization'), organizationId: z.string().min(1) }),
])

export type DataExportRequestBody = z.infer<typeof dataExportRequestBodySchema>

/**
 * **Le schéma de l'archive** — le critère 6, et il est exécutable.
 *
 * Il n'est pas là pour décorer : la route de téléchargement **valide ce qu'elle
 * sort de la base avant de le servir**. Une archive dont la forme ne correspond
 * pas à ce que ce schéma décrit n'est pas remise, et le schéma cesse donc
 * d'être une description pour devenir une garde de production.
 *
 * `payload` est volontairement ouvert : chaque module décide de ce qu'il rend,
 * et le contrat ne le contraint pas au-delà de « un objet JSON »
 * (`ModuleExportPayload`). Ce que ce schéma tient est **l'enveloppe** : la
 * version de format, la date, le périmètre, et une entrée par module activé
 * avec les catégories de données qu'il déclare.
 */
export const dataExportArchiveSchema = z.object({
  formatVersion: z.literal(1),
  /** ISO 8601, en UTC — l'instant où l'archive a été construite. */
  generatedAt: z.iso.datetime(),
  scope: z.object({
    kind: z.enum(['user', 'organization']),
    id: z.string().min(1),
  }),
  modules: z
    .array(
      z.object({
        id: z.string().min(1),
        dataCategories: z.array(z.string()),
        payload: z.record(z.string(), z.unknown()),
      }),
    )
    // Une archive sans module n'est pas une archive : elle passerait pour un
    // export réussi en ne contenant rien.
    .min(1),
})

export type DataExportArchiveDocument = z.infer<typeof dataExportArchiveSchema>

/**
 * Le jeton du lien : `<identifiant de la demande>.<signature>`.
 *
 * Il ne porte **ni échéance, ni périmètre, ni compte**. Tout ce qui décide vit
 * en base ; le jeton ne fait que désigner une ligne, et prouver qu'il vient de
 * nous.
 */
export const formatDataExportToken = (input: {
  readonly requestId: string
  readonly signature: string
}): string => `${input.requestId}.${input.signature}`

export interface ParsedDataExportToken {
  readonly requestId: string
  readonly signature: string
}

export function parseDataExportToken(token: string): ParsedDataExportToken | null {
  const separator = token.lastIndexOf('.')

  if (separator <= 0 || separator === token.length - 1) {
    return null
  }

  return {
    requestId: token.slice(0, separator),
    signature: token.slice(separator + 1),
  }
}

/**
 * Ce qu'une demande autorise, **au moment où on la lit**.
 *
 * Quatre issues, et aucune ne se confond : la demande n'est pas prête, son
 * archive a été oubliée, son échéance est passée, ou elle se sert. Le refus
 * d'un lien expiré est décidé **ici, côté serveur**, sur la colonne
 * `expires_at` — jamais sur une valeur venue de l'URL.
 */
export type DataExportDownloadDecision = 'serve' | 'not-ready' | 'expired' | 'forgotten'

export function decideDataExportDownload(input: {
  readonly request: {
    readonly status: 'pending' | 'ready' | 'failed'
    readonly expiresAt: Date | null
    readonly archive: unknown
  }
  readonly now: Date
}): DataExportDownloadDecision {
  if (input.request.status !== 'ready') {
    return 'not-ready'
  }

  if (input.request.expiresAt === null || input.request.expiresAt.getTime() <= input.now.getTime()) {
    return 'expired'
  }

  if (input.request.archive === null || input.request.archive === undefined) {
    return 'forgotten'
  }

  return 'serve'
}

/** L'échéance d'un lien émis maintenant. Le serveur la calcule, personne d'autre. */
export const dataExportExpiryFrom = (now: Date): Date =>
  new Date(now.getTime() + DATA_EXPORT_LINK_TTL_SECONDS * 1000)
