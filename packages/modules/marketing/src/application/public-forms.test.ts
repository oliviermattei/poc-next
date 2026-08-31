import type { ModuleScope } from '@repo/core'
import type { Mailer, SendEmailInput, SendEmailResult } from '@repo/ports'
import { describe, expect, it } from 'vitest'

import {
  CONTACT_FORM,
  NEWSLETTER_FORM,
  TRAP_FIELD,
  normaliseEmail,
  parseContactSubmission,
  parseNewsletterSubmission,
} from '../domain/public-forms'
import {
  UNKNOWN_CLIENT,
  clientIdentifierOf,
  exceedsRateLimit,
  rateLimitBuckets,
  windowStartOf,
} from '../domain/rate-limit'
import {
  MARKETING_EMAIL_TEMPLATES,
  createPublicFormsUseCases,
  type ContactMessageRecord,
  type PublicFormsDependencies,
  type PublicSubscriptionRecord,
} from './public-forms'

/**
 * Les règles des deux formulaires publics — **éprouvées là où elles vivent**.
 *
 * Ce fichier est le seul du module à parler des soumissions : le câblage
 * (routes, base, catalogue, écrans) est éprouvé par `tests/marketing.test.ts`
 * et par `e2e/public-forms.spec.ts`, qui ne réénumèrent pas ces refus. Un refus
 * se prouve une fois, à la règle ; un appelant n'en garde qu'un témoin.
 */

const aContact = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: 'Olivier',
  email: 'visiteur@example.test',
  message: 'Bonjour, une question sur les licences.',
  ...overrides,
})

describe('la soumission de contact, telle que la frontière la lit', () => {
  it('accepte une soumission complète et rend les valeurs normalisées', () => {
    const parsed = parseContactSubmission(aContact({ email: '  Visiteur@Example.TEST ' }))

    expect(parsed.ok).toBe(true)
    expect(parsed.ok && parsed.value.email).toBe('visiteur@example.test')
    expect(parsed.ok && parsed.value.name).toBe('Olivier')
  })

  it('refuse une adresse malformée en nommant le champ, sans rien deviner', () => {
    const parsed = parseContactSubmission(aContact({ email: 'pas-une-adresse' }))

    expect(parsed.ok).toBe(false)
    expect(!parsed.ok && parsed.refusal).toEqual({ kind: 'invalid', field: 'email' })
  })

  it('refuse une adresse portant un retour à la ligne — c’est une injection d’en-tête', () => {
    // `to` et `subject` sont les deux seuls champs d'en-tête que le port
    // `Mailer` expose. Une adresse qui porte « \r\nBcc: » n'a rien à faire
    // au-delà de cette frontière, quoi que le fournisseur en fasse ensuite.
    const parsed = parseContactSubmission(
      aContact({ email: 'visiteur@example.test\r\nBcc: espion@example.test' }),
    )

    expect(parsed.ok).toBe(false)
    expect(!parsed.ok && parsed.refusal).toEqual({ kind: 'invalid', field: 'email' })
  })

  it('refuse un nom porteur d’un caractère de contrôle, retour à la ligne compris', () => {
    // Le nom est une ligne. Ce qui n'entre pas ne peut pas ressortir dans un
    // en-tête, quel que soit le template qui l'interpolera un jour.
    const parsed = parseContactSubmission(aContact({ name: 'Olivier\r\nSubject: autre' }))

    expect(parsed.ok).toBe(false)
    expect(!parsed.ok && parsed.refusal).toEqual({ kind: 'invalid', field: 'name' })
  })

  it('accepte un message multiligne : un message n’est pas un en-tête', () => {
    const parsed = parseContactSubmission(aContact({ message: 'Bonjour,\n\nDeux questions.\n' }))

    expect(parsed.ok).toBe(true)
  })

  it('refuse un message vide, et un message uniquement fait d’espaces', () => {
    expect(parseContactSubmission(aContact({ message: '' })).ok).toBe(false)
    expect(parseContactSubmission(aContact({ message: '   \n  ' })).ok).toBe(false)
  })

  it('refuse un message plus long que ce que le formulaire accepte', () => {
    const parsed = parseContactSubmission(aContact({ message: 'a'.repeat(20_000) }))

    expect(parsed.ok).toBe(false)
    expect(!parsed.ok && parsed.refusal).toEqual({ kind: 'invalid', field: 'message' })
  })

  it('refuse un corps qui n’est pas un objet, sans lever', () => {
    for (const body of [null, undefined, 'texte', 42, []]) {
      expect(parseContactSubmission(body).ok).toBe(false)
    }
  })
})

