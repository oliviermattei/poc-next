import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  AUDIT_ATTEMPTS,
  AUDIT_BACKOFF,
  AUDIT_TIMEOUT_VARIABLE,
  auditBackoffMs,
  auditTimeoutMs,
  AuditExceptionError,
  AuditRunError,
  parseAuditExceptions,
  readAuditRun,
  selectBlockingAdvisories,
  type AuditAdvisory,
  type AuditException,
} from './audit-exceptions'

/**
 * `pnpm audit`, au seuil « élevé », bloquant (socle de sécurité, §6).
 *
 * La commande n'est pas `pnpm audit --audit-level=high` nu : il lui manque le
 * seul mécanisme qui empêche un contrôle bloquant d'être désactivé au premier
 * faux positif — une exception **datée et justifiée**. La logique de décision
 * vit dans `audit-exceptions.ts`, testée séparément ; ce fichier n'est que le
 * câblage : lire, exécuter, décider, sortir.
 */
const EXCEPTIONS_PATH = fileURLToPath(new URL('../.audit-exceptions.json', import.meta.url))

const loadExceptions = (now: Date): AuditException[] => {
  const raw: unknown = JSON.parse(readFileSync(EXCEPTIONS_PATH, 'utf8'))

  return parseAuditExceptions(raw, now)
}

const attemptAudit = (timeoutMs: number): AuditAdvisory[] => {
  const result = spawnSync('pnpm', ['audit', '--json'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    // **Le délai d'attente explicite** (`docs/reliability.md` §3) : sans lui, un
    // registre qui accepte la connexion et ne répond pas tient le job jusqu'à ce
    // qu'il coupe de lui-même — ~4 minutes, mesurées à la recherche de s48.
    timeout: timeoutMs,
  })

  if (result.error !== undefined) {
    const timedOut = (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT'

    throw new AuditRunError(
      timedOut
        ? `\`pnpm audit\` n'a pas répondu dans le délai d'attente de ${timeoutMs} ms.`
        : `\`pnpm audit\` n'a pas pu être lancé : ${result.error.message}`,
    )
  }

  // Le code de sortie et la forme du document sont lus ensemble : `pnpm audit`
  // sort en échec aussi bien quand il trouve un avis (nominal) que quand il n'a
  // pas pu auditer (`{"error":{…}}`). Les confondre revenait à traiter une
  // panne de registre comme une absence de vulnérabilité.
  return readAuditRun(result)
}

/**
 * Attente **bloquante**, et c'est délibéré : ce script est synchrone de bout en
 * bout (`spawnSync`), et le rendre asynchrone pour une attente qui n'existe que
 * sur la branche de panne ferait payer une réécriture à tout le reste.
 */
const sleep = (milliseconds: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

/**
 * L'audit, **rejoué tant qu'il n'a pas eu lieu** — et jamais au-delà.
 *
 * La boucle ne rattrape qu'`AuditRunError`, c'est-à-dire la seule branche « je
 * n'ai pas pu auditer » : une panne de registre, une sortie vide, un document
 * illisible, un `pnpm` qu'on n'a pas pu lancer. Un rapport d'avis lu correctement
 * **sort de la boucle au premier essai**, qu'il bloque ou non — le rejouer
 * reviendrait à espérer qu'il change d'avis, ce qui est la définition même d'un
 * vert obtenu par patience.
 */
const runPnpmAudit = (timeoutMs: number): AuditAdvisory[] => {
  let last: AuditRunError | undefined

  for (let attempt = 1; attempt <= AUDIT_ATTEMPTS; attempt += 1) {
    try {
      return attemptAudit(timeoutMs)
    } catch (error) {
      if (!(error instanceof AuditRunError)) {
        throw error
      }

      last = error

      if (attempt < AUDIT_ATTEMPTS) {
        const waitMs = auditBackoffMs(attempt, AUDIT_BACKOFF)

        console.error(
          `Audit — tentative ${attempt}/${AUDIT_ATTEMPTS} : ${error.message} ` +
            `Nouvel essai dans ${waitMs} ms.`,
        )

        sleep(waitMs)
      }
    }
  }

  throw new AuditRunError(
    `après ${AUDIT_ATTEMPTS} tentatives : ${last?.message ?? 'cause inconnue'}`,
  )
}

const main = (): number => {
  const now = new Date()

  let exceptions: AuditException[]

  try {
    exceptions = loadExceptions(now)
  } catch (error) {
    if (error instanceof AuditExceptionError) {
      console.error(`Audit refusé — ${error.message}`)

      return 1
    }

    throw error
  }

  let advisories: AuditAdvisory[]

  try {
    // Le délai est résolu **hors** de la boucle : une variable malformée est un
    // refus de configuration, pas une panne, et la rejouer trois fois n'y
    // changerait rien.
    advisories = runPnpmAudit(auditTimeoutMs(process.env[AUDIT_TIMEOUT_VARIABLE]))
  } catch (error) {
    if (error instanceof AuditRunError) {
      console.error(`Audit refusé — ${error.message}`)

      return 1
    }

    throw error
  }

  const blocking = selectBlockingAdvisories(advisories, exceptions)

  for (const exception of exceptions) {
    console.log(
      `Exception honorée jusqu'au ${exception.expires} : ${exception.advisory} — ${exception.reason}`,
    )
  }

  if (blocking.length === 0) {
    console.log(
      `Audit : ${advisories.length} avis remonté(s), aucun au seuil « élevé » qui ne soit couvert.`,
    )

    return 0
  }

  console.error('Audit : vulnérabilités bloquantes (seuil « élevé »)')

  for (const advisory of blocking) {
    console.error(`  - ${advisory.id} [${advisory.severity}] ${advisory.module} ${advisory.url ?? ''}`)
  }

  console.error(
    "Corriger la dépendance, ou ajouter dans `.audit-exceptions.json` une exception datée et justifiée.",
  )

  return 1
}

process.exit(main())
