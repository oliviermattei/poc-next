import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  AUDIT_ATTEMPTS,
  AUDIT_TIMEOUT_MS,
  AUDIT_TIMEOUT_VARIABLE,
  auditBackoffMs,
  auditTimeoutMs,
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

describe('l’attente entre deux tentatives d’audit', () => {
  const politique = { baseMs: 500, maxMs: 4_000 }

  it('croît exponentiellement, disperse, et plafonne', () => {
    // Sans dispersion, toutes les instances qui échouent sur la même panne
    // rejouent à la même milliseconde ; sans plafond, l'attente se paie dans le
    // temps d'un job (`docs/reliability.md` §3).
    expect(auditBackoffMs(1, { ...politique, random: () => 1 })).toBe(500)
    expect(auditBackoffMs(2, { ...politique, random: () => 1 })).toBe(1_000)
    expect(auditBackoffMs(9, { ...politique, random: () => 1 })).toBe(4_000)

    // La dispersion « à moitié » : jamais une reprise immédiate, qui viderait le
    // recul de son sens dès le premier essai.
    expect(auditBackoffMs(1, { ...politique, random: () => 0 })).toBe(250)
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

  /**
   * **La reprise, et ce qu'elle ne doit jamais rejouer** (s48).
   *
   * Constat d'ouverture de s48 : un `ERR_SOCKET_TIMEOUT` du registre faisait
   * rougir la porte du premier coup, et une CI rouge pour une panne réseau finit
   * par s'ignorer — c'est le chemin par lequel un contrôle bloquant devient
   * décoratif. La reprise s'applique donc à la branche « l'audit n'a pas eu
   * lieu », et à elle seule : rejouer un document d'avis valide reviendrait à le
   * rendre vert à force de patience.
   *
   * Le double remplace le **réseau** — un `pnpm` posé sur le `PATH` —, jamais la
   * logique de décision. Chaque appel étant un processus, le compteur vit sur le
   * disque.
   */
  const runWithScriptedPnpm = (
    responses: readonly { readonly stdout: string; readonly exitCode: number }[],
  ) => {
    const directory = mkdtempSync(join(tmpdir(), 'audit-stub-'))
    const counter = join(directory, 'appels')

    responses.forEach((response, index) => {
      writeFileSync(join(directory, `reponse-${index + 1}.json`), response.stdout)
      writeFileSync(join(directory, `reponse-${index + 1}.code`), String(response.exitCode))
    })

    const stub = join(directory, 'pnpm')

    writeFileSync(
      stub,
      [
        '#!/bin/sh',
        `n=$(cat "${counter}" 2>/dev/null || echo 0)`,
        'n=$((n+1))',
        `echo "$n" > "${counter}"`,
        // Au-delà des réponses écrites, la dernière est rejouée : un cas qui veut
        // épuiser les tentatives n'a pas à savoir combien il y en a.
        `f="${directory}/reponse-$n"`,
        `[ -f "$f.json" ] || f="${directory}/reponse-${responses.length}"`,
        'cat "$f.json"',
        'exit "$(cat "$f.code")"',
        '',
      ].join('\n'),
    )
    chmodSync(stub, 0o755)

    const result = spawnSync(TSX, [SCRIPT], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${directory}:${process.env.PATH ?? ''}` },
    })

    return { ...result, appels: Number(readFileSync(counter, 'utf8').trim()) }
  }

  const panne = (code: string) => ({
    stdout: JSON.stringify({ error: { code, message: 'request to registry failed' } }),
    exitCode: 1,
  })

  const rapport = (severity: string) => ({
    stdout: JSON.stringify({
      advisories: {
        '1102341': { severity, module_name: 'esbuild', github_advisory_id: 'GHSA-67mh-4wv8-2f99' },
      },
    }),
    exitCode: 1,
  })

  it('rejoue une panne de registre et rend une seule issue, verte, quand elle cesse', () => {
    const result = runWithScriptedPnpm([
      panne('ERR_SOCKET_TIMEOUT'),
      panne('ERR_SOCKET_TIMEOUT'),
      { stdout: JSON.stringify({ advisories: {} }), exitCode: 0 },
    ])

    expect(result.appels).toBe(3)
    expect(result.status).toBe(0)
    // Une seule issue : la panne traversée ne laisse aucun refus derrière elle,
    // et le succès n'est annoncé qu'une fois.
    expect(result.stderr).not.toContain('Audit refusé')
    expect(result.stdout.match(/aucun au seuil/g)).toHaveLength(1)
  })

  it('épuise ses tentatives sur une panne qui dure, et nomme leur nombre', () => {
    const result = runWithScriptedPnpm([panne('ERR_SOCKET_TIMEOUT')])

    expect(result.appels).toBe(AUDIT_ATTEMPTS)
    expect(result.status).not.toBe(0)
    // Le nombre d'essais est dans le message : sans lui, un lecteur ne distingue
    // pas une panne persistante d'une porte qui n'a pas rejoué.
    expect(`${result.stdout}${result.stderr}`).toMatch(
      new RegExp(`refusé.*${String(AUDIT_ATTEMPTS)} tentatives`),
    )
    expect(`${result.stdout}${result.stderr}`).toContain('ERR_SOCKET_TIMEOUT')
    expect(result.stdout).not.toContain('aucun au seuil')
  })

  it('ne rejoue jamais un document d’avis, qu’il bloque ou non', () => {
    // **Le cœur de la reprise** : ce qui la rend sûre est la distinction que
    // `readAuditRun` porte déjà. Rejouer un rapport d'avis serait attendre qu'il
    // change d'avis — au mieux du temps perdu, au pire un vert obtenu par
    // patience si le registre finissait par ne plus répondre.
    const sousLeSeuil = runWithScriptedPnpm([rapport('moderate')])

    expect(sousLeSeuil.appels).toBe(1)
    expect(sousLeSeuil.status).toBe(0)

    const bloquant = runWithScriptedPnpm([rapport('high')])

    expect(bloquant.appels).toBe(1)
    expect(bloquant.status).not.toBe(0)
  })

  /**
   * **Le délai d'attente, là où il manque** : sur l'appel lui-même.
   *
   * Un `pnpm audit` qui ne répond jamais bloquait le job jusqu'à ce que le
   * registre coupe la connexion de lui-même (~4 minutes, mesurées à la
   * recherche). Le délai en fait une panne comme une autre : coupée, rejouée,
   * puis refusée en nommant les tentatives.
   */
  it('coupe un `pnpm audit` qui ne répond pas, et le traite comme une panne', () => {
    const directory = mkdtempSync(join(tmpdir(), 'audit-stub-'))
    const counter = join(directory, 'appels')
    const stub = join(directory, 'pnpm')

    writeFileSync(
      stub,
      [
        '#!/bin/sh',
        `n=$(cat "${counter}" 2>/dev/null || echo 0)`,
        'n=$((n+1))',
        `echo "$n" > "${counter}"`,
        // Le registre qui accepte la connexion et ne répond jamais.
        'sleep 30',
        '',
      ].join('\n'),
    )
    chmodSync(stub, 0o755)

    const result = spawnSync(TSX, [SCRIPT], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH ?? ''}`,
        [AUDIT_TIMEOUT_VARIABLE]: '300',
      },
      // Le délai de ce processus-ci n'est pas celui qu'on éprouve : il borne le
      // cas si le script cessait d'en poser un, au lieu de le faire pendre.
      timeout: 20_000,
    })

    expect(Number(readFileSync(counter, 'utf8').trim())).toBe(AUDIT_ATTEMPTS)
    expect(result.status).not.toBe(0)
    expect(`${result.stdout ?? ''}${result.stderr ?? ''}`).toMatch(/délai d'attente|300 ms/)
    expect(result.stdout ?? '').not.toContain('aucun au seuil')
  })
})