describe('le piège à robots', () => {
  it('refuse une soumission dont le champ piège est rempli, et le dit « automated »', () => {
    // Le refus est d'une **autre nature** qu'un champ invalide : l'appelant ne
    // doit pas répondre 400 en nommant le champ, sinon le robot apprend lequel
    // laisser vide.
    const parsed = parseContactSubmission(aContact({ [TRAP_FIELD]: 'https://spam.test' }))

    expect(parsed.ok).toBe(false)
    expect(!parsed.ok && parsed.refusal).toEqual({ kind: 'automated' })
  })

  it('passe avant la validation : un robot qui remplit tout est vu comme un robot', () => {
    // Sans cet ordre, une soumission automatisée mal formée serait rendue en
    // « champ invalide » et compterait comme une erreur d'humain.
    const parsed = parseContactSubmission(
      aContact({ email: 'pas-une-adresse', [TRAP_FIELD]: 'x' }),
    )

    expect(!parsed.ok && parsed.refusal).toEqual({ kind: 'automated' })
  })

  it('laisse passer un champ piège présent mais vide : c’est le cas d’un humain', () => {
    expect(parseContactSubmission(aContact({ [TRAP_FIELD]: '' })).ok).toBe(true)
    expect(parseContactSubmission(aContact({ [TRAP_FIELD]: '   ' })).ok).toBe(true)
  })

  it('garde le même piège sur la newsletter', () => {
    const parsed = parseNewsletterSubmission({
      email: 'visiteur@example.test',
      [TRAP_FIELD]: 'x',
    })

    expect(!parsed.ok && parsed.refusal).toEqual({ kind: 'automated' })
  })
})

describe('la soumission newsletter', () => {
  it('n’exige que l’adresse, et la rend normalisée', () => {
    const parsed = parseNewsletterSubmission({ email: '  Visiteur@Example.TEST ' })

    expect(parsed.ok).toBe(true)
    expect(parsed.ok && parsed.value.email).toBe('visiteur@example.test')
  })

  it('refuse une adresse malformée — la route en fera ce qu’elle voudra', () => {
    expect(parseNewsletterSubmission({ email: 'pas-une-adresse' }).ok).toBe(false)
  })
})

describe('la normalisation d’adresse', () => {
  it('rend la même chaîne pour deux écritures de la même adresse', () => {
    // C'est **la** propriété qui rend la contrainte d'unicité en base utile :
    // sans elle, « A@B.co » et « a@b.co » sont deux inscriptions.
    expect(normaliseEmail('  A@B.CO ')).toBe(normaliseEmail('a@b.co'))
  })
})

describe('le seau de limitation de débit', () => {
  const policy = { windowSeconds: 600, maxPerClient: 3, maxPerForm: 100 }

  it('range deux instants de la même fenêtre au même début', () => {
    const start = windowStartOf(new Date('2026-08-31T10:00:00.000Z'), policy.windowSeconds)

    expect(windowStartOf(new Date('2026-08-31T10:09:59.999Z'), policy.windowSeconds)).toEqual(start)
  })

  it('bascule de fenêtre au pas suivant, et le début reste aligné sur la durée', () => {
    const start = windowStartOf(new Date('2026-08-31T10:09:59.999Z'), policy.windowSeconds)
    const next = windowStartOf(new Date('2026-08-31T10:10:00.000Z'), policy.windowSeconds)

    expect(next.getTime()).toBeGreaterThan(start.getTime())
    expect(next.getTime() - start.getTime()).toBe(policy.windowSeconds * 1000)
    // Aligné : sans cela, deux instances qui démarrent à une seconde d'écart
    // compteraient dans deux fenêtres décalées, et le seuil partagé ne serait
    // partagé qu'en apparence.
    expect(next.getTime() % (policy.windowSeconds * 1000)).toBe(0)
  })

  it('donne à deux appelants des seaux distincts, et un seau commun à la forme', () => {
    const mine = rateLimitBuckets({ form: CONTACT_FORM, client: '1.2.3.4', policy })
    const theirs = rateLimitBuckets({ form: CONTACT_FORM, client: '5.6.7.8', policy })

    expect(mine.client.key).not.toBe(theirs.client.key)
    expect(mine.form.key).toBe(theirs.form.key)
    expect(mine.client.max).toBe(policy.maxPerClient)
    expect(mine.form.max).toBe(policy.maxPerForm)
  })

  it('ne fait pas partager un seau à deux formulaires', () => {
    // Marteler le contact ne doit pas fermer la newsletter, et réciproquement.
    const contact = rateLimitBuckets({ form: CONTACT_FORM, client: '1.2.3.4', policy })
    const newsletter = rateLimitBuckets({ form: NEWSLETTER_FORM, client: '1.2.3.4', policy })

    expect(contact.client.key).not.toBe(newsletter.client.key)
    expect(contact.form.key).not.toBe(newsletter.form.key)
  })

  it('autorise jusqu’au seuil compris, et refuse au-delà', () => {
    expect(exceedsRateLimit(3, 3)).toBe(false)
    expect(exceedsRateLimit(4, 3)).toBe(true)
  })
})

