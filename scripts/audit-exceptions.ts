/**
 * Exceptions d'audit : la seule façon de laisser passer une vulnérabilité.
 *
 * `pnpm audit` bloque au seuil « élevé » (socle de sécurité, §6). Sans soupape,
 * la première vulnérabilité non corrigeable en amont fait sauter le contrôle
 * entier — quelqu'un ajoute `|| true` et personne ne le remarque. Avec une
 * soupape sans date, l'exception devient permanente, ce qui revient au même en
 * plus discret.
 *
 * D'où la règle appliquée ici : une exception **nomme** l'avis, **justifie**
 * pourquoi elle est acceptable, et **expire**. Une exception sans date ou dont
 * la date est passée ne suspend rien : elle fait échouer la commande.
 */

export interface AuditException {
  /** Identifiant de l'avis : `GHSA-…` ou identifiant numérique de l'avis. */
  readonly advisory: string
  /** Paquet concerné, pour la lisibilité du fichier. */
  readonly package?: string
  /** Pourquoi c'est acceptable, et jusqu'à quoi on attend. */
  readonly reason: string
  /** Date d'expiration, `AAAA-MM-JJ`. */
  readonly expires: string
}

export interface AuditAdvisory {
  /** Identifiant affiché : le `GHSA-…` quand il existe. */
  readonly id: string
  /** Tous les identifiants acceptés en exception pour cet avis. */
  readonly aliases: readonly string[]
  readonly severity: string
  readonly module: string
  readonly url?: string
}

export class AuditExceptionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuditExceptionError'
  }
}

/**
 * L'audit n'a pas pu avoir lieu. Distinct d'« aucune vulnérabilité » : c'est la
 * confusion des deux qui désarmait le contrôle.
 */
export class AuditRunError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuditRunError'
  }
}

/** Sévérités qui bloquent au seuil « élevé ». */
export const BLOCKING_SEVERITIES = ['high', 'critical']

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

const describe = (value: unknown): string => JSON.stringify(value) ?? String(value)

/**
 * Lit et valide le fichier d'exceptions. Lève en nommant l'entrée fautive.
 *
 * Trois refus, et ils sont le cœur du mécanisme : pas de justification, pas de
 * date, date dépassée.
 */
export function parseAuditExceptions(raw: unknown, now: Date): AuditException[] {
  if (raw === null || typeof raw !== 'object' || !('exceptions' in raw)) {
    throw new AuditExceptionError(
      "Fichier d'exceptions d'audit invalide : un objet portant une clé `exceptions` est attendu.",
    )
  }

  const entries = (raw as { exceptions: unknown }).exceptions

  if (!Array.isArray(entries)) {
    throw new AuditExceptionError("La clé `exceptions` doit être une liste.")
  }

  return entries.map((entry, index) => {
    if (entry === null || typeof entry !== 'object') {
      throw new AuditExceptionError(`Exception n°${index + 1} : objet attendu, reçu ${describe(entry)}.`)
    }

    const candidate = entry as Partial<AuditException>
    const label = candidate.advisory ?? `n°${index + 1}`

    if (typeof candidate.advisory !== 'string' || candidate.advisory.trim() === '') {
      throw new AuditExceptionError(
        `Exception ${label} : la clé \`advisory\` doit nommer l'avis (GHSA-… ou identifiant).`,
      )
    }

    if (typeof candidate.reason !== 'string' || candidate.reason.trim() === '') {
      throw new AuditExceptionError(
        `Exception ${label} : une exception sans justification écrite n'est pas une exception.`,
      )
    }

    if (typeof candidate.expires !== 'string' || !ISO_DAY.test(candidate.expires)) {
      throw new AuditExceptionError(
        `Exception ${label} : date d'expiration absente ou malformée (attendu AAAA-MM-JJ). ` +
          "Une exception sans échéance est une suppression définitive du contrôle.",
      )
    }

    const expires = new Date(`${candidate.expires}T23:59:59.999Z`)

    if (Number.isNaN(expires.getTime())) {
      throw new AuditExceptionError(`Exception ${label} : date d'expiration invalide (${candidate.expires}).`)
    }

    if (expires.getTime() < now.getTime()) {
      throw new AuditExceptionError(
        `Exception ${label} : expirée le ${candidate.expires}. ` +
          "Corriger la dépendance, ou reprendre la décision et redater l'exception.",
      )
    }

    return {
      advisory: candidate.advisory,
      package: candidate.package,
      reason: candidate.reason,
      expires: candidate.expires,
    }
  })
}

