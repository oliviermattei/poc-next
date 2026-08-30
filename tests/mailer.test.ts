import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Env } from '@repo/config'
import type { RegistryEmailTemplate } from '@repo/core'
import { qualifyEmailTemplateId } from '@repo/emails'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LOCAL_MAIL_DIRECTORY, createAppMailer } from '../apps/web/lib/mailer'
import { moduleRegistry } from '../apps/web/lib/module-registry'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

const anEnv = (overrides: Partial<Env> = {}): Env => ({
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/app',
  ...overrides,
})

/**
 * Catalogue explicite pour les cas de **sélection**.
 *
 * Ils portent sur le mailer choisi, pas sur le registre : dépendre d'un module
 * activé les ferait échouer dans l'état de configuration où aucun ne l'est. Le
 * câblage du catalogue sur le registre est prouvé par le cas qui suit, lui
 * dérivé du registre.
 */
const CATALOGUE = [
  {
    moduleId: 'test',
    template: {
      id: 'welcome',
      locales: { fr: { subject: 'Bienvenue {name}', body: 'Bonjour {name}.' } },
    },
  },
] as const satisfies readonly RegistryEmailTemplate[]

const send = () => ({
  to: 'destinataire@example.test',
  subject: 'Bienvenue {name}',
  template: 'test.welcome',
  locale: 'fr',
  data: { name: 'Olivier' },
})

const capturedIn = async (): Promise<string> => await mkdtemp(join(tmpdir(), 'app-mail-'))

/** Doublure du **réseau**, pas du SDK : ce qui part est réellement sérialisé. */
const stubNetwork = (): { calls: number } => {
  const state = { calls: 0 }

  vi.stubGlobal('fetch', () => {
    state.calls += 1

    return Promise.resolve(
      new Response(JSON.stringify({ id: 'email-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
  })

  return state
}

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * **Le mailer est choisi par la présence d'une clé, jamais par `NODE_ENV`.**
 *
 * C'est le piège nommé par la story et déjà relevé dans la recherche de s01 :
 * un mailer conditionné par l'environnement est intestable, et se trompera un
 * jour d'environnement — en envoyant de vrais emails depuis une suite de tests,
 * ou en écrivant sur disque en production.
 *
 * Les deux cas ci-dessous croisent délibérément les deux axes : production sans
 * clé, développement avec clé. Une sélection par `NODE_ENV` les fait rougir
 * tous les deux.
 */
describe('sélection du mailer applicatif', () => {
  it('sans clé d’API, capture localement au lieu d’envoyer — même en production', async () => {
    const directory = await capturedIn()
    const network = stubNetwork()

    const mailer = createAppMailer({
      env: anEnv({ NODE_ENV: 'production' }),
      captureDirectory: directory,
      emails: CATALOGUE,
    })
    const result = await mailer.send(send())

    expect(result.ok).toBe(true)
    expect(network.calls).toBe(0)
    const [file] = await readdir(directory)
    expect(file).toMatch(/\.html$/)
    expect(await readFile(join(directory, file ?? ''), 'utf8')).toContain('Olivier')
  })

  it('avec une clé d’API, envoie chez le fournisseur — même en développement', async () => {
    const directory = await capturedIn()
    const network = stubNetwork()

    const mailer = createAppMailer({
      env: anEnv({
        NODE_ENV: 'development',
        RESEND_API_KEY: 're_test_key',
        EMAIL_FROM: 'Killer SaaS <envoi@example.test>',
      }),
      captureDirectory: directory,
      emails: CATALOGUE,
    })
    const result = await mailer.send(send())

    expect(result).toEqual({ ok: true, id: 'email-1' })
    expect(network.calls).toBe(1)
    expect(await readdir(directory)).toEqual([])
  })

  it('rend tout ce que le registre déclare, et rien d’autre', async () => {
    // Le catalogue vient du **registre**, pas d'une liste écrite ici : un
    // module non activé ne laisse pas plus de trace dans les emails que dans
    // les routes ou la navigation. Dérivé du registre, ce cas vaut dans les
    // trois états de configuration — y compris celui où aucun module n'est
    // activé, où il ne reste que le refus.
    const mailer = createAppMailer({ env: anEnv(), captureDirectory: await capturedIn() })

    for (const entry of moduleRegistry.emails) {
      const [locale] = Object.keys(entry.template.locales)
      const template = qualifyEmailTemplateId(entry.moduleId, entry.template.id)

      const result = await mailer.send({
        ...send(),
        template,
        locale: locale ?? 'fr',
        subject: entry.template.locales[locale ?? 'fr']?.subject ?? '',
      })

      expect(result.ok, `le template ${template} devrait être rendable`).toBe(true)
    }

    const unknown = await mailer.send({ ...send(), template: 'module-absent.welcome' })

    expect(unknown.ok === false && unknown.error.code).toBe('invalid_request')
  })
})

/**
 * Délivrabilité (critère 7 de la story).
 *
 * Un domaine d'envoi sans SPF, DKIM ni DMARC voit ses emails classés en
 * indésirables ou refusés : la vérification d'inscription n'arrive jamais, et
 * personne ne voit d'erreur. La documentation est donc opposable, et sa
 * présence vérifiée.
 */
describe('documentation de délivrabilité', () => {
  const read = async (): Promise<string> =>
    await readFile(join(REPO_ROOT, 'docs/deliverability.md'), 'utf8')

  it('existe et porte une section par enregistrement DNS', async () => {
    const content = await read()

    for (const record of ['SPF', 'DKIM', 'DMARC']) {
      expect(content).toMatch(new RegExp(`^##.*\\b${record}\\b`, 'm'))
    }
  })

  it('donne un exemple d’enregistrement pour chacun', async () => {
    // La seule mention des trois sigles serait un titre : ce qui sert au
    // propriétaire du projet, c'est la valeur à poser dans sa zone DNS.
    const content = await read()

    expect(content).toContain('v=spf1')
    expect(content).toContain('v=DKIM1')
    expect(content).toContain('v=DMARC1')
  })

  it('nomme le dossier de capture locale et la recette d’envoi réel', async () => {
    const content = await read()

    expect(content).toContain(LOCAL_MAIL_DIRECTORY)
    expect(content).toContain('RESEND_LIVE_TEST')
  })
})