/**
 * Le banc des cas d'usage.
 *
 * Les doublures remplacent **le réseau et la base**, jamais une règle : le
 * domaine qui décide, la normalisation, le piège et les seuils sont les vrais.
 * `runInBackground` est injecté pour que la suite puisse **attendre** ce qui
 * part hors du temps de réponse : sans lui, « l'email n'est pas encore parti »
 * ne serait qu'une course.
 */
const FORMS = {
  contactRecipient: 'editeur@exemple.test',
  newsletterSource: 'newsletter',
  rateLimit: { windowSeconds: 600, maxPerClient: 3, maxPerForm: 50 },
}

const aBench = (overrides: Partial<PublicFormsDependencies> = {}) => {
  const rows: PublicSubscriptionRecord[] = []
  const messages: ContactMessageRecord[] = []
  const sent: SendEmailInput[] = []
  const counts = new Map<string, number>()
  /** Les seaux qui ont une ligne, et la fenêtre de cette ligne. */
  const written = new Map<string, Date>()
  const background: Promise<unknown>[] = []
  let sequence = 0

  const mailer: Mailer = {
    send: (input) => {
      sent.push(input)

      return Promise.resolve({ ok: true, id: `sent-${sent.length}` } satisfies SendEmailResult)
    },
  }

  const dependencies: PublicFormsDependencies = {
    contactMessages: {
      record: (input) => {
        const record: ContactMessageRecord = {
          ...input,
          createdAt: new Date(0),
          deliveredAt: null,
        }

        messages.push(record)

        return Promise.resolve(record)
      },
      markDelivered: ({ id, at }) => {
        const index = messages.findIndex((record) => record.id === id)
        const found = messages[index]

        if (found !== undefined) {
          messages[index] = { ...found, deliveredAt: at }
        }

        return Promise.resolve()
      },
      listByEmail: (email) =>
        Promise.resolve(messages.filter((record) => record.email === email)),
      deleteByEmail: (email) => {
        const removed = messages.filter((record) => record.email === email).length

        messages.splice(0, messages.length, ...messages.filter((record) => record.email !== email))

        return Promise.resolve(removed)
      },
    },
    subscriptions: {
      subscribe: (input) => {
        const already = rows.some(
          (row) => row.source === input.source && row.email === input.email,
        )

        if (already) {
          return Promise.resolve(null)
        }

        const record: PublicSubscriptionRecord = { ...input, createdAt: new Date(0) }

        rows.push(record)

        return Promise.resolve(record)
      },
      listByEmail: (email) => Promise.resolve(rows.filter((row) => row.email === email)),
      deleteByEmail: (email) => {
        const removed = rows.filter((row) => row.email === email).length

        rows.splice(0, rows.length, ...rows.filter((row) => row.email !== email))

        return Promise.resolve(removed)
      },
    },
    throttle: {
      hit: ({ bucket, windowStart }) => {
        const key = `${bucket.key}@${windowStart.toISOString()}`
        const hits = (counts.get(key) ?? 0) + 1

        counts.set(key, hits)
        written.set(bucket.key, windowStart)

        return Promise.resolve(hits)
      },
      sweep: (before) => {
        let removed = 0

        for (const [key, windowStart] of written) {
          if (windowStart < before) {
            written.delete(key)
            removed += 1
          }
        }

        return Promise.resolve(removed)
      },
    },
    mailer,
    forms: FORMS,
    now: () => new Date('2026-08-31T10:00:00.000Z'),
    generateId: () => `sub-${(sequence += 1)}`,
    emailLocaleFor: (candidate) => (candidate === 'en' ? 'en' : 'fr'),
    emailOfScope: () => Promise.resolve(null),
    runInBackground: (task) => {
      background.push(task)
    },
    ...overrides,
  }

  return {
    rows,
    /** Les messages de contact réellement enregistrés. */
    messages,
    sent,
    /** Les seaux réellement écrits, par clé et par fenêtre. Une écriture est un effet observable. */
    hits: counts,
    /** Les lignes qui subsistent : c'est ce qui grandit, ou non. */
    written,
    useCases: createPublicFormsUseCases(dependencies),
    /** Attend ce qui a été lancé hors du temps de réponse. */
    settle: async () => {
      await Promise.allSettled(background)
    },
  }
}