/**
 * Avis qui doivent faire échouer la commande : ceux dont la sévérité atteint le
 * seuil et qu'aucune exception valide ne couvre.
 */
export function selectBlockingAdvisories(
  advisories: readonly AuditAdvisory[],
  exceptions: readonly AuditException[],
): AuditAdvisory[] {
  const excepted = new Set(exceptions.map((exception) => exception.advisory))

  return advisories.filter(
    (advisory) =>
      BLOCKING_SEVERITIES.includes(advisory.severity.toLowerCase()) &&
      !advisory.aliases.some((alias) => excepted.has(alias)),
  )
}

/**
 * Normalise la sortie `pnpm audit --json` en une liste d'avis.
 *
 * Le format est celui hérité de npm : un dictionnaire `advisories` indexé par
 * identifiant numérique, chaque entrée portant son `github_advisory_id`. Les
 * deux identifiants sont acceptés en exception : c'est le second qu'on lit dans
 * une alerte, c'est le premier que la commande affiche.
 */
export function readAuditReport(report: unknown): AuditAdvisory[] {
  if (report === null || typeof report !== 'object') {
    return []
  }

  const advisories = (report as { advisories?: Record<string, unknown> }).advisories ?? {}

  return Object.entries(advisories).flatMap(([id, value]) => {
    if (value === null || typeof value !== 'object') {
      return []
    }

    const advisory = value as {
      severity?: string
      module_name?: string
      github_advisory_id?: string
      url?: string
    }

    return [
      {
        id: advisory.github_advisory_id ?? id,
        aliases: [id, advisory.github_advisory_id].filter(
          (alias): alias is string => alias !== undefined,
        ),
        severity: advisory.severity ?? 'unknown',
        module: advisory.module_name ?? 'inconnu',
        url: advisory.url,
      },
    ]
  })
}

export interface AuditRun {
  /** Code de sortie de `pnpm audit`, `null` si le processus a été tué. */
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
}

/**
 * Interprète l'issue complète de `pnpm audit --json` : le rapport, ou un refus.
 *
 * `readAuditReport` ne sait que normaliser un document bien formé ; appelée sur
 * autre chose, elle rend une liste vide, ce qui se lit « aucune vulnérabilité ».
 * Or `pnpm audit` répond à une panne — lockfile absent, registre indisponible,
 * limitation de débit — par `{"error":{…}}` et un code 1. Sans la garde
 * ci-dessous, une coupure réseau en CI rendait l'étape verte sans qu'aucun
 * audit n'ait eu lieu : **un contrôle bloquant qui se désactive au moment
 * précis où il ne peut plus vérifier**.
 *
 * La subtilité est qu'un code non nul est aussi le comportement *nominal* :
 * `pnpm audit` sort en échec dès qu'il trouve un avis, quelle que soit sa
 * sévérité — c'est ce script qui décide du seuil, pas le code de sortie. Le
 * discriminant n'est donc pas le code, c'est la **présence d'un rapport** :
 * un `advisories` absent joint à un code non nul signifie que rien n'a été
 * audité.
 */
export function readAuditRun(run: AuditRun): AuditAdvisory[] {
  const stdout = run.stdout.trim()
  const detail = run.stderr.trim() === '' ? `code ${String(run.status)}` : run.stderr.trim()

  if (stdout === '') {
    throw new AuditRunError(`\`pnpm audit\` n'a rien renvoyé (${detail}).`)
  }

  let report: unknown

  try {
    report = JSON.parse(stdout)
  } catch {
    throw new AuditRunError(
      `Sortie de \`pnpm audit --json\` illisible (${detail}) : ${stdout.slice(0, 200)}`,
    )
  }

  if (report === null || typeof report !== 'object') {
    throw new AuditRunError(`Sortie de \`pnpm audit --json\` illisible (${detail}) : objet attendu.`)
  }

  const failure = (report as { error?: { code?: unknown; message?: unknown } }).error

  if (failure !== undefined) {
    throw new AuditRunError(
      `\`pnpm audit\` a échoué : ${String(failure.code ?? 'erreur')} — ${String(failure.message ?? detail)}`,
    )
  }

  if (!('advisories' in report) && run.status !== 0) {
    throw new AuditRunError(
      `\`pnpm audit\` n'a pas produit de rapport (${detail}). ` +
        "Un audit qui n'a pas eu lieu n'est pas un audit sans vulnérabilité.",
    )
  }

  return readAuditReport(report)
}
