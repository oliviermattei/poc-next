import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { EmailRenderer, SendEmailInput } from '@repo/ports'
import { describe, expect, it } from 'vitest'

import { createLocalCaptureMailer } from './local-capture-mailer'
import { createRecordingMailer } from './recording-mailer'

const anInput = (overrides: Partial<SendEmailInput> = {}): SendEmailInput => ({
  to: 'destinataire@example.test',
  subject: 'Bienvenue {name}',
  template: 'welcome',
  locale: 'fr',
  data: { name: 'Olivier' },
  ...overrides,
})

/** Rendu injecté : ces outils ne connaissent ni React, ni les templates. */
const renderer: EmailRenderer = async (input) => ({
  subject: `[${input.locale}] ${input.subject}`,
  html: `<p>corps de ${input.template}</p>`,
  text: `corps de ${input.template}`,
})

describe('doublure d’enregistrement', () => {
  it('capture destinataire, template et données de chaque envoi, dans l’ordre', async () => {
    const mailer = createRecordingMailer()

    await mailer.send(anInput({ to: 'un@example.test', data: { name: 'Un' } }))
    await mailer.send(anInput({ to: 'deux@example.test', template: 'reset', data: { name: 'Deux' } }))

    expect(mailer.sent.map((sent) => [sent.to, sent.template, sent.data])).toEqual([
      ['un@example.test', 'welcome', { name: 'Un' }],
      ['deux@example.test', 'reset', { name: 'Deux' }],
    ])
  })

  it('rend un identifiant distinct par envoi', async () => {
    // Sans cela, un appelant qui trace l'identifiant renvoyé ne peut pas
    // distinguer deux emails — et un test de rejeu ne prouve rien.
    const mailer = createRecordingMailer()

    const first = await mailer.send(anInput())
    const second = await mailer.send(anInput())

    expect(first).toEqual({ ok: true, id: expect.any(String) })
    expect(second.ok && first.ok && second.id).not.toBe(first.ok && first.id)
  })

  it('rend un instantané : un envoi ultérieur ne réécrit pas une lecture passée', async () => {
    // Une liste vivante rendrait vert un test écrit avant l'envoi qu'il
    // prétend observer.
    const mailer = createRecordingMailer()

    await mailer.send(anInput())
    const snapshot = mailer.sent
    await mailer.send(anInput())

    expect(snapshot).toHaveLength(1)
    expect(mailer.sent).toHaveLength(2)
  })

  it('oublie tout après `reset`', async () => {
    const mailer = createRecordingMailer()
    await mailer.send(anInput())

    mailer.reset()

    expect(mailer.sent).toEqual([])
  })
})

describe('capture locale', () => {
  const inTempDirectory = async (): Promise<string> =>
    await mkdtemp(join(tmpdir(), 'mailer-capture-'))

  it('écrit l’email rendu dans un fichier consultable au lieu de l’envoyer', async () => {
    const directory = await inTempDirectory()
    const mailer = createLocalCaptureMailer({ directory, render: renderer })

    const result = await mailer.send(anInput())

    expect(result.ok).toBe(true)
    const [file] = await readdir(directory)
    expect(file).toMatch(/\.html$/)
    const captured = await readFile(join(directory, file ?? ''), 'utf8')
    expect(captured).toContain('corps de welcome')
    expect(captured).toContain('destinataire@example.test')
    expect(captured).toContain('[fr] Bienvenue {name}')
  })

  it('reste dans son dossier et n’écrase rien quand le template porte un chemin', async () => {
    // Le nom du fichier vient d'une donnée d'appel. Deux gardes s'y appliquent
    // et l'assertion mord sur les deux : sans assainissement du segment, les
    // deux captures retombent sur le même nom et la seconde écrase la
    // première ; sans `basename`, l'écriture sort du dossier et il ne reste
    // rien à lire.
    const directory = await inTempDirectory()
    const mailer = createLocalCaptureMailer({ directory, render: renderer })

    await mailer.send(anInput({ template: '../../evade' }))
    await mailer.send(anInput({ template: '../../evade' }))

    const files = await readdir(directory)
    expect(files).toHaveLength(2)
    for (const file of files) {
      expect(file).not.toContain('/')
      expect(file).not.toContain('..')
    }
  })

  it('dégrade en résultat d’échec quand le disque refuse, sans lever', async () => {
    // `docs/reliability.md` §2 : une panne dégrade, elle ne casse pas. Le
    // parent du dossier visé est un **fichier** : la création échoue (ENOTDIR).
    const parent = await inTempDirectory()
    await writeFile(join(parent, 'fichier.txt'), 'pas un dossier', 'utf8')
    const directory = join(parent, 'fichier.txt', 'sous-dossier')
    const mailer = createLocalCaptureMailer({ directory, render: renderer })

    const result = await mailer.send(anInput())

    expect(result).toEqual({
      ok: false,
      error: { code: 'provider_unavailable', message: expect.any(String), attempts: 1 },
    })
  })

  it('dégrade quand le rendu du template échoue', async () => {
    const directory = await inTempDirectory()
    const mailer = createLocalCaptureMailer({
      directory,
      render: () => Promise.reject(new Error('template inconnu : welcome')),
    })

    const result = await mailer.send(anInput())

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error.code).toBe('invalid_request')
  })
})