const aContactBody = (overrides: Record<string, unknown> = {}) => ({
  ...aContact(),
  ...overrides,
})

describe('le formulaire de contact', () => {
  it('envoie un message à l’adresse **de la configuration**, et rien d’autre', async () => {
    const bench = aBench()

    const outcome = await bench.useCases.submitContact({
      body: aContactBody(),
      client: '1.2.3.4',
      locale: 'fr',
    })

    expect(outcome).toEqual({ status: 'accepted' })
    expect(bench.sent).toHaveLength(1)
    expect(bench.sent[0]?.to).toBe(FORMS.contactRecipient)
    expect(bench.sent[0]?.template).toBe(MARKETING_EMAIL_TEMPLATES.contactMessage)
    // Le sujet n'est **pas** imposé par l'appelant : il vient du template du
    // module, donc il n'interpole aucune donnée de visiteur. C'est ce qui ferme
    // l'injection d'en-tête (`docs/security.md` §4).
    expect(bench.sent[0]?.subject).toBeUndefined()
    expect(bench.sent[0]?.data).toMatchObject({
      email: 'visiteur@example.test',
      message: 'Bonjour, une question sur les licences.',
    })
    // Un message de contact n'inscrit personne à quoi que ce soit.
    expect(bench.rows).toEqual([])
  })

  it('refuse un champ invalide en le nommant, **sans envoyer**', async () => {
    const bench = aBench()

    const outcome = await bench.useCases.submitContact({
      body: aContactBody({ email: 'pas-une-adresse' }),
      client: '1.2.3.4',
      locale: 'fr',
    })

    expect(outcome).toEqual({ status: 'invalid', field: 'email' })
    expect(bench.sent).toEqual([])
  })

  it('avale une soumission piégée : réponse d’acceptation, aucun envoi', async () => {
    // Répondre 400 apprendrait au robot quel champ laisser vide ; répondre
    // « accepté » ne lui apprend rien. Le refus doit donc s'observer par
    // l'**absence d'effet**, pas par la réponse.
    const bench = aBench()

    const outcome = await bench.useCases.submitContact({
      body: aContactBody({ [TRAP_FIELD]: 'https://spam.test' }),
      client: '1.2.3.4',
      locale: 'fr',
    })

    expect(outcome).toEqual({ status: 'accepted' })
    expect(bench.sent).toEqual([])
  })

  it('dit que l’email n’est pas parti quand le fournisseur refuse, sans lever', async () => {
    // `docs/reliability.md` §2 : un tiers indisponible dégrade. Le port ne lève
    // pas, le cas d'usage non plus, et l'écran peut proposer de réessayer.
    const bench = aBench({
      mailer: {
        send: () =>
          Promise.resolve({
            ok: false,
            error: { code: 'provider_unavailable', message: 'indisponible', attempts: 2 },
          }),
      },
    })

    const outcome = await bench.useCases.submitContact({
      body: aContactBody(),
      client: '1.2.3.4',
      locale: 'fr',
    })

    expect(outcome).toEqual({ status: 'mail-failed' })
  })

  it('enregistre le message **avant** de l’envoyer, et le marque remis', async () => {
    // Un message de contact reçu puis perdu est un message perdu : jusqu'à la
    // revue de s11, un envoi en échec rendait 502 et ne laissait rien derrière
    // lui (constat F8). Il est désormais en base avant l'appel au fournisseur.
    const bench = aBench()

    await bench.useCases.submitContact({
      body: aContactBody(),
      client: '1.2.3.4',
      locale: 'fr',
    })

    expect(bench.messages).toHaveLength(1)
    expect(bench.messages[0]).toMatchObject({
      name: 'Olivier',
      email: 'visiteur@example.test',
      message: 'Bonjour, une question sur les licences.',
    })
    expect(bench.messages[0]?.deliveredAt).not.toBeNull()
  })

  it('garde le message, **non remis**, quand l’envoi échoue', async () => {
    const bench = aBench({
      mailer: {
        send: () =>
          Promise.resolve({
            ok: false,
            error: { code: 'provider_unavailable', message: 'indisponible', attempts: 2 },
          }),
      },
    })

    const outcome = await bench.useCases.submitContact({
      body: aContactBody(),
      client: '1.2.3.4',
      locale: 'fr',
    })

    expect(outcome).toEqual({ status: 'mail-failed' })
    // La trace exploitable : la ligne est là, sa date de remise est vide.
    expect(bench.messages).toHaveLength(1)
    expect(bench.messages[0]?.deliveredAt).toBeNull()
  })

  it('n’enregistre rien quand le champ est invalide ou le piège armé', async () => {
    const bench = aBench()

    await bench.useCases.submitContact({
      body: aContactBody({ email: 'pas-une-adresse' }),
      client: '1.2.3.4',
      locale: 'fr',
    })
    await bench.useCases.submitContact({
      body: aContactBody({ [TRAP_FIELD]: 'x' }),
      client: '5.6.7.8',
      locale: 'fr',
    })

    expect(bench.messages).toEqual([])
  })

  it('rend l’email dans la langue de la requête', async () => {
    const bench = aBench()

    await bench.useCases.submitContact({
      body: aContactBody(),
      client: '1.2.3.4',
      locale: 'en',
    })

    expect(bench.sent[0]?.locale).toBe('en')
  })
})

