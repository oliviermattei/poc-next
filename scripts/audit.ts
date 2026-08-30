import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
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

const runPnpmAudit = (): AuditAdvisory[] => {
  const result = spawnSync('pnpm', ['audit', '--json'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })

  if (result.error !== undefined) {
    throw new AuditRunError(`\`pnpm audit\` n'a pas pu être lancé : ${result.error.message}`)
  }

  // Le code de sortie et la forme du document sont lus ensemble : `pnpm audit`
  // sort en échec aussi bien quand il trouve un avis (nominal) que quand il n'a
  // pas pu auditer (`{"error":{…}}`). Les confondre revenait à traiter une
  // panne de registre comme une absence de vulnérabilité.
  return readAuditRun(result)
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
    advisories = runPnpmAudit()
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
