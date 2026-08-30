import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  parseAuditExceptions,
  readAuditReport,
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