describe('l’inscription à la newsletter', () => {
  const subscribe = async (bench: ReturnType<typeof aBench>, email: string, client = '1.2.3.4') =>
    await bench.useCases.subscribeToNewsletter({ body: { email }, client, locale: 'fr' })

  it('enregistre l’adresse sous la source de la configuration, et confirme par email', async () => {
    const bench = aBench()

    const outcome = await subscribe(bench, 'lecteur@example.test')
    await bench.settle()

    expect(outcome).toEqual({ status: 'accepted' })
    expect(bench.rows).toHaveLength(1)
    expect(bench.rows[0]).toMatchObject({
      email: 'lecteur@example.test',
      source: FORMS.newsletterSource,
      locale: 'fr',
    })
    expect(bench.sent).toHaveLength(1)
    expect(bench.sent[0]?.to).toBe('lecteur@example.test')
    expect(bench.sent[0]?.template).toBe(MARKETING_EMAIL_TEMPLATES.newsletterConfirmation)
  })

  it('rejouée à l’identique, elle ne crée ni seconde ligne ni second email', async () => {
    // `docs/reliability.md` §1 : deux soumissions identiques, un seul effet.
    const bench = aBench()

    await subscribe(bench, 'lecteur@example.test')
    await subscribe(bench, 'LECTEUR@Example.TEST')
    await bench.settle()

    expect(bench.rows).toHaveLength(1)
    expect(bench.sent).toHaveLength(1)
  })

  it('répond la même chose à une adresse nouvelle, déjà inscrite ou malformée', async () => {
    // Sinon le formulaire devient un oracle : poster une adresse dirait si elle
    // est déjà dans la liste (`docs/security.md` §7).
    const bench = aBench()

    const first = await subscribe(bench, 'connu@example.test')
    const again = await subscribe(bench, 'connu@example.test')
    const malformed = await subscribe(bench, 'pas-une-adresse')

    expect(again).toEqual(first)
    expect(malformed).toEqual(first)
  })

  it('n’écrit rien et n’envoie rien pour une adresse malformée', async () => {
    const bench = aBench()

    await subscribe(bench, 'pas-une-adresse')
    await bench.settle()

    expect(bench.rows).toEqual([])
    expect(bench.sent).toEqual([])
  })

  it('n’écrit rien et n’envoie rien quand le piège est armé', async () => {
    const bench = aBench()

    const outcome = await bench.useCases.subscribeToNewsletter({
      body: { email: 'robot@example.test', [TRAP_FIELD]: 'x' },
      client: '1.2.3.4',
      locale: 'fr',
    })

    await bench.settle()

    expect(outcome).toEqual({ status: 'accepted' })
    expect(bench.rows).toEqual([])
    expect(bench.sent).toEqual([])
  })

  it('répond sans attendre la confirmation : un fournisseur muet ne retient rien', async () => {
    // Une inscription nouvelle envoie, un doublon non : si la réponse attendait
    // l'envoi, sa latence dirait lequel des deux cas s'est produit
    // (`docs/security.md` §7, « pas de différence de temps de réponse
    // observable »). La mesure porte donc sur ce qui compte — la réponse ne
    // dépend pas de l'issue de l'envoi —, et non sur l'instant où la doublure a
    // été appelée : un fournisseur qui ne répond **jamais** fait expirer ce cas
    // dès que quelqu'un ajoute un `await` sur le courrier.
    const bench = aBench({ mailer: { send: () => new Promise<never>(() => {}) } })

    const outcome = await bench.useCases.subscribeToNewsletter({
      body: { email: 'lecteur@example.test' },
      client: '1.2.3.4',
      locale: 'fr',
    })

    expect(outcome).toEqual({ status: 'accepted' })
    // Et l'inscription est bien enregistrée : c'est elle qui porte
    // l'idempotence, elle ne peut pas être différée.
    expect(bench.rows).toHaveLength(1)
  })

  it('garde l’inscription même quand l’email de confirmation ne part pas', async () => {
    const bench = aBench({
      mailer: {
        send: () =>
          Promise.resolve({
            ok: false,
            error: { code: 'timeout', message: 'délai dépassé', attempts: 2 },
          }),
      },
    })

    const outcome = await subscribe(bench, 'lecteur@example.test')
    await bench.settle()

    expect(outcome).toEqual({ status: 'accepted' })
    expect(bench.rows).toHaveLength(1)
  })
})

