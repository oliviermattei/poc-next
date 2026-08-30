import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  parseAuditExceptions,
  readAuditReport,
  readAuditRun,
  selectBlockingAdvisories,
  type AuditAdvisory,
} from '../scripts/audit-exceptions'

const NOW = new Date('2026-08-30T12:00:00.000Z')

const exception = (overrides: Record<string, unknown> = {}) => ({
  exceptions: [
    {
      advisory: 'GHSA-1111-2222-3333',
      package: 'exemple',
      reason: 'Corrigé en amont, montée de version prévue avec la story s07.',
      expires: '2026-12-31',
      ...overrides,
    },
  ],
})

const advisory = (overrides: Partial<AuditAdvisory> = {}): AuditAdvisory => ({
  id: 'GHSA-1111-2222-3333',
  aliases: ['1102341', 'GHSA-1111-2222-3333'],
  severity: 'high',
  module: 'exemple',
  ...overrides,
})

/**
 * Un audit bloquant sans soupape saute au premier faux positif ; une soupape
 * sans échéance est une suppression définitive du contrôle, en plus discret.
 * Les trois refus ci-dessous sont ce qui distingue les deux.
 */
describe('exceptions d’audit', () => {
  it('refuse une exception sans date d’expiration', () => {
    const { expires: _removed, ...withoutExpiry } = exception().exceptions[0] as Record<
      string,
      unknown
    >

    expect(() => parseAuditExceptions({ exceptions: [withoutExpiry] }, NOW)).toThrowError(
      /date d'expiration absente ou malformée/,
    )
  })

  it('refuse une date d’expiration passée, en nommant l’avis', () => {
    expect(() => parseAuditExceptions(exception({ expires: '2026-08-29' }), NOW)).toThrowError(
      /GHSA-1111-2222-3333 : expirée le 2026-08-29/,
    )
  })

  it('refuse une exception sans justification', () => {
    expect(() => parseAuditExceptions(exception({ reason: '  ' }), NOW)).toThrowError(
      /sans justification/,
    )
  })

  it('refuse une date qui n’est pas au format AAAA-MM-JJ', () => {
    expect(() => parseAuditExceptions(exception({ expires: '31/12/2026' }), NOW)).toThrowError(
      /AAAA-MM-JJ/,
    )
  })

  it('accepte une exception nommée, justifiée et non expirée', () => {
    expect(parseAuditExceptions(exception(), NOW)).toEqual([
      {
        advisory: 'GHSA-1111-2222-3333',
        package: 'exemple',
        reason: 'Corrigé en amont, montée de version prévue avec la story s07.',
        expires: '2026-12-31',
      },
    ])
  })

  it('accepte le jour même de l’expiration, pas le lendemain', () => {
    expect(() => parseAuditExceptions(exception({ expires: '2026-08-30' }), NOW)).not.toThrow()
    expect(() => parseAuditExceptions(exception({ expires: '2026-08-29' }), NOW)).toThrow()
  })
})

describe('sélection des avis bloquants', () => {
  const valid = parseAuditExceptions(exception(), NOW)

  it('bloque un avis « élevé » que rien ne couvre', () => {
    expect(selectBlockingAdvisories([advisory({ id: 'GHSA-autre', aliases: ['GHSA-autre'] })], valid)).toHaveLength(1)
  })

  it('bloque un avis « critique »', () => {
    expect(
      selectBlockingAdvisories(
        [advisory({ id: 'GHSA-autre', aliases: ['GHSA-autre'], severity: 'critical' })],
        valid,
      ),
    ).toHaveLength(1)
  })

  it('laisse passer sous le seuil : « modéré » ne bloque pas', () => {
    expect(
      selectBlockingAdvisories(
        [advisory({ id: 'GHSA-autre', aliases: ['GHSA-autre'], severity: 'moderate' })],
        valid,
      ),
    ).toEqual([])
  })

  it('laisse passer l’avis couvert par une exception valide', () => {
    expect(selectBlockingAdvisories([advisory()], valid)).toEqual([])
  })

  it('ne couvre que l’avis nommé : une exception n’est jamais globale', () => {
    const blocking = selectBlockingAdvisories(
      [advisory(), advisory({ id: 'GHSA-9999', aliases: ['GHSA-9999'] })],
      valid,
    )

    expect(blocking.map((entry) => entry.id)).toEqual(['GHSA-9999'])
  })

  it('reconnaît aussi l’identifiant numérique de l’avis', () => {
    const numeric = parseAuditExceptions(exception({ advisory: '1102341' }), NOW)

    expect(selectBlockingAdvisories([advisory()], numeric)).toEqual([])
  })
})

/**
 * Le format lu est celui que `pnpm audit --json` produit réellement, relevé sur
 * la sortie de la commande dans ce dépôt : un dictionnaire indexé par
 * identifiant numérique, chaque entrée portant `severity`, `module_name` et
 * `github_advisory_id`.
 */
describe('lecture du rapport `pnpm audit --json`', () => {
  it('extrait sévérité, module et les deux identifiants', () => {
    const report = {
      advisories: {
        '1102341': {
          severity: 'moderate',
          module_name: 'esbuild',
          github_advisory_id: 'GHSA-67mh-4wv8-2f99',
          url: 'https://github.com/advisories/GHSA-67mh-4wv8-2f99',
        },
      },
    }

    expect(readAuditReport(report)).toEqual([
      {
        id: 'GHSA-67mh-4wv8-2f99',
        aliases: ['1102341', 'GHSA-67mh-4wv8-2f99'],
        severity: 'moderate',
        module: 'esbuild',
        url: 'https://github.com/advisories/GHSA-67mh-4wv8-2f99',
      },
    ])
  })

  it('ne bloque pas sur un rapport vide', () => {
    expect(readAuditReport({ advisories: {} })).toEqual([])
  })
})

