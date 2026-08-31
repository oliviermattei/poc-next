import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Env } from '@repo/config'
import type { SendEmailResult } from '@repo/ports'
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

/**
 * Aucun `subject` ici : le port le rend facultatif, et c'est le sujet déclaré
 * par le module pour la locale demandée qui est rendu. Un appelant qui devait
 * le fournir allait le chercher dans le registre pour le repasser au rendu qui
 * l'a déjà — ou le codait en dur, dans une langue qui pouvait ne pas être
 * celle du corps.
 */
const send = () => ({
  to: 'destinataire@example.test',
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
      env: anEnv({ NODE_ENV: 'production', EMAIL_LOCAL_CAPTURE: '1' }),
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

  it('traite une clé déclarée vide comme absente — la configuration livrée par `.env.example`', async () => {
    // Le seul chemin pour lequel cette garde existe est celui où `getEnv` rend
    // l'environnement **sans le valider** : phase de build et
    // `SKIP_ENV_VALIDATION`. `withoutBlanks` vit dans `parseEnv`, que ces
    // chemins sautent — `RESEND_API_KEY=` y vaut `''`, donc « renseignée », et
    // la branche fournisseur l'emportait sur la capture explicitement demandée
    // (revue de s06, G2). La décision doit être celle du schéma partout.
    const directory = await capturedIn()
    const network = stubNetwork()

    const mailer = createAppMailer({
      env: anEnv({ RESEND_API_KEY: '', EMAIL_FROM: '', EMAIL_LOCAL_CAPTURE: '1' }),
      captureDirectory: directory,
      emails: CATALOGUE,
    })
    const result = await mailer.send(send())

    expect(result.ok).toBe(true)
    expect(network.calls).toBe(0)
    expect(await readdir(directory)).toHaveLength(1)
  })

  it('refuse de se monter quand aucun mailer n’est configuré, en nommant les variables', async () => {
    // Sans clé et sans capture explicite, l'ancien montage écrivait dans
    // `.mail/` et rendait `{ok:true}` — en production comme ailleurs, sans
    // qu'aucun appelant puisse le distinguer d'un envoi réussi.
    //
    // La garde est ici **en plus** du schéma : en phase de build et sous
    // `SKIP_ENV_VALIDATION`, `getEnv` rend l'environnement sans le valider.
    expect(() => createAppMailer({ env: anEnv(), emails: CATALOGUE })).toThrowError(
      /EMAIL_LOCAL_CAPTURE/,
    )
    expect(() => createAppMailer({ env: anEnv(), emails: CATALOGUE })).toThrowError(
      /RESEND_API_KEY/,
    )
  })

  it('libère l’appelant en moins de dix secondes quand le fournisseur ne répond jamais', async () => {
    // Aux défauts de l'adapter (10 s de délai, 3 essais, recul entre les
    // deux), le pire cas fait attendre ~31 s avant que l'appelant sache. C'est
    // au-delà du plafond usuel d'une fonction serverless : la plateforme coupe
    // la requête d'inscription avant que le résultat n'existe, et il ne reste
    // ni réponse ni journal. Le budget se choisit donc ici, au montage, plutôt
    // que de se subir.
    vi.useFakeTimers()

    try {
      vi.stubGlobal('fetch', () => new Promise(() => undefined))
      const mailer = createAppMailer({
        env: anEnv({
          RESEND_API_KEY: 're_test_key',
          EMAIL_FROM: 'Killer SaaS <envoi@example.test>',
        }),
        emails: CATALOGUE,
      })

      let settled: SendEmailResult | undefined
      const pending = mailer.send(send()).then((result) => {
        settled = result
      })
      await vi.advanceTimersByTimeAsync(9_999)

      expect(settled?.ok).toBe(false)
      expect(settled?.ok === false && settled.error.code).toBe('timeout')
      await pending
    } finally {
      vi.useRealTimers()
    }
  })

  it('rend tout ce que le registre déclare, et rien d’autre', async () => {
    // Le catalogue vient du **registre**, pas d'une liste écrite ici : un
    // module non activé ne laisse pas plus de trace dans les emails que dans
    // les routes ou la navigation. Dérivé du registre, ce cas vaut dans les
    // trois états de configuration — y compris celui où aucun module n'est
    // activé, où il ne reste que le refus.
    const mailer = createAppMailer({
      env: anEnv({ EMAIL_LOCAL_CAPTURE: '1' }),
      captureDirectory: await capturedIn(),
    })

    for (const entry of moduleRegistry.emails) {
      const [locale] = Object.keys(entry.template.locales)
      const template = qualifyEmailTemplateId(entry.moduleId, entry.template.id)
      const content = entry.template.locales[locale ?? 'fr']

      // Les données sont dérivées du **texte déclaré**, jamais écrites ici :
      // chaque module choisit ses variables, et le rendu refuse un envoi dont
      // une donnée manque. Une liste figée ne vaudrait que pour le module qui
      // l'a inspirée.
      const data = Object.fromEntries(
        [...`${content?.subject ?? ''} ${content?.body ?? ''}`.matchAll(/\{(\w+)\}/g)].map(
          (match) => [match[1] ?? '', 'valeur'],
        ),
      )

      const result = await mailer.send({ ...send(), template, locale: locale ?? 'fr', data })

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