describe('la limitation de débit, vue des cas d’usage', () => {
  it('refuse au-delà du seuil, sans écrire ni envoyer', async () => {
    const bench = aBench()
    const post = async (email: string) =>
      await bench.useCases.subscribeToNewsletter({
        body: { email },
        client: '1.2.3.4',
        locale: 'fr',
      })

    for (let index = 0; index < FORMS.rateLimit.maxPerClient; index += 1) {
      expect(await post(`lecteur-${index}@example.test`)).toEqual({ status: 'accepted' })
    }

    await bench.settle()

    const refused = await post('lecteur-de-trop@example.test')

    expect(refused).toEqual({ status: 'rate-limited' })
    expect(bench.rows).toHaveLength(FORMS.rateLimit.maxPerClient)
    expect(bench.sent).toHaveLength(FORMS.rateLimit.maxPerClient)
  })

  it('ne fait pas fermer un formulaire parce que l’autre a été martelé', async () => {
    const bench = aBench()

    for (let index = 0; index < FORMS.rateLimit.maxPerClient + 1; index += 1) {
      await bench.useCases.subscribeToNewsletter({
        body: { email: `lecteur-${index}@example.test` },
        client: '1.2.3.4',
        locale: 'fr',
      })
    }

    const contact = await bench.useCases.submitContact({
      body: aContactBody(),
      client: '1.2.3.4',
      locale: 'fr',
    })

    expect(contact).toEqual({ status: 'accepted' })
  })

  it('refusé sur son propre seau, n’écrit plus rien dans celui du formulaire', async () => {
    // Le refus doit **arrêter le travail**, écriture comprise : une requête déjà
    // refusée qui incrémente encore un seau offre à un appelant anonyme une
    // croissance de table gratuite (constat F1 de la revue).
    const bench = aBench()
    const formBucket = rateLimitBuckets({
      form: NEWSLETTER_FORM,
      client: '1.2.3.4',
      policy: FORMS.rateLimit,
    }).form.key

    for (let index = 0; index < FORMS.rateLimit.maxPerClient; index += 1) {
      await bench.useCases.subscribeToNewsletter({
        body: { email: `lecteur-${index}@example.test` },
        client: '1.2.3.4',
        locale: 'fr',
      })
    }

    const before = [...bench.hits].filter(([key]) => key.startsWith(formBucket))

    const refused = await bench.useCases.subscribeToNewsletter({
      body: { email: 'de-trop@example.test' },
      client: '1.2.3.4',
      locale: 'fr',
    })

    expect(refused).toEqual({ status: 'rate-limited' })
    expect([...bench.hits].filter(([key]) => key.startsWith(formBucket))).toEqual(before)
  })

  it('efface les seaux des fenêtres closes à la première soumission de la suivante', async () => {
    // La contrepartie du seau par appelant : une ligne par identifiant, et
    // l'identifiant vient d'un en-tête que le client écrit. Sans effacement, la
    // table grandit sans borne sous le contrôle d'un anonyme (constat F1). Le
    // balayage a lieu une fois par fenêtre et par formulaire — à la bascule —,
    // jamais à chaque requête.
    let instant = new Date('2026-08-31T10:00:00.000Z')
    const bench = aBench({ now: () => instant })

    for (const client of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) {
      await bench.useCases.subscribeToNewsletter({
        body: { email: `lecteur-${client}@example.test` },
        client,
        locale: 'fr',
      })
    }

    expect(bench.written.size).toBe(4)

    instant = new Date('2026-08-31T10:10:00.000Z')

    await bench.useCases.subscribeToNewsletter({
      body: { email: 'fenetre-suivante@example.test' },
      client: '4.4.4.4',
      locale: 'fr',
    })

    // Il ne reste que ce que la fenêtre en cours a écrit : le seau de l'appelant
    // et celui du formulaire. Sans effacement, il en resterait six.
    expect(bench.written.size).toBe(2)
  })

  it('compte par appelant : un second visiteur n’hérite pas du seau du premier', async () => {
    const bench = aBench()

    for (let index = 0; index < FORMS.rateLimit.maxPerClient; index += 1) {
      await bench.useCases.subscribeToNewsletter({
        body: { email: `lecteur-${index}@example.test` },
        client: '1.2.3.4',
        locale: 'fr',
      })
    }

    const other = await bench.useCases.subscribeToNewsletter({
      body: { email: 'ailleurs@example.test' },
      client: '5.6.7.8',
      locale: 'fr',
    })

    expect(other).toEqual({ status: 'accepted' })
  })
})