describe('fichier `.audit-exceptions.json` du dépôt', () => {
  it('est lisible et à jour — une exception périmée fait échouer `pnpm run audit`', () => {
    const raw: unknown = JSON.parse(
      readFileSync(fileURLToPath(new URL('../.audit-exceptions.json', import.meta.url)), 'utf8'),
    )

    expect(() => parseAuditExceptions(raw, new Date())).not.toThrow()
  })
})

/**
 * L'issue de `pnpm audit --json`, et pas seulement sa sortie.
 *
 * C'est le finding major de la revue de s02 : le script n'inspectait que
 * l'échec de spawn. Or `pnpm audit` répond à une panne — pas de lockfile,
 * registre indisponible, limitation de débit — par `{"error":{…}}` et un code
 * 1. Sans `advisories`, la lecture rendait une liste vide et la commande
 * concluait « aucun avis au seuil élevé » : **un contrôle bloquant qui se
 * désarme au moment précis où il ne peut plus vérifier**.
 *
 * La difficulté est qu'un code non nul est aussi le comportement *nominal* :
 * `pnpm audit` sort en échec dès qu'il trouve une vulnérabilité. Les deux
 * branches sont donc épinglées ensemble — refuser la panne sans refuser le
 * cas normal.
 */
describe('issue de `pnpm audit --json`', () => {
  const report = {
    advisories: {
      '1102341': {
        severity: 'moderate',
        module_name: 'esbuild',
        github_advisory_id: 'GHSA-67mh-4wv8-2f99',
      },
    },
  }

  it('refuse un rapport portant `error`, en nommant la cause', () => {
    // Sortie réelle de `pnpm audit --json` dans un répertoire sans lockfile.
    expect(() =>
      readAuditRun({
        status: 1,
        stdout: JSON.stringify({
          error: {
            code: 'ERR_PNPM_AUDIT_NO_LOCKFILE',
            message: 'No pnpm-lock.yaml found: Cannot audit a project without a lockfile',
          },
        }),
        stderr: '',
      }),
    ).toThrowError(/ERR_PNPM_AUDIT_NO_LOCKFILE/)
  })

  it('refuse un code non nul sans `advisories` — rien n’a été audité', () => {
    expect(() =>
      readAuditRun({ status: 1, stdout: JSON.stringify({ metadata: {} }), stderr: 'ECONNRESET' }),
    ).toThrowError(/n'a pas produit de rapport/)
  })

  it('accepte le code non nul nominal : `pnpm audit` échoue dès qu’il trouve un avis', () => {
    expect(readAuditRun({ status: 1, stdout: JSON.stringify(report), stderr: '' })).toHaveLength(1)
  })

  it('accepte un rapport vide sorti en succès', () => {
    expect(
      readAuditRun({ status: 0, stdout: JSON.stringify({ advisories: {}, metadata: {} }), stderr: '' }),
    ).toEqual([])
  })

  it('refuse une sortie vide', () => {
    expect(() => readAuditRun({ status: 1, stdout: '  \n', stderr: 'oom' })).toThrowError(
      /n'a rien renvoyé/,
    )
  })

  it('refuse une sortie qui n’est pas du JSON', () => {
    expect(() =>
      readAuditRun({ status: 0, stdout: '<html>502 Bad Gateway</html>', stderr: '' }),
    ).toThrowError(/illisible/)
  })
})

/**
 * Le câblage, et non plus la règle : `scripts/audit.ts` sort-il en échec ?
 *
 * Les cas ci-dessus prouvent la décision ; celui-ci prouve qu'elle est
 * branchée. C'est exactement là que le défaut vivait — la règle de lecture
 * était correcte, le script ne lui passait ni le code de sortie ni la forme du
 * document. Un `pnpm` stubbé sur le `PATH` fait répondre au script ce qu'on
 * veut, sans réseau.
 */
describe('`scripts/audit.ts` face à un `pnpm audit` en panne', () => {
  const SCRIPT = fileURLToPath(new URL('../scripts/audit.ts', import.meta.url))
  const TSX = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url))

  const runWithStubbedPnpm = (stdout: string, exitCode: number) => {
    const directory = mkdtempSync(join(tmpdir(), 'audit-stub-'))
    const stub = join(directory, 'pnpm')

    writeFileSync(stub, `#!/bin/sh\ncat <<'PNPM_JSON'\n${stdout}\nPNPM_JSON\nexit ${exitCode}\n`)
    chmodSync(stub, 0o755)

    return spawnSync(TSX, [SCRIPT], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${directory}:${process.env.PATH ?? ''}` },
    })
  }

  it('sort en échec quand l’audit lui-même a échoué', () => {
    const result = runWithStubbedPnpm(
      JSON.stringify({
        error: { code: 'ERR_PNPM_AUDIT_NO_LOCKFILE', message: 'No pnpm-lock.yaml found' },
      }),
      1,
    )

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toContain('ERR_PNPM_AUDIT_NO_LOCKFILE')
    // Le message trompeur d'origine : « 0 avis remonté, aucun au seuil élevé ».
    expect(result.stdout).not.toContain('aucun au seuil')
  })

  it('sort en succès sur un avis sous le seuil, malgré le code non nul de pnpm', () => {
    const result = runWithStubbedPnpm(
      JSON.stringify({
        advisories: {
          '1102341': {
            severity: 'moderate',
            module_name: 'esbuild',
            github_advisory_id: 'GHSA-67mh-4wv8-2f99',
          },
        },
      }),
      1,
    )

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })
})