/**
 * **Le délai d'attente de l'appel** (`docs/reliability.md` §3, première puce :
 * « Tout appel réseau sortant porte un délai d'attente explicite »).
 *
 * Constat de la revue de s48 : `spawnSync` n'en posait aucun, et la recherche
 * avait mesuré ~4 minutes avant qu'un `ERR_SOCKET_TIMEOUT` tombe de lui-même.
 * Avec trois tentatives, cette story faisait passer le pire cas à ~12 minutes de
 * job — c'est elle qui a triplé le coût, c'est donc elle qui pose le délai.
 *
 * Le délai est **injectable**, pour la raison qui vaut déjà pour la dispersion
 * du recul : une attente qu'on ne peut pas raccourcir est une attente qu'aucun
 * test ne peut éprouver. Une valeur illisible est **refusée**, jamais lue comme
 * « pas de délai ».
 */
describe('le délai d’attente de `pnpm audit`', () => {
  it('vaut la valeur du dépôt quand rien n’est posé', () => {
    expect(auditTimeoutMs(undefined)).toBe(AUDIT_TIMEOUT_MS)
    expect(auditTimeoutMs('')).toBe(AUDIT_TIMEOUT_MS)
  })

  it('honore une durée entière et strictement positive', () => {
    expect(auditTimeoutMs('250')).toBe(250)
  })

  it('refuse une valeur illisible ou nulle, en nommant la variable', () => {
    // Une valeur illisible relue en « pas de délai » rendrait la puce de §3
    // fausse au moment précis où quelqu'un croit l'avoir réglée.
    for (const value of ['zéro', '0', '-1', '1.5']) {
      expect(() => auditTimeoutMs(value)).toThrowError(new RegExp(AUDIT_TIMEOUT_VARIABLE))
    }
  })
})