/**
 * **Le seau du formulaire dégrade, il ne refuse pas** — constat F2 de la revue.
 *
 * Il existe pour borner le coût quand l'identifiant d'appelant est falsifié
 * (`x-forwarded-for` est écrit par le client). S'il refusait, cet identifiant
 * falsifiable deviendrait un levier : quelques centaines de requêtes fermeraient
 * les deux formulaires à **tous** les visiteurs, pendant toute la fenêtre. Il
 * suspend donc ce qui coûte — l'envoi sortant — et laisse passer la soumission.
 */
describe('la saturation du seau du formulaire', () => {
  const saturable = { ...FORMS, rateLimit: { windowSeconds: 600, maxPerClient: 100, maxPerForm: 2 } }

  it('n’oppose aucun refus à un visiteur neuf, et enregistre son inscription', async () => {
    const bench = aBench({ forms: saturable })

    const outcomes = []

    for (let index = 0; index < 3; index += 1) {
      outcomes.push(
        await bench.useCases.subscribeToNewsletter({
          body: { email: `lecteur-${index}@example.test` },
          // Un appelant **différent** à chaque fois : c'est le seau du
          // formulaire, et lui seul, qui sature.
          client: `client-${index}`,
          locale: 'fr',
        }),
      )
    }

    await bench.settle()

    expect(outcomes).toEqual([
      { status: 'accepted' },
      { status: 'accepted' },
      { status: 'accepted' },
    ])
    expect(bench.rows).toHaveLength(3)
    // Ce qui est suspendu, c'est l'envoi : les deux premières confirmations sont
    // parties, la troisième non.
    expect(bench.sent).toHaveLength(2)
  })

  it('accepte encore un message de contact, sans l’envoyer', async () => {
    const bench = aBench({ forms: saturable })

    const outcomes = []

    for (let index = 0; index < 3; index += 1) {
      outcomes.push(
        await bench.useCases.submitContact({
          body: aContactBody(),
          client: `client-${index}`,
          locale: 'fr',
        }),
      )
    }

    expect(outcomes.at(-1)).toEqual({ status: 'accepted' })
    expect(bench.sent).toHaveLength(2)
    // Rien n'est perdu : les trois messages sont en base, le troisième sans
    // date de remise. C'est cette trace qui rend la dégradation acceptable.
    expect(bench.messages).toHaveLength(3)
    expect(bench.messages.at(-1)?.deliveredAt).toBeNull()
  })
})

describe('la purge et l’export des données de visiteur', () => {
  const userScope: ModuleScope = { kind: 'user', userId: 'u-1' }
  const organizationScope: ModuleScope = { kind: 'organization', organizationId: 'o-1' }

  /**
   * Un résolveur qui répond **pour n'importe quel périmètre**.
   *
   * Délibérément complaisant : si la doublure refusait elle-même le périmètre
   * organisation, c'est elle que le cas ci-dessous mesurerait, et retirer la
   * garde du cas d'usage ne ferait rien rougir — mesuré, ça a été vert une
   * première fois.
   */
  const benchWithSubscriber = () =>
    aBench({ emailOfScope: () => Promise.resolve('u@example.test') })

  it('rend les inscriptions de l’adresse du périmètre', async () => {
    const bench = benchWithSubscriber()

    await bench.useCases.subscribeToNewsletter({
      body: { email: 'u@example.test' },
      client: '1.2.3.4',
      locale: 'fr',
    })

    const payload = await bench.useCases.exportVisitorData(userScope)

    expect(payload).toEqual({
      subscriptions: [{ source: FORMS.newsletterSource, locale: 'fr', createdAt: new Date(0) }],
      messages: [],
    })
  })

  it('rend aussi les messages de contact envoyés depuis cette adresse', async () => {
    // `contact_message` est une donnée personnelle : elle est déclarée au
    // contrat, donc elle s'exporte et elle s'efface (constat F8).
    const bench = benchWithSubscriber()

    await bench.useCases.submitContact({
      body: aContactBody({ email: 'u@example.test' }),
      client: '1.2.3.4',
      locale: 'fr',
    })

    expect(await bench.useCases.exportVisitorData(userScope)).toEqual({
      subscriptions: [],
      messages: [
        {
          name: 'Olivier',
          message: 'Bonjour, une question sur les licences.',
          locale: 'fr',
          createdAt: new Date(0),
        },
      ],
    })
  })

  it('efface les inscriptions **et** les messages de cette adresse, et rien d’autre', async () => {
    const bench = benchWithSubscriber()

    for (const email of ['u@example.test', 'autre@example.test']) {
      await bench.useCases.subscribeToNewsletter({
        body: { email },
        client: `client-${email}`,
        locale: 'fr',
      })
      await bench.useCases.submitContact({
        body: aContactBody({ email }),
        client: `client-${email}`,
        locale: 'fr',
      })
    }

    await bench.useCases.purgeVisitorData(userScope)

    expect(bench.rows.map((row) => row.email)).toEqual(['autre@example.test'])
    expect(bench.messages.map((record) => record.email)).toEqual(['autre@example.test'])
  })

  it('ne rend rien pour un périmètre organisation : une inscription publique n’en a pas', async () => {
    const bench = benchWithSubscriber()

    await bench.useCases.subscribeToNewsletter({
      body: { email: 'u@example.test' },
      client: '1.2.3.4',
      locale: 'fr',
    })
    await bench.useCases.submitContact({
      body: aContactBody({ email: 'u@example.test' }),
      client: '1.2.3.4',
      locale: 'fr',
    })

    expect(await bench.useCases.exportVisitorData(organizationScope)).toEqual({})

    await bench.useCases.purgeVisitorData(organizationScope)

    expect(bench.rows).toHaveLength(1)
    expect(bench.messages).toHaveLength(1)
  })
})

describe('l’identifiant de l’appelant, lu dans les en-têtes', () => {
  const headersOf = (entries: Record<string, string>): Headers => new Headers(entries)

  it('prend le premier maillon de la chaîne « x-forwarded-for »', () => {
    // Le premier est le client ; les suivants sont les relais. Prendre le
    // dernier ferait compter tous les visiteurs derrière un même seau.
    expect(clientIdentifierOf(headersOf({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }))).toBe(
      '1.2.3.4',
    )
  })

  it('retombe sur « x-real-ip », puis sur un identifiant commun', () => {
    expect(clientIdentifierOf(headersOf({ 'x-real-ip': '9.9.9.9' }))).toBe('9.9.9.9')
    // Aucun en-tête : tout le monde partage un seau. C'est plus strict que de
    // laisser passer, et c'est le seul sens sûr.
    expect(clientIdentifierOf(headersOf({}))).toBe(UNKNOWN_CLIENT)
  })
})
