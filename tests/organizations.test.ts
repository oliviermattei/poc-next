import { createHash, randomUUID } from 'node:crypto'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildRegistry,
  dispatchModuleRequest,
  MODULE_ROUTE_PREFIX,
  resolveDataOwner,
  type ModuleSession,
} from '@repo/core'
import {
  createDatabaseClient,
  planModuleMigrations,
  runModuleMigrations,
  type DatabaseConnection,
} from '@repo/db'
import { createRecordingMailer } from '@repo/mailer-testing'
import { authModule, authUser } from '@repo/module-auth'
import {
  configureOrganizations,
  EMPTY_ORGANIZATIONS_VIEW,
  INVITATION_QUOTA_PER_WINDOW,
  INVITATION_QUOTA_WINDOW_SECONDS,
  ORGANIZATION_ACTIONS,
  ORGANIZATIONS_KEYS,
  organizationMember,
  organizationsMessageKeys,
  assignableRolesFor,
  permissionsOf,
  organizationsModule,
  organizationRoutePath,
  resetOrganizationsService,
  type OrganizationRole,
  type OrganizationSecurityEvent,
  type OrganizationsService,
  type OrganizationsView,
} from '@repo/module-organizations'
import type { Mailer } from '@repo/ports'
import { sql } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { flatMessagesFor } from '../apps/web/lib/messages'
import { appLocales, defaultLocale } from '../config/i18n'
import { availableModules } from '../config/features'
import { databaseUrl, isDatabaseReachable } from './fixtures/database'

/**
 * La multi-tenance, éprouvée **contre une vraie base** et à travers le
 * répartiteur de modules — le même chemin qu'une requête de l'application.
 *
 * Ce fichier porte ce qui décide de la story, et rien de ce qui se prouve
 * ailleurs : les règles pures de nom et d'identifiant vivent dans
 * `packages/modules/organizations/src/domain/organization-rules.test.ts`, et ce
 * fichier ne rejoue pas leur matrice — il prouve qu'elles sont **appelées**, et
 * qu'un refus n'écrit rien.
 *
 * Quatre mesures :
 *
 * 1. **le périmètre** — l'organisation d'un autre répond 404, ni 403 ni 200, et
 *    le refus n'atteint aucune écriture ;
 * 2. **la résolution du propriétaire** — la même fonction, les deux
 *    configurations ;
 * 3. **le module coupé** — aucune route, aucune navigation, aucune table sur
 *    une base vierge ;
 * 4. **l'idempotence** — la purge rejouée, et la bascule rejouée.
 */

const databaseReachable = await isDatabaseReachable()

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const APP_URL = 'http://localhost:3000'

/**
 * Le registre du module et de son requis, **construit par le test**.
 *
 * Il ne dépend donc pas de `config/features.ts` : les assertions portent sur la
 * modularité, pas sur l'état dans lequel le dépôt se trouve. C'est ce qui rend
 * ce fichier vert dans les deux configurations.
 */
const registry = buildRegistry({
  available: [authModule, organizationsModule],
  enabled: ['auth', 'organizations'],
  locales: [...appLocales],
})

/** La même configuration, **sans** le module : l'état mono-utilisateur. */
const withoutOrganizations = buildRegistry({
  available: [authModule, organizationsModule],
  enabled: ['auth'],
  locales: [...appLocales],
})

let connection: DatabaseConnection
let service: OrganizationsService

/**
 * Les identifiants publics réservés de la suite.
 *
 * Ceux du produit sont dérivés par `apps/web/lib/organizations.ts` ; ici, une
 * poignée suffit — le cas qui compte est plus bas, et il confronte la
 * dérivation réelle aux écrans du disque.
 */
const RESERVED = new Set(['account', 'sign-in'])

/**
 * L'horloge de la suite, **injectée**.
 *
 * Une invitation expire ; sans horloge injectée, l'éprouver demanderait
 * d'attendre sept jours ou d'écrire une date en base à la main, c'est-à-dire de
 * court-circuiter le code qu'on mesure.
 */
let clock = new Date('2026-09-01T12:00:00.000Z')

/**
 * Le mailer de la suite : une doublure du **réseau**, jamais du SDK.
 *
 * Elle enregistre toujours ce qu'on lui confie, et rend l'échec quand la suite
 * le demande : c'est la seule façon d'éprouver « l'invitation est écrite,
 * l'email n'est pas parti, et elle reste renvoyable »
 * (`docs/reliability.md` §2).
 */
const outbox = createRecordingMailer()
let deliveryFails = false

const mailer: Mailer = {
  send: async (input) => {
    const recorded = await outbox.send(input)

    return deliveryFails
      ? {
          ok: false,
          error: { code: 'provider_unavailable', message: 'panne simulée', attempts: 1 },
        }
      : recorded
  },
}

/**
 * Le lien d'invitation **tel qu'il est parti**, lu dans le dernier email.
 *
 * C'est volontairement la seule façon d'obtenir un jeton dans cette suite : le
 * test suit le lien que le destinataire reçoit, pas une valeur que la couche
 * d'écriture lui aurait tendue.
 */
const lastInvitationLink = (): string => {
  const sent = outbox.sent.at(-1)

  if (sent === undefined) {
    throw new Error('Aucun email d’invitation n’a été envoyé.')
  }

  return String(sent.data['url'])
}

const tokenOf = (link: string): string => new URL(link).searchParams.get('token') ?? ''

/**
 * Le journal de sécurité de la suite (s17).
 *
 * Injecté comme le mailer : sans cela, l'exigence « journaliser le changement de
 * rôle avec son acteur » (`docs/security.md` §7) ne serait vérifiable que par
 * relecture.
 */
const securityEvents: OrganizationSecurityEvent[] = []

/** Compteur d'identifiants : déterministes, donc lisibles dans un échec. */
let sequence = 0

const generateId = (prefix: string): string => {
  sequence += 1

  return `${prefix}_s15_${sequence}`
}

const aSlug = (): string => `s15-${randomUUID().slice(0, 8)}`

/** Un compte réel : les appartenances portent une clé étrangère vers `auth_user`. */
const anAccount = async (email?: string): Promise<ModuleSession> => {
  const userId = `usr_s15_${randomUUID()}`

  await connection.db.insert(authUser).values({
    id: userId,
    name: 'Compte de test',
    email: email ?? `s15-${randomUUID()}@example.test`,
  })

  return { userId, roles: [] }
}

/** Une adresse qui n'a **aucun** compte : le pendant d'`anAccount`. */
const anUnknownEmail = (): string => `s15-inconnu-${randomUUID()}@example.test`

interface CallOptions {
  readonly session?: ModuleSession | null
  readonly body?: Record<string, string>
  readonly form?: boolean
}

/**
 * Une requête telle que l'application la sert : par le répartiteur du registre,
 * avec la session que le point de composition résoudrait.
 */
const call = async (
  path:
    | 'create'
    | 'switch'
    | 'update'
    | 'invite'
    | 'resendInvitation'
    | 'revokeInvitation'
    | 'acceptInvitation'
    | 'removeMember'
    | 'setMemberRole',
  options: CallOptions = {},
): Promise<Response> => {
  const url = `${APP_URL}${organizationRoutePath(path)}`
  const body = options.body ?? {}
  const request =
    options.form === true
      ? new Request(url, { method: 'POST', body: new URLSearchParams(body) })
      : new Request(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })

  return await dispatchModuleRequest(registry, request, {
    resolveSession: () => Promise.resolve(options.session ?? null),
  })
}

const countRows = async (table: string, where: string, value: string): Promise<number> => {
  const counted = await connection.db.execute<{ count: number }>(
    sql`select count(*)::int as count from ${sql.identifier(table)} where ${sql.identifier(where)} = ${value}`,
  )

  return Number(counted.rows[0]?.count ?? 0)
}

beforeAll(async () => {
  if (!databaseReachable) {
    return
  }

  connection = createDatabaseClient({ connectionString: databaseUrl, maxConnections: 5 })

  // Les migrations des deux modules, jouées ici : elles sont idempotentes, et
  // la suite ne doit pas dépendre d'un `pnpm db:migrate` lancé avant elle.
  await runModuleMigrations({
    db: connection.db,
    plan: planModuleMigrations({
      modules: [authModule, organizationsModule],
      repoRoot: REPO_ROOT,
    }),
  })

  service = configureOrganizations({
    db: connection.db,
    reservedSlugs: RESERVED,
    generateId,
    mailer,
    appUrl: APP_URL,
    emailLocale: defaultLocale,
    now: () => clock,
    securityLog: (event) => securityEvents.push(event),
  })
})

afterAll(async () => {
  resetOrganizationsService()

  if (databaseReachable) {
    // Les comptes de la suite, et eux seuls : appartenances et sélections
    // suivent par cascade.
    await connection.db.execute(sql`delete from auth_user where email like 's15-%'`)
    await connection.db.execute(sql`delete from organization where slug like 's15-%'`)
    await connection.close()
  }
})

describe.runIf(databaseReachable)('le périmètre organisationnel', () => {
  it('sert l’organisation de ses membres, et rend 404 à qui n’en est pas', async () => {
    const owner = await anAccount()
    const stranger = await anAccount()
    const slug = aSlug()

    const created = await call('create', {
      session: owner,
      body: { name: 'Studio Martin', slug },
    })

    expect(created.status).toBe(303)

    const [organization] = await service.useCases
      .viewOrganizations(owner.userId)
      .then((view) => view.memberships)

    expect(organization?.slug).toBe(slug)

    // Le membre bascule : la route sert.
    const switched = await call('switch', {
      session: owner,
      body: { organizationId: organization?.id ?? '' },
    })

    expect(switched.status).toBe(303)

    // **Le cas qui décide de la story.** Un compte qui n'est pas membre reçoit
    // 404 — jamais 403, qui confirmerait l'existence de l'organisation
    // (`docs/security.md` §3), et jamais 200.
    const refused = await call('switch', {
      session: stranger,
      body: { organizationId: organization?.id ?? '' },
    })

    expect(refused.status).toBe(404)

    // Et le refus **n'a rien écrit** : l'étranger n'a toujours aucune
    // organisation courante. Un refus qui atteint la donnée est une fuite, pas
    // un refus.
    expect(await service.useCases.activeOrganizationId(stranger.userId)).toBeNull()
    expect(
      await countRows('organization_active_selection', 'user_id', stranger.userId),
    ).toBe(0)
  })

  it('rend exactement la même chose pour une organisation qui n’existe pas', async () => {
    const stranger = await anAccount()
    const owner = await anAccount()
    const slug = aSlug()

    await call('create', { session: owner, body: { name: 'Atelier Nord', slug } })

    const [organization] = await service.useCases
      .viewOrganizations(owner.userId)
      .then((view) => view.memberships)

    const existing = await call('switch', {
      session: stranger,
      body: { organizationId: organization?.id ?? '' },
    })
    const invented = await call('switch', {
      session: stranger,
      body: { organizationId: 'org_qui_n_existe_pas' },
    })

    // Statut **et** corps identiques : la réponse ne doit rien apprendre.
    expect(invented.status).toBe(existing.status)
    await expect(invented.json()).resolves.toEqual(await existing.json())
  })

  it('refuse le renommage d’une organisation d’autrui sans rien modifier', async () => {
    const owner = await anAccount()
    const stranger = await anAccount()
    const slug = aSlug()

    await call('create', { session: owner, body: { name: 'Studio Martin', slug } })

    const [organization] = await service.useCases
      .viewOrganizations(owner.userId)
      .then((view) => view.memberships)

    const refused = await call('update', {
      session: stranger,
      body: { organizationId: organization?.id ?? '', name: 'Volé', slug: aSlug() },
    })

    expect(refused.status).toBe(404)

    const after = await service.useCases.viewOrganizations(owner.userId)

    expect(after.memberships[0]?.name).toBe('Studio Martin')
    expect(after.memberships[0]?.slug).toBe(slug)
  })

  it('agit sur le compte de la session, jamais sur celui du corps de la requête', async () => {
    const caller = await anAccount()
    const victim = await anAccount()

    // Le corps porte un `userId` : c'est ce champ qui fait rougir la suite si
    // une route se met à lire le compte ailleurs que dans la session.
    await call('create', {
      session: caller,
      body: { name: 'Studio Martin', slug: aSlug(), userId: victim.userId },
    })

    expect(await service.useCases.viewOrganizations(victim.userId)).toEqual(
      EMPTY_ORGANIZATIONS_VIEW,
    )
    expect((await service.useCases.viewOrganizations(caller.userId)).memberships).toHaveLength(1)
  })

  it('refuse toute route à qui n’est pas connecté, avant d’atteindre la base', async () => {
    const anonymous = await call('create', {
      session: null,
      body: { name: 'Studio', slug: aSlug() },
    })

    expect(anonymous.status).toBe(401)
    expect(await countRows('organization', 'slug', 's15-jamais')).toBe(0)
  })
})

describe.runIf(databaseReachable)('la création d’une organisation', () => {
  it('fait du créateur le propriétaire, et pose l’organisation courante', async () => {
    const founder = await anAccount()
    const slug = aSlug()

    await call('create', { session: founder, body: { name: 'Studio Martin', slug } })

    const view = await service.useCases.viewOrganizations(founder.userId)

    expect(view.current?.role).toBe('owner')
    expect(view.current?.slug).toBe(slug)
  })

  it('accepte une soumission de formulaire natif comme du JSON', async () => {
    const founder = await anAccount()
    const slug = aSlug()

    const response = await call('create', {
      session: founder,
      body: { name: 'Atelier Nord', slug },
      form: true,
    })

    // 303 vers l'écran, sans motif d'erreur : c'est ce que le navigateur suit
    // après une soumission native.
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(`${APP_URL}/organizations`)
    expect((await service.useCases.viewOrganizations(founder.userId)).memberships).toHaveLength(1)
  })

  it('refuse un identifiant déjà pris, sans créer de seconde organisation', async () => {
    const first = await anAccount()
    const second = await anAccount()
    const slug = aSlug()

    await call('create', { session: first, body: { name: 'Studio', slug } })
    const refused = await call('create', { session: second, body: { name: 'Copie', slug } })

    expect(refused.headers.get('location')).toBe(
      `${APP_URL}/organizations?error=slug_unavailable`,
    )
    expect(await countRows('organization', 'slug', slug)).toBe(1)
    expect((await service.useCases.viewOrganizations(second.userId)).memberships).toEqual([])
  })

  it('refuse un identifiant réservé avec le même motif qu’un identifiant pris', async () => {
    // Le motif est le même : distinguer les deux ferait du formulaire un test
    // d'existence d'organisation (`docs/security.md` §7). La règle est éprouvée
    // dans le `domain` ; ici on prouve que la route l'appelle et n'écrit rien.
    const account = await anAccount()

    const refused = await call('create', {
      session: account,
      body: { name: 'Compte', slug: 'account' },
    })

    expect(refused.headers.get('location')).toBe(
      `${APP_URL}/organizations?error=slug_unavailable`,
    )
    expect(await countRows('organization', 'slug', 'account')).toBe(0)
  })

  it('refuse un nom vide sans rien écrire', async () => {
    const account = await anAccount()
    const slug = aSlug()

    const refused = await call('create', { session: account, body: { name: '  ', slug } })

    expect(refused.headers.get('location')).toBe(`${APP_URL}/organizations?error=invalid_name`)
    expect(await countRows('organization', 'slug', slug)).toBe(0)
  })
})

describe.runIf(databaseReachable)('l’organisation courante', () => {
  it('persiste hors de la session : elle est relue par compte', async () => {
    const account = await anAccount()

    await call('create', { session: account, body: { name: 'Première', slug: aSlug() } })
    await call('create', { session: account, body: { name: 'Seconde', slug: aSlug() } })

    const active = await service.useCases.activeOrganizationId(account.userId)

    // Rien de tout cela ne dépend d'un cookie : une seconde session du même
    // compte lit la même ligne. C'est ce qui rend le critère 2 vrai « entre
    // deux sessions ».
    expect(active).not.toBeNull()

    const stored = await connection.db.execute<{ organization_id: string }>(
      sql`select organization_id from organization_active_selection where user_id = ${account.userId}`,
    )

    expect(stored.rows[0]?.organization_id).toBe(active)
  })

  it('se rejoue sans effet supplémentaire', async () => {
    const account = await anAccount()

    await call('create', { session: account, body: { name: 'Studio', slug: aSlug() } })

    const [organization] = await service.useCases
      .viewOrganizations(account.userId)
      .then((view) => view.memberships)

    await call('switch', { session: account, body: { organizationId: organization?.id ?? '' } })
    await call('switch', { session: account, body: { organizationId: organization?.id ?? '' } })

    // Une seule ligne, quelle que soit la répétition (`docs/reliability.md` §1).
    expect(await countRows('organization_active_selection', 'user_id', account.userId)).toBe(1)
  })

  /**
   * **Le retrait d'un membre, c'est-à-dire le geste de s16.**
   *
   * La sélection courante est une ligne indexée par compte : rien ne l'efface
   * quand l'appartenance disparaît, et rien ne doit l'effacer — c'est la
   * **lecture** qui porte l'appartenance, comme partout ailleurs dans ce
   * module. Sans elle, `dataOwnerOf` rendrait encore le périmètre d'une
   * organisation quittée, et la première story qui rattache une donnée à une
   * organisation (s16) écrirait dans celle-là.
   */
  it('cesse de résoudre vers une organisation qu’on a quittée', async () => {
    const founder = await anAccount()
    const departing = await anAccount()
    const slug = aSlug()

    await call('create', { session: founder, body: { name: 'Studio quitté', slug } })

    const organizationId = await service.useCases.activeOrganizationId(founder.userId)

    expect(organizationId).not.toBeNull()

    // Un second membre, posé comme s16 le posera. **L'organisation garde donc
    // un membre après le retrait** : sans ce détail, une jointure qui oublie
    // le compte et ne garde que l'organisation passerait — mesuré, elle
    // passait.
    await connection.db.execute(
      sql`insert into organization_member (id, organization_id, user_id, role)
          values (${`mbr_s15_left_${departing.userId}`}, ${organizationId}, ${departing.userId}, 'member')`,
    )

    await call('switch', { session: departing, body: { organizationId: organizationId ?? '' } })

    expect(await service.useCases.activeOrganizationId(departing.userId)).toBe(organizationId)

    // Le retrait, tel que s16 le fera : l'appartenance seule.
    await connection.db.execute(
      sql`delete from organization_member where user_id = ${departing.userId}`,
    )

    // La ligne de sélection est **toujours là** : ce n'est pas un nettoyage qui
    // tient l'invariant, c'est le prédicat de la lecture.
    expect(await countRows('organization_active_selection', 'user_id', departing.userId)).toBe(1)

    expect(await service.useCases.activeOrganizationId(departing.userId)).toBeNull()

    // Et l'organisation, elle, résout toujours pour qui en est resté membre :
    // la lecture filtre le demandeur, elle n'invalide pas la sélection de tous.
    expect(await service.useCases.activeOrganizationId(founder.userId)).toBe(organizationId)

    const { dataOwnerOf, organizations } = await import('../apps/web/lib/organizations')

    if (organizations.available) {
      // Le périmètre retombe sur le compte, immédiatement et sans écriture.
      expect(await dataOwnerOf(departing)).toEqual({ kind: 'user', userId: departing.userId })
    }
  })
})

/* ------------------------------------------------------------------------- *
 * s16 — l'invitation, l'acceptation et le retrait.
 *
 * Le même chemin qu'une requête de l'application : le répartiteur, une vraie
 * base, la vraie règle. Ce bloc ne rejoue pas la matrice du `domain`
 * (`packages/modules/organizations/src/domain/organization-rules.test.ts`) : il
 * prouve que ces règles sont **appelées**, qu'un refus n'écrit rien, et que ce
 * qui doit être rejouable l'est.
 * ------------------------------------------------------------------------- */

/** Une organisation neuve, dont le compte donné est propriétaire. */
const anOrganization = async (session: ModuleSession): Promise<string> => {
  await call('create', { session, body: { name: 'Studio Martin', slug: aSlug() } })

  const active = await service.useCases.activeOrganizationId(session.userId)

  if (active === null) {
    throw new Error('L’organisation n’a pas été créée.')
  }

  return active
}

const invitationsOf = async (session: ModuleSession) =>
  (await service.useCases.viewOrganizations(session.userId)).invitations

const membersOf = async (session: ModuleSession) =>
  (await service.useCases.viewOrganizations(session.userId)).members

describe.runIf(databaseReachable)('l’émission d’une invitation', () => {
  it('écrit une invitation en attente et envoie un lien dont la base ne garde que l’empreinte', async () => {
    const founder = await anAccount()
    const organizationId = await anOrganization(founder)
    const guest = anUnknownEmail()

    const response = await call('invite', {
      session: founder,
      body: { organizationId, email: guest },
    })

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(`${APP_URL}/organizations`)

    // L'email part au destinataire, avec le template **qualifié par le module**.
    const sent = outbox.sent.at(-1)

    expect(sent?.to).toBe(guest)
    expect(sent?.template).toBe('organizations.invitation')

    // L'invitation apparaît dans la liste en attente (critère 1).
    expect(await invitationsOf(founder)).toEqual([
      expect.objectContaining({ email: guest, status: 'pending' }),
    ])

    // **Le jeton est un secret** : il voyage dans le lien, la base n'en garde
    // que l'empreinte. Un vol de la table ne rend aucun lien utilisable — c'est
    // exactement ce que s07 n'avait pas tenu pour la réinitialisation.
    const token = tokenOf(lastInvitationLink())

    expect(token.length).toBeGreaterThan(20)
    expect(await countRows('organization_invitation', 'token_hash', token)).toBe(0)

    const digest = createHash('sha256').update(token).digest('base64url')

    expect(await countRows('organization_invitation', 'token_hash', digest)).toBe(1)
  })

  it('répond exactement la même chose que l’adresse ait un compte ou non', async () => {
    // `docs/security.md` §7 : inviter ne doit **rien** apprendre de l'existence
    // d'un compte. Le module ne sait d'ailleurs pas interroger `auth_user` par
    // adresse — c'est ce qui rend l'absence d'énumération structurelle.
    const founder = await anAccount()
    const organizationId = await anOrganization(founder)
    const known = await anAccount()
    const knownEmail = `s15-connu-${randomUUID()}@example.test`
    const unknownEmail = anUnknownEmail()

    await connection.db.execute(
      sql`update auth_user set email = ${knownEmail} where id = ${known.userId}`,
    )

    const first = await call('invite', {
      session: founder,
      body: { organizationId, email: knownEmail },
    })
    const second = await call('invite', {
      session: founder,
      body: { organizationId, email: unknownEmail },
    })

    expect(second.status).toBe(first.status)
    expect(second.headers.get('location')).toBe(first.headers.get('location'))
    expect(await invitationsOf(founder)).toHaveLength(2)
  })

  it('rend 404 sur l’organisation d’un autre, sans rien écrire', async () => {
    const founder = await anAccount()
    const organizationId = await anOrganization(founder)
    const stranger = await anAccount()

    const refused = await call('invite', {
      session: stranger,
      body: { organizationId, email: anUnknownEmail() },
    })

    expect(refused.status).toBe(404)
    expect(await countRows('organization_invitation', 'organization_id', organizationId)).toBe(0)
  })

  it('refuse d’inviter quelqu’un qui est déjà membre, à la casse près', async () => {
    const email = `s15-membre-${randomUUID()}@example.test`
    const founder = await anAccount(email)
    const organizationId = await anOrganization(founder)

    const refused = await call('invite', {
      session: founder,
      body: { organizationId, email: email.toUpperCase() },
    })

    expect(refused.headers.get('location')).toBe(`${APP_URL}/organizations?error=already_member`)
    expect(await countRows('organization_invitation', 'organization_id', organizationId)).toBe(0)
  })

  it('refuse une seconde invitation vivante pour la même adresse, sans doubler la ligne', async () => {
    const founder = await anAccount()
    const organizationId = await anOrganization(founder)
    const guest = anUnknownEmail()

    await call('invite', { session: founder, body: { organizationId, email: guest } })
    const refused = await call('invite', {
      session: founder,
      body: { organizationId, email: guest },
    })

    expect(refused.headers.get('location')).toBe(`${APP_URL}/organizations?error=already_invited`)
    expect(await countRows('organization_invitation', 'email', guest)).toBe(1)
  })

  it('refuse une adresse malformée sans rien écrire ni rien envoyer', async () => {
    const founder = await anAccount()
    const organizationId = await anOrganization(founder)
    const before = outbox.sent.length

    const refused = await call('invite', {
      session: founder,
      body: { organizationId, email: 'pas-une-adresse' },
    })

    expect(refused.headers.get('location')).toBe(`${APP_URL}/organizations?error=invalid_email`)
    expect(await countRows('organization_invitation', 'organization_id', organizationId)).toBe(0)
    expect(outbox.sent.length).toBe(before)
  })

  it('refuse au-delà du quota d’émission de l’organisation', async () => {
    const founder = await anAccount()
    const organizationId = await anOrganization(founder)

    for (let issued = 0; issued < INVITATION_QUOTA_PER_WINDOW; issued += 1) {
      const accepted = await call('invite', {
        session: founder,
        body: { organizationId, email: anUnknownEmail() },
      })

      expect(accepted.headers.get('location')).toBe(`${APP_URL}/organizations`)
    }

    const refused = await call('invite', {
      session: founder,
      body: { organizationId, email: anUnknownEmail() },
    })

    expect(refused.headers.get('location')).toBe(`${APP_URL}/organizations?error=invitation_quota`)
    expect(await countRows('organization_invitation', 'organization_id', organizationId)).toBe(
      INVITATION_QUOTA_PER_WINDOW,
    )
  })

  it('rouvre le quota une fois la fenêtre passée', async () => {
    // **La fenêtre glissante, observée** (constat F4). Sans ce cas, retirer
    // `created_at >= since` du comptage laissait 957 tests verts : le quota
    // devenait un quota **à vie**, et une organisation qui a émis vingt
    // invitations depuis sa création n'en aurait plus jamais émis une seule.
    //
    // C'est pour cette fenêtre que l'instant d'émission est écrit depuis
    // l'horloge du module : la même horloge décide de l'échéance et du
    // comptage, et c'est ce qui rend la fenêtre mesurable ici.
    const founder = await anAccount()
    const organizationId = await anOrganization(founder)
    const issuedAt = clock

    try {
      for (let issued = 0; issued < INVITATION_QUOTA_PER_WINDOW; issued += 1) {
        await call('invite', { session: founder, body: { organizationId, email: anUnknownEmail() } })
      }

      const refused = await call('invite', {
        session: founder,
        body: { organizationId, email: anUnknownEmail() },
      })

      expect(refused.headers.get('location')).toBe(
        `${APP_URL}/organizations?error=invitation_quota`,
      )

      // Une heure plus tard, les vingt émissions sont sorties de la fenêtre.
      clock = new Date(issuedAt.getTime() + INVITATION_QUOTA_WINDOW_SECONDS * 1_000 + 1)

      const accepted = await call('invite', {
        session: founder,
        body: { organizationId, email: anUnknownEmail() },
      })

      expect(accepted.headers.get('location')).toBe(`${APP_URL}/organizations`)
      expect(await countRows('organization_invitation', 'organization_id', organizationId)).toBe(
        INVITATION_QUOTA_PER_WINDOW + 1,
      )
    } finally {
      clock = issuedAt
    }
  })

  it('laisse l’invitation en attente quand l’email ne part pas, et le dit', async () => {
    // `docs/reliability.md` §2 : une opération multi-étapes laisse un état
    // explicite permettant de la rejouer. Ici, l'état est « en attente », et le
    // rejeu est le renvoi.
    const founder = await anAccount()
    const organizationId = await anOrganization(founder)
    const guest = anUnknownEmail()

    deliveryFails = true

    try {
      const response = await call('invite', {
        session: founder,
        body: { organizationId, email: guest },
      })

      expect(response.headers.get('location')).toBe(`${APP_URL}/organizations?error=email_failed`)
    } finally {
      deliveryFails = false
    }

    expect(await invitationsOf(founder)).toEqual([
      expect.objectContaining({ email: guest, status: 'pending' }),
    ])
  })
})

describe.runIf(databaseReachable)('l’acceptation d’une invitation', () => {
  /** Un invité muni de son lien : le cas nominal, réemployé par les refus. */
  const anInvitation = async (): Promise<{
    readonly founder: ModuleSession
    readonly guest: ModuleSession
    readonly organizationId: string
    readonly token: string
    readonly invitationId: string
  }> => {
    const founder = await anAccount()
    const organizationId = await anOrganization(founder)
    const email = `s15-invite-${randomUUID()}@example.test`
    const guest = await anAccount(email)

    await call('invite', { session: founder, body: { organizationId, email } })

    const [invitation] = await invitationsOf(founder)

    return {
      founder,
      guest,
      organizationId,
      token: tokenOf(lastInvitationLink()),
      invitationId: invitation?.id ?? '',
    }
  }

  it('fait de l’invité un membre, et pose l’organisation acceptée comme courante', async () => {
    // L'organisation acceptée devient **courante** : sans cela l'invité
    // atterrirait sur « Choisir une organisation » — l'état que le constat F7 de
    // la revue de s15 nommait déjà comme celui d'un compte invité.
    const { guest, organizationId, token } = await anInvitation()

    const accepted = await call('acceptInvitation', { session: guest, body: { token } })

    expect(accepted.status).toBe(303)
    expect(accepted.headers.get('location')).toBe(`${APP_URL}/organizations`)

    const view = await service.useCases.viewOrganizations(guest.userId)

    expect(view.memberships.map((membership) => membership.id)).toContain(organizationId)
    expect(view.current?.id).toBe(organizationId)
    expect(view.current?.role).toBe('member')
  })

  it('se rejoue sans créer une seconde appartenance, et le second essai le dit', async () => {
    // `docs/reliability.md` §1 : « idempotent » se prouve en exécutant deux
    // fois et en constatant **un** effet.
    const { guest, organizationId, token } = await anInvitation()

    await call('acceptInvitation', { session: guest, body: { token } })
    const replayed = await call('acceptInvitation', { session: guest, body: { token } })

    expect(replayed.headers.get('location')).toBe(
      `${APP_URL}/invitations/accept?token=${token}&error=invitation_accepted`,
    )
    expect(
      await countRows('organization_member', 'organization_id', organizationId),
    ).toBe(2)
  })

  it('refuse un lien révoqué, et n’ajoute aucun membre', async () => {
    const { founder, guest, organizationId, token, invitationId } = await anInvitation()

    await call('revokeInvitation', { session: founder, body: { organizationId, invitationId } })

    const refused = await call('acceptInvitation', { session: guest, body: { token } })

    expect(refused.headers.get('location')).toContain('error=invitation_revoked')
    expect(await countRows('organization_member', 'organization_id', organizationId)).toBe(1)
  })

  it('refuse un lien échu, et n’ajoute aucun membre', async () => {
    const { guest, organizationId, token } = await anInvitation()
    const issuedAt = clock

    clock = new Date(issuedAt.getTime() + 8 * 24 * 60 * 60 * 1_000)

    try {
      const refused = await call('acceptInvitation', { session: guest, body: { token } })

      expect(refused.headers.get('location')).toContain('error=invitation_expired')
    } finally {
      clock = issuedAt
    }

    expect(await countRows('organization_member', 'organization_id', organizationId)).toBe(1)
  })

  it('refuse un lien inconnu', async () => {
    const guest = await anAccount()

    const refused = await call('acceptInvitation', {
      session: guest,
      body: { token: 'jeton-invente' },
    })

    expect(refused.headers.get('location')).toContain('error=invitation_unknown')
  })

  it('refuse un lien émis pour une autre adresse que celle du compte connecté', async () => {
    // Le lien est un secret, mais il n'est pas transférable : il autorise **une
    // adresse**. Faire suivre l'email ne donne donc pas l'accès à qui le reçoit.
    const { organizationId, token } = await anInvitation()
    const someoneElse = await anAccount()

    const refused = await call('acceptInvitation', { session: someoneElse, body: { token } })

    expect(refused.headers.get('location')).toContain('error=invitation_other_recipient')
    expect(await countRows('organization_member', 'organization_id', organizationId)).toBe(1)
  })

  it('n’accepte rien en GET : ouvrir le lien ne le consomme pas', async () => {
    // Un aperçu de lien — client de messagerie, antivirus, proxy — suit les
    // `GET`. Une route d'acceptation en `GET` consommerait donc le jeton à
    // usage unique avant que l'invité ne l'ouvre.
    const { guest, token } = await anInvitation()

    const opened = await dispatchModuleRequest(
      registry,
      new Request(`${APP_URL}${organizationRoutePath('acceptInvitation')}?token=${token}`, {
        method: 'GET',
      }),
      { resolveSession: () => Promise.resolve(guest) },
    )

    expect(opened.status).toBe(404)
    expect(await service.useCases.describeInvitation(token)).toMatchObject({ status: 'pending' })
  })

  it('refuse l’acceptation à qui n’est pas connecté, avant d’atteindre la base', async () => {
    const { organizationId, token } = await anInvitation()

    const anonymous = await call('acceptInvitation', { session: null, body: { token } })

    expect(anonymous.status).toBe(401)
    expect(await countRows('organization_member', 'organization_id', organizationId)).toBe(1)
  })
})

describe.runIf(databaseReachable)('la révocation et le renvoi', () => {
  it('renvoie l’invitation en tournant son jeton : l’ancien lien meurt', async () => {
    const founder = await anAccount()
    const organizationId = await anOrganization(founder)
    const email = `s15-renvoi-${randomUUID()}@example.test`
    const guest = await anAccount(email)

    await call('invite', { session: founder, body: { organizationId, email } })

    const firstToken = tokenOf(lastInvitationLink())
    const [invitation] = await invitationsOf(founder)

    const resent = await call('resendInvitation', {
      session: founder,
      body: { organizationId, invitationId: invitation?.id ?? '' },
    })

    expect(resent.headers.get('location')).toBe(`${APP_URL}/organizations`)

    const secondToken = tokenOf(lastInvitationLink())

    expect(secondToken).not.toBe(firstToken)
    // **Une seule invitation vivante** : un renvoi ne double pas la ligne de la
    // liste, et n'ouvre pas un second lien utilisable. La ligne précédente
    // reste en base, éteinte — c'est elle qui fait du renvoi une émission
    // comptée par le quota (constat F2).
    expect(await invitationsOf(founder)).toEqual([
      expect.objectContaining({ email, status: 'pending' }),
    ])

    const withOldLink = await call('acceptInvitation', {
      session: guest,
      body: { token: firstToken },
    })

    expect(withOldLink.headers.get('location')).toContain('error=invitation_unknown')

    const withNewLink = await call('acceptInvitation', {
      session: guest,
      body: { token: secondToken },
    })

    expect(withNewLink.headers.get('location')).toBe(`${APP_URL}/organizations`)
  })

  it('compte le renvoi dans le quota d’émission de l’organisation', async () => {
    // **Le quota est un quota d'émission** (ADR 026), et un renvoi est une
    // émission : c'est un email de plus expédié depuis le domaine du produit.
    // Mesuré avant la correction : cinquante renvois consécutifs de la même
    // invitation envoyaient cinquante emails, sans un seul refus (constat F2).
    const founder = await anAccount()
    const organizationId = await anOrganization(founder)
    const email = `s15-quota-renvoi-${randomUUID()}@example.test`

    await call('invite', { session: founder, body: { organizationId, email } })

    // La première émission est l'invitation ; les suivantes sont des renvois.
    for (let issued = 1; issued < INVITATION_QUOTA_PER_WINDOW; issued += 1) {
      const [invitation] = await invitationsOf(founder)
      const resent = await call('resendInvitation', {
        session: founder,
        body: { organizationId, invitationId: invitation?.id ?? '' },
      })

      expect(resent.headers.get('location')).toBe(`${APP_URL}/organizations`)
    }

    const [invitation] = await invitationsOf(founder)
    const sentBefore = outbox.sent.length

    const refused = await call('resendInvitation', {
      session: founder,
      body: { organizationId, invitationId: invitation?.id ?? '' },
    })

    expect(refused.headers.get('location')).toBe(`${APP_URL}/organizations?error=invitation_quota`)
    // Le refus n'atteint pas le port d'envoi : c'est l'email que le quota borne.
    expect(outbox.sent.length).toBe(sentBefore)
  })

  it('retire une invitation révoquée de la liste en attente, et se rejoue sans effet', async () => {
    const founder = await anAccount()
    const organizationId = await anOrganization(founder)

    await call('invite', { session: founder, body: { organizationId, email: anUnknownEmail() } })

    const [invitation] = await invitationsOf(founder)
    const invitationId = invitation?.id ?? ''

    await call('revokeInvitation', { session: founder, body: { organizationId, invitationId } })

    expect(await invitationsOf(founder)).toEqual([])

    const replayed = await call('revokeInvitation', {
      session: founder,
      body: { organizationId, invitationId },
    })

    expect(replayed.headers.get('location')).toBe(
      `${APP_URL}/organizations?error=invitation_unknown`,
    )
    expect(await countRows('organization_invitation', 'id', invitationId)).toBe(1)
  })

  it('refuse d’agir sur l’invitation d’une autre organisation', async () => {
    const founder = await anAccount()
    const organizationId = await anOrganization(founder)

    await call('invite', { session: founder, body: { organizationId, email: anUnknownEmail() } })

    const [invitation] = await invitationsOf(founder)
    const invitationId = invitation?.id ?? ''

    // Un compte qui a **sa propre** organisation : l'identifiant d'organisation
    // qu'il fournit est légitimement le sien, seule l'invitation ne l'est pas.
    const other = await anAccount()
    const otherOrganizationId = await anOrganization(other)

    const refused = await call('revokeInvitation', {
      session: other,
      body: { organizationId: otherOrganizationId, invitationId },
    })

    expect(refused.headers.get('location')).toBe(
      `${APP_URL}/organizations?error=invitation_unknown`,
    )
    expect(await invitationsOf(founder)).toHaveLength(1)

    // Et par l'autre porte : l'identifiant d'organisation d'autrui rend 404.
    const disguised = await call('revokeInvitation', {
      session: other,
      body: { organizationId, invitationId },
    })

    expect(disguised.status).toBe(404)
    expect(await invitationsOf(founder)).toHaveLength(1)
  })

  it('refuse de renvoyer l’invitation d’une autre organisation, sans toucher son jeton', async () => {
    // Le **cas jumeau** du précédent, absent jusqu'au tour de correction
    // (constat F3) : retirer `organization_id` du prédicat du renvoi laissait
    // 957 tests verts. Sans lui, un membre de A ferait tourner le jeton d'une
    // invitation de B — l'invité de B perdrait son lien — et déclencherait un
    // email vers l'adresse de B.
    const founder = await anAccount()
    const organizationId = await anOrganization(founder)
    const email = `s15-jumeau-${randomUUID()}@example.test`
    const guest = await anAccount(email)

    await call('invite', { session: founder, body: { organizationId, email } })

    const link = lastInvitationLink()
    const [invitation] = await invitationsOf(founder)
    const invitationId = invitation?.id ?? ''
    const sentBefore = outbox.sent.length

    const other = await anAccount()
    const otherOrganizationId = await anOrganization(other)

    const refused = await call('resendInvitation', {
      session: other,
      body: { organizationId: otherOrganizationId, invitationId },
    })

    expect(refused.headers.get('location')).toBe(
      `${APP_URL}/organizations?error=invitation_unknown`,
    )
    // **Aucun email n'est parti** : le refus n'atteint pas le port d'envoi.
    expect(outbox.sent.length).toBe(sentBefore)

    // Et le jeton de l'invitation de l'autre organisation vit toujours : c'est
    // ce que le prédicat de périmètre protège.
    const accepted = await call('acceptInvitation', {
      session: guest,
      body: { token: tokenOf(link) },
    })

    expect(accepted.headers.get('location')).toBe(`${APP_URL}/organizations`)
  })
})

describe.runIf(databaseReachable)('le retrait d’un membre', () => {
  /** Une organisation à deux : un fondateur, un membre entré par invitation. */
  const anOrganizationOfTwo = async (): Promise<{
    readonly founder: ModuleSession
    readonly member: ModuleSession
    readonly organizationId: string
  }> => {
    const founder = await anAccount()
    const organizationId = await anOrganization(founder)
    const email = `s15-equipier-${randomUUID()}@example.test`
    const member = await anAccount(email)

    await call('invite', { session: founder, body: { organizationId, email } })
    await call('acceptInvitation', {
      session: member,
      body: { token: tokenOf(lastInvitationLink()) },
    })

    return { founder, member, organizationId }
  }

  it('fait perdre l’accès immédiatement, à la **même** session, sans reconnexion', async () => {
    // C'est ce qui remplace la rotation d'identifiant de session (ADR 026) : le
    // jeton ne porte aucune autorité organisationnelle, donc le retrait de la
    // ligne suffit. Si le jeton mettait un droit en cache, ce cas rougirait.
    const { founder, member, organizationId } = await anOrganizationOfTwo()
    const { dataOwnerOf, organizations } = await import('../apps/web/lib/organizations')

    expect(await service.useCases.activeOrganizationId(member.userId)).toBe(organizationId)

    const removed = await call('removeMember', {
      session: founder,
      body: { organizationId, userId: member.userId },
    })

    expect(removed.headers.get('location')).toBe(`${APP_URL}/organizations`)
    expect(await service.useCases.activeOrganizationId(member.userId)).toBeNull()
    expect((await service.useCases.viewOrganizations(member.userId)).memberships).toEqual([])

    if (organizations.available) {
      expect(await dataOwnerOf(member)).toEqual({ kind: 'user', userId: member.userId })
    }

    // Et la ligne de sélection est **toujours là** : c'est la lecture qui porte
    // l'appartenance, pas un nettoyage (ADR 025).
    expect(await countRows('organization_active_selection', 'user_id', member.userId)).toBe(1)
  })

  it('laisse un membre se retirer lui-même', async () => {
    const { member, organizationId } = await anOrganizationOfTwo()

    const left = await call('removeMember', {
      session: member,
      body: { organizationId, userId: member.userId },
    })

    expect(left.headers.get('location')).toBe(`${APP_URL}/organizations`)
    expect(await countRows('organization_member', 'organization_id', organizationId)).toBe(1)
  })

  it('refuse de retirer le dernier propriétaire, y compris par lui-même', async () => {
    const { founder, member, organizationId } = await anOrganizationOfTwo()

    // **Depuis s17, ce refus arrive plus tôt** : un simple membre ne retire
    // personne d'autre, donc il n'atteint même pas la règle du dernier
    // propriétaire — 403, avant toute écriture. Le refus `last_owner` par un
    // tiers est d'ailleurs devenu inatteignable : pour retirer un propriétaire
    // il faut en être un, et il y en a alors deux.
    const refusedByOther = await call('removeMember', {
      session: member,
      body: { organizationId, userId: founder.userId },
    })

    expect(refusedByOther.status).toBe(403)

    const refusedBySelf = await call('removeMember', {
      session: founder,
      body: { organizationId, userId: founder.userId },
    })

    expect(refusedBySelf.headers.get('location')).toBe(`${APP_URL}/organizations?error=last_owner`)
    expect(await countRows('organization_member', 'user_id', founder.userId)).toBe(1)
  })

  it('garde un propriétaire quand deux retraits partent ensemble, à chaque course', async () => {
    // **La course, exercée par construction** (constat F1 de la revue).
    //
    // Deux propriétaires, une **seule** session, deux soumissions parallèles :
    // « retirer l'autre » et « me retirer ». C'est le geste que l'écran offre —
    // deux clics rapprochés sur deux boutons —, et sans sérialisation il laisse
    // l'organisation sans personne pour la gouverner, état qu'aucune route de
    // s16 ne rattrape (aucune promotion avant s17).
    //
    // Dix courses, et non une : une course qu'on n'attrape qu'un tirage sur
    // quatre est un test plus étroit que son nom. Les deux connexions du pool
    // sont réveillées avant la mesure, et les deux requêtes partent dans le même
    // tour de boucle — la fenêtre est ouverte aussi large que possible.
    const RACES = 10
    const remaining: number[] = []

    for (let race = 0; race < RACES; race += 1) {
      const founder = await anAccount()
      const organizationId = await anOrganization(founder)
      const second = await anAccount()

      // Un **second propriétaire** : le produit n'en fabrique pas encore (la
      // promotion est s17), et l'invariant ne se mesure qu'à partir de deux.
      await connection.db.insert(organizationMember).values({
        id: generateId('mbr'),
        organizationId,
        userId: second.userId,
        role: 'owner',
      })

      // La barrière : deux connexions déjà ouvertes, pour que l'acquisition
      // d'une connexion ne sérialise pas ce que la course doit mesurer.
      await Promise.all([
        connection.db.execute(sql`select 1`),
        connection.db.execute(sql`select 1`),
      ])

      await Promise.all([
        call('removeMember', {
          session: founder,
          body: { organizationId, userId: second.userId },
        }),
        call('removeMember', {
          session: founder,
          body: { organizationId, userId: founder.userId },
        }),
      ])

      remaining.push(await countRows('organization_member', 'organization_id', organizationId))
    }

    // Exactement un membre restant à chaque course, et c'est un propriétaire :
    // les deux comptes de la course le sont.
    expect(remaining).toEqual(Array.from({ length: RACES }, () => 1))
  })

  it('refuse de retirer quelqu’un qui n’est pas membre', async () => {
    const { founder, organizationId } = await anOrganizationOfTwo()
    const stranger = await anAccount()

    const refused = await call('removeMember', {
      session: founder,
      body: { organizationId, userId: stranger.userId },
    })

    expect(refused.headers.get('location')).toBe(`${APP_URL}/organizations?error=not_a_member`)
  })

  it('refuse de retirer un membre d’une autre organisation', async () => {
    // Le **cas jumeau** du refus de révocation, absent jusqu'au tour de
    // correction (constat F3) : retirer `organization_id` du prédicat du
    // retrait laissait 957 tests verts. Sans lui, l'appelant supprimerait
    // l'appartenance de sa cible dans **toutes** les organisations où elle est
    // membre, en fournissant l'identifiant de la sienne.
    const { member, organizationId } = await anOrganizationOfTwo()

    const other = await anAccount()
    const otherOrganizationId = await anOrganization(other)

    const refused = await call('removeMember', {
      session: other,
      body: { organizationId: otherOrganizationId, userId: member.userId },
    })

    expect(refused.headers.get('location')).toBe(`${APP_URL}/organizations?error=not_a_member`)
    expect(await countRows('organization_member', 'organization_id', organizationId)).toBe(2)
  })

  it('rend 404 quand l’organisation n’est pas la sienne', async () => {
    const { member, organizationId } = await anOrganizationOfTwo()
    const stranger = await anAccount()

    const refused = await call('removeMember', {
      session: stranger,
      body: { organizationId, userId: member.userId },
    })

    expect(refused.status).toBe(404)
    expect(await countRows('organization_member', 'organization_id', organizationId)).toBe(2)
  })
})

/* ------------------------------------------------------------------------- *
 * s17 — les permissions.
 *
 * La **matrice** est éprouvée une fois, à la règle
 * (`packages/modules/organizations/src/domain/organization-rules.test.ts`). Ce
 * bloc prouve autre chose, et qui ne se prouve nulle part ailleurs : que chaque
 * porte l'**appelle**, que le refus est un 403 côté serveur — donc qu'un appel
 * direct échoue même quand l'écran a masqué le déclencheur —, et qu'un refus
 * n'écrit rien.
 * ------------------------------------------------------------------------- */

/**
 * Une organisation, son propriétaire, et un second compte au rôle demandé.
 *
 * L'appartenance du second est **écrite directement** : construire un `admin`
 * avec la route de changement de rôle ferait des fixtures qui dépendent du code
 * que ces cas mesurent.
 */
const anOrganizationWithRole = async (
  role: OrganizationRole,
): Promise<{
  readonly owner: ModuleSession
  readonly other: ModuleSession
  readonly organizationId: string
}> => {
  const owner = await anAccount()
  const organizationId = await anOrganization(owner)
  const other = await anAccount()

  await connection.db.insert(organizationMember).values({
    id: generateId('mbr'),
    organizationId,
    userId: other.userId,
    role,
  })

  return { owner, other, organizationId }
}

describe.runIf(databaseReachable)('le refus d’un rôle insuffisant', () => {
  it('rend 403 à un membre de l’organisation, et 404 à qui n’en est pas', async () => {
    // **Le partage 403 / 404 se fait sur l'appartenance, pas sur le rôle.**
    // Un membre sait déjà que son organisation existe : lui répondre 403 ne lui
    // apprend rien. Un non-membre, lui, ne doit pas l'apprendre — d'où le 404,
    // et d'où l'ordre : autorisation d'abord, permission ensuite
    // (`docs/security.md` §3).
    const { owner, other, organizationId } = await anOrganizationWithRole('member')

    const forbidden = await call('update', {
      session: other,
      body: { organizationId, name: 'Renommé par un membre', slug: aSlug() },
    })

    expect(forbidden.status).toBe(403)

    // Un compte qui a **sa propre** organisation, donc un rôle quelque part :
    // sur celle-ci, il n'est rien, et la réponse ne le distingue pas d'une
    // organisation inexistante.
    const elsewhere = await anAccount()

    await anOrganization(elsewhere)

    const hidden = await call('update', {
      session: elsewhere,
      body: { organizationId, name: 'Renommé par un étranger', slug: aSlug() },
    })

    expect(hidden.status).toBe(404)

    // Et aucun des deux refus n'a écrit quoi que ce soit.
    const after = await service.useCases.viewOrganizations(owner.userId)

    expect(after.current?.name).toBe('Studio Martin')
  })

  it('ferme les quatre autres portes à un simple membre, sans rien écrire ni envoyer', async () => {
    // **Un témoin par porte**, et rien de plus : la matrice est éprouvée à la
    // règle. Ce qui se prouve ici, c'est que chacune l'appelle — retirer la
    // garde d'une seule fait rougir ce cas.
    const { owner, other, organizationId } = await anOrganizationWithRole('member')

    // **La cible du retrait est un membre parfaitement retirable**, et c'est le
    // détail qui décide : viser le propriétaire ferait passer le cas par la
    // règle du dernier propriétaire, et la garde de rôle pourrait sauter sans
    // que rien ne rougisse — mesuré, la première version de ce cas restait
    // verte sous mutation.
    const bystander = await anAccount()

    await connection.db.insert(organizationMember).values({
      id: generateId('mbr'),
      organizationId,
      userId: bystander.userId,
      role: 'member',
    })

    await call('invite', { session: owner, body: { organizationId, email: anUnknownEmail() } })

    const [invitation] = await invitationsOf(owner)
    const invitationId = invitation?.id ?? ''
    const sentBefore = outbox.sent.length

    const refusals = await Promise.all([
      call('invite', { session: other, body: { organizationId, email: anUnknownEmail() } }),
      call('resendInvitation', { session: other, body: { organizationId, invitationId } }),
      call('revokeInvitation', { session: other, body: { organizationId, invitationId } }),
      call('removeMember', { session: other, body: { organizationId, userId: bystander.userId } }),
    ])

    expect(refusals.map((response) => response.status)).toEqual([403, 403, 403, 403])

    // Aucun email n'est parti, l'invitation est intacte, et les trois membres
    // sont toujours là — un refus qui atteint la donnée n'est pas un refus.
    expect(outbox.sent.length).toBe(sentBefore)
    expect(await invitationsOf(owner)).toEqual([
      expect.objectContaining({ id: invitationId, status: 'pending' }),
    ])
    expect(await countRows('organization_member', 'organization_id', organizationId)).toBe(3)
  })

  it('refuse un rôle que la matrice ne connaît pas, sans faillir en 500', async () => {
    // La base ne contraint pas la valeur de `organization_member.role` : une
    // ligne portant un rôle inconnu est représentable, et le rôle est relu à
    // chaque requête. Elle doit **refuser**, pas lever (revue de s17, F3).
    const owner = await anAccount()
    const organizationId = await anOrganization(owner)
    const outsider = await anAccount()

    await connection.db.insert(organizationMember).values({
      id: generateId('mbr'),
      organizationId,
      userId: outsider.userId,
      role: 'superadmin' as OrganizationRole,
    })

    const refused = await call('update', {
      session: outsider,
      body: { organizationId, name: 'Renommé par un rôle inconnu', slug: aSlug() },
    })

    expect(refused.status).toBe(403)
  })

  it('laisse un simple membre quitter l’organisation', async () => {
    // Quitter n'est pas une action d'administration : c'est le geste de la
    // personne sur sa propre appartenance. Le fermer avec le reste priverait un
    // membre du seul geste qui lui reste.
    const { other, organizationId } = await anOrganizationWithRole('member')

    const left = await call('removeMember', {
      session: other,
      body: { organizationId, userId: other.userId },
    })

    expect(left.headers.get('location')).toBe(`${APP_URL}/organizations`)
    expect(await countRows('organization_member', 'organization_id', organizationId)).toBe(1)
  })

  it('laisse un administrateur inviter et retirer un membre', async () => {
    const { owner, other: admin, organizationId } = await anOrganizationWithRole('admin')
    const newcomer = await anAccount()

    await connection.db.insert(organizationMember).values({
      id: generateId('mbr'),
      organizationId,
      userId: newcomer.userId,
      role: 'member',
    })

    const invited = await call('invite', {
      session: admin,
      body: { organizationId, email: anUnknownEmail() },
    })

    expect(invited.headers.get('location')).toBe(`${APP_URL}/organizations`)

    const removed = await call('removeMember', {
      session: admin,
      body: { organizationId, userId: newcomer.userId },
    })

    expect(removed.headers.get('location')).toBe(`${APP_URL}/organizations`)
    expect(await countRows('organization_member', 'user_id', newcomer.userId)).toBe(0)
    expect(await countRows('organization_member', 'user_id', owner.userId)).toBe(1)
  })

  it('refuse à un administrateur de retirer un propriétaire ou un autre administrateur', async () => {
    // Critère 3 : « un admin … peut inviter et retirer des **members** », et il
    // « ne peut pas modifier un owner ». Sans cette borne, l'échelon
    // intermédiaire destitue celui du dessus — et, jusqu'à la revue de s17,
    // **son pair** : deux administrateurs pouvaient se retirer l'un l'autre,
    // une prise de pouvoir latérale que personne n'avait décidée.
    const { owner, other: admin, organizationId } = await anOrganizationWithRole('admin')
    // **Un second propriétaire**, et c'est le détail qui décide : avec un seul,
    // le retrait serait déjà refusé par la règle du dernier propriétaire, et la
    // borne de rôle pourrait sauter sans que rien ne rougisse. Ici, le retrait
    // réussirait si la borne n'était pas dans le prédicat — mesuré.
    const secondOwner = await anAccount()

    await connection.db.insert(organizationMember).values({
      id: generateId('mbr'),
      organizationId,
      userId: secondOwner.userId,
      role: 'owner',
    })

    // Un **second administrateur**, la cible de la borne neuve.
    const peer = await anAccount()

    await connection.db.insert(organizationMember).values({
      id: generateId('mbr'),
      organizationId,
      userId: peer.userId,
      role: 'admin',
    })

    const refused = await call('removeMember', {
      session: admin,
      body: { organizationId, userId: owner.userId },
    })

    expect(refused.status).toBe(403)

    const laterally = await call('removeMember', {
      session: admin,
      body: { organizationId, userId: peer.userId },
    })

    expect(laterally.status).toBe(403)
    expect(await countRows('organization_member', 'user_id', owner.userId)).toBe(1)
    expect(await countRows('organization_member', 'user_id', peer.userId)).toBe(1)
    expect(await countRows('organization_member', 'organization_id', organizationId)).toBe(4)
  })
})

describe.runIf(databaseReachable)('le changement de rôle', () => {
  /** Le rôle que la vue du propriétaire attribue à ce compte, ou `undefined`. */
  const roleOf = async (
    viewer: ModuleSession,
    userId: string,
  ): Promise<OrganizationRole | undefined> =>
    (await membersOf(viewer)).find((member) => member.userId === userId)?.role

  it('promeut un membre, puis le rétrograde, et le rejeu n’ajoute rien', async () => {
    const { owner, other, organizationId } = await anOrganizationWithRole('member')

    const promoted = await call('setMemberRole', {
      session: owner,
      body: { organizationId, userId: other.userId, role: 'admin' },
    })

    expect(promoted.headers.get('location')).toBe(`${APP_URL}/organizations`)
    expect(await roleOf(owner, other.userId)).toBe('admin')

    // Rejouable : le même ordre, le même état, aucune ligne de plus
    // (`docs/reliability.md` §1).
    const replayed = await call('setMemberRole', {
      session: owner,
      body: { organizationId, userId: other.userId, role: 'admin' },
    })

    expect(replayed.headers.get('location')).toBe(`${APP_URL}/organizations`)
    expect(await countRows('organization_member', 'user_id', other.userId)).toBe(1)

    const demoted = await call('setMemberRole', {
      session: owner,
      body: { organizationId, userId: other.userId, role: 'member' },
    })

    expect(demoted.headers.get('location')).toBe(`${APP_URL}/organizations`)
    expect(await roleOf(owner, other.userId)).toBe('member')
  })

  it('transfère la propriété : l’ancien propriétaire devient administrateur', async () => {
    // **Critère 4.** Nommer quelqu'un d'autre propriétaire *est* le transfert :
    // les deux lignes changent dans la même transaction, si bien que le nombre
    // de propriétaires ne descend jamais sous un.
    const { owner, other, organizationId } = await anOrganizationWithRole('member')

    const transferred = await call('setMemberRole', {
      session: owner,
      body: { organizationId, userId: other.userId, role: 'owner' },
    })

    expect(transferred.headers.get('location')).toBe(`${APP_URL}/organizations`)
    // Lu par l'**ancien** propriétaire : c'est lui dont l'organisation est
    // courante, et il voit sa propre destitution.
    expect(await roleOf(owner, other.userId)).toBe('owner')
    expect(await roleOf(owner, owner.userId)).toBe('admin')

    // Et l'ancien propriétaire a réellement perdu le pouvoir : il ne distribue
    // plus les rôles.
    const refused = await call('setMemberRole', {
      session: owner,
      body: { organizationId, userId: other.userId, role: 'member' },
    })

    expect(refused.status).toBe(403)
  })

  it('refuse un rôle qui n’existe pas, sans rien écrire', async () => {
    const { owner, other, organizationId } = await anOrganizationWithRole('member')

    const refused = await call('setMemberRole', {
      session: owner,
      body: { organizationId, userId: other.userId, role: 'superadmin' },
    })

    expect(refused.headers.get('location')).toBe(`${APP_URL}/organizations?error=invalid_role`)
    expect(await roleOf(owner, other.userId)).toBe('member')
  })

  it('refuse de rétrograder le dernier propriétaire', async () => {
    // La seconde voie vers « une organisation sans gouvernance », après le
    // retrait de s16. Le prédicat de l'ordre de modification compte les
    // propriétaires dans la même instruction.
    const { owner, organizationId } = await anOrganizationWithRole('member')

    const refused = await call('setMemberRole', {
      session: owner,
      body: { organizationId, userId: owner.userId, role: 'admin' },
    })

    expect(refused.headers.get('location')).toBe(`${APP_URL}/organizations?error=last_owner`)
    expect(await roleOf(owner, owner.userId)).toBe('owner')
  })

  it('laisse un propriétaire se rétrograder dès qu’il en reste un autre', async () => {
    const { owner, other, organizationId } = await anOrganizationWithRole('owner')

    const demoted = await call('setMemberRole', {
      session: owner,
      body: { organizationId, userId: owner.userId, role: 'member' },
    })

    expect(demoted.headers.get('location')).toBe(`${APP_URL}/organizations`)
    expect(await roleOf(owner, owner.userId)).toBe('member')
    expect(await roleOf(owner, other.userId)).toBe('owner')
  })

  it('refuse la distribution des rôles à un administrateur', async () => {
    const { other: admin, organizationId } = await anOrganizationWithRole('admin')
    const third = await anAccount()

    await connection.db.insert(organizationMember).values({
      id: generateId('mbr'),
      organizationId,
      userId: third.userId,
      role: 'member',
    })

    const refused = await call('setMemberRole', {
      session: admin,
      body: { organizationId, userId: third.userId, role: 'admin' },
    })

    expect(refused.status).toBe(403)
    expect(await countRows('organization_member', 'user_id', third.userId)).toBe(1)
  })

  it('garde un propriétaire quand deux rétrogradations partent ensemble, à chaque course', async () => {
    // **La seconde voie vers l'état interdit**, et elle est neuve : s16 a fermé
    // le retrait, s17 ouvre la rétrogradation. Sans sérialisation, deux ordres
    // en vol évaluent chacun la sous-requête sur l'état d'avant l'autre et
    // laissent l'organisation sans propriétaire — l'état qu'aucune route ne
    // rattrape, puisqu'il faut être propriétaire pour en nommer un.
    //
    // Une **seule** session, deux soumissions parallèles : « rétrograder
    // l'autre » et « me rétrograder ». C'est le geste que l'écran offre. Dix
    // courses, et non une : une course qu'on n'attrape qu'un tirage sur quatre
    // est un test plus étroit que son nom. Les deux connexions du pool sont
    // réveillées avant la mesure, et les deux requêtes partent dans le même
    // tour de boucle.
    const RACES = 10
    const owners: number[] = []

    for (let race = 0; race < RACES; race += 1) {
      const founder = await anAccount()
      const organizationId = await anOrganization(founder)
      const second = await anAccount()

      await connection.db.insert(organizationMember).values({
        id: generateId('mbr'),
        organizationId,
        userId: second.userId,
        role: 'owner',
      })

      await Promise.all([
        connection.db.execute(sql`select 1`),
        connection.db.execute(sql`select 1`),
      ])

      await Promise.all([
        call('setMemberRole', {
          session: founder,
          body: { organizationId, userId: second.userId, role: 'member' },
        }),
        call('setMemberRole', {
          session: founder,
          body: { organizationId, userId: founder.userId, role: 'member' },
        }),
      ])

      const counted = await connection.db.execute<{ count: number }>(
        sql`select count(*)::int as count from organization_member
            where organization_id = ${organizationId} and role = 'owner'`,
      )

      owners.push(Number(counted.rows[0]?.count ?? 0))
    }

    // Le message porte les tirages : un échec doit dire **combien** de courses
    // ont laissé l'organisation sans propriétaire, pas seulement qu'il y en a.
    expect(owners, `propriétaires restants par course : ${owners.join(', ')}`).toEqual(
      Array.from({ length: RACES }, () => 1),
    )
  })

  it('change le pouvoir à l’instant, sur la même session, sans reconnexion', async () => {
    // **Le jumeau montant du cas de s16** (« fait perdre l'accès immédiatement,
    // à la même session »), et c'est ce qui permet de ne pas faire tourner
    // l'identifiant de session à une élévation de privilège (ADR 026, ADR 030).
    //
    // Le jeton ne porte **aucune** autorité organisationnelle : le pouvoir est
    // la ligne `organization_member`, relue dans le prédicat de la lecture
    // conjointe à chaque requête. Si un jour une lecture la mettait en cache,
    // ce cas rougirait — et l'ADR 026 serait à rouvrir.
    const { owner, other, organizationId } = await anOrganizationWithRole('member')

    // La **même** valeur de session est réutilisée d'un bout à l'autre : rien
    // n'est reconnecté, rien n'est re-résolu côté appelant.
    const before = await call('invite', {
      session: other,
      body: { organizationId, email: anUnknownEmail() },
    })

    expect(before.status).toBe(403)

    await call('setMemberRole', {
      session: owner,
      body: { organizationId, userId: other.userId, role: 'admin' },
    })

    // Le pouvoir **augmente** aussitôt : aucune reconnexion, aucun nouveau
    // cookie.
    const promoted = await call('invite', {
      session: other,
      body: { organizationId, email: anUnknownEmail() },
    })

    expect(promoted.headers.get('location')).toBe(`${APP_URL}/organizations`)

    await call('setMemberRole', {
      session: owner,
      body: { organizationId, userId: other.userId, role: 'member' },
    })

    // Et il **retombe** aussitôt : c'est la réciproque, celle qui est opposable.
    const demoted = await call('invite', {
      session: other,
      body: { organizationId, email: anUnknownEmail() },
    })

    expect(demoted.status).toBe(403)
  })

  it('journalise le changement de rôle et son refus, avec leur acteur', async () => {
    // `docs/security.md` §7 nomme explicitement « changement de rôle » parmi les
    // événements de sécurité à journaliser **avec leur acteur**. Le refus de
    // permission l'est aussi : c'est le signal d'une tentative d'élévation, et
    // le module `auth` journalise déjà ses refus pour la même raison
    // (`auth.session_revocation_refused`).
    const { owner, other, organizationId } = await anOrganizationWithRole('member')

    securityEvents.length = 0

    await call('setMemberRole', {
      session: owner,
      body: { organizationId, userId: other.userId, role: 'admin' },
    })

    expect(securityEvents).toEqual([
      {
        event: 'organizations.role_changed',
        actor: owner.userId,
        organizationId,
        target: other.userId,
        role: 'admin',
        transfersOwnership: false,
      },
    ])

    securityEvents.length = 0

    // L'`admin` fraîchement nommé tente de distribuer un rôle : refusé, et
    // journalisé sous son propre compte.
    await call('setMemberRole', {
      session: other,
      body: { organizationId, userId: owner.userId, role: 'member' },
    })

    expect(securityEvents).toEqual([
      {
        event: 'organizations.role_change_refused',
        actor: other.userId,
        organizationId,
        target: owner.userId,
        role: 'member',
        transfersOwnership: false,
      },
    ])
  })

  it('refuse le droit avant de juger le corps, et journalise ce refus-là aussi', async () => {
    // **L'ordre du module, sans exception** : autorisation, puis permission,
    // puis validation (revue de s17, F5). Valider d'abord rendait à un appelant
    // sans aucun droit un 303 vers l'écran avec un motif traduit — exactement ce
    // que l'ADR 030 rejette, « un motif traduit dans l'URL décrirait la
    // politique à qui la sonde » — et surtout : une sonde d'élévation qui envoie
    // toujours un rôle malformé n'entrait **jamais** dans le journal du §7.
    const { owner, other, organizationId } = await anOrganizationWithRole('member')

    securityEvents.length = 0

    const refused = await call('setMemberRole', {
      session: other,
      body: { organizationId, userId: owner.userId, role: 'pas-un-role' },
    })

    expect(refused.status).toBe(403)
    // La cible est nommée telle qu'elle est arrivée ; le rôle, lui, n'a pas de
    // valeur connue — le journal dit `null` plutôt que d'inventer.
    expect(securityEvents).toEqual([
      {
        event: 'organizations.role_change_refused',
        actor: other.userId,
        organizationId,
        target: owner.userId,
        role: null,
        transfersOwnership: false,
      },
    ])
  })

  it('n’agit que dans l’organisation autorisée', async () => {
    // Les deux portes, comme pour la révocation et le retrait : la cible d'une
    // autre organisation n'est « pas membre », et l'identifiant d'organisation
    // d'autrui rend 404 — jamais 403, qui confirmerait son existence.
    const { other, organizationId } = await anOrganizationWithRole('member')
    const elsewhere = await anAccount()
    const otherOrganizationId = await anOrganization(elsewhere)

    const refused = await call('setMemberRole', {
      session: elsewhere,
      body: { organizationId: otherOrganizationId, userId: other.userId, role: 'admin' },
    })

    expect(refused.headers.get('location')).toBe(`${APP_URL}/organizations?error=not_a_member`)

    const disguised = await call('setMemberRole', {
      session: elsewhere,
      body: { organizationId, userId: other.userId, role: 'admin' },
    })

    expect(disguised.status).toBe(404)
    expect(await countRows('organization_member', 'user_id', other.userId)).toBe(1)
  })
})

describe.runIf(databaseReachable)('ce que l’écran voit', () => {
  it('liste les membres avec leur adresse, et dit lequel ne peut pas être retiré', async () => {
    const { founder, member } = await anAccount().then(async (first) => {
      const organizationId = await anOrganization(first)
      const email = `s15-vue-${randomUUID()}@example.test`
      const second = await anAccount(email)

      await call('invite', { session: first, body: { organizationId, email } })
      await call('acceptInvitation', {
        session: second,
        body: { token: tokenOf(lastInvitationLink()) },
      })

      return { founder: first, member: second }
    })

    const members = await membersOf(founder)

    expect(members).toHaveLength(2)
    // Le dernier propriétaire n'a pas d'action de retrait : l'écran ne masque
    // pas un bouton, il n'en a pas. Le serveur refuse malgré tout.
    expect(members.find((entry) => entry.userId === founder.userId)?.removable).toBe(false)
    expect(members.find((entry) => entry.userId === member.userId)?.removable).toBe(true)
  })

  /**
   * **Les affordances sont dérivées du rôle de l'appelant, par le serveur**
   * (revue de s17, F1).
   *
   * Le cas de rendu qui porte ce nom reçoit `permissions` et `assignableRoles`
   * en **paramètres** : il éprouve le `.tsx`, jamais le calcul. Mesuré en revue :
   * remplacer `assignableRolesFor(access, identity)` par les trois rôles en dur
   * laissait 1086 cas et 58 parcours au vert, et un simple `member` se serait vu
   * offrir « Administrateur » et « Transférer la propriété » sur chaque ligne —
   * chacun refusé par un 403 nu, donc un écran qui ment.
   *
   * Ce cas confronte donc la vue **servie** aux fonctions du `domain`, pour les
   * trois rôles. Il ne rejoue pas la matrice — elle est éprouvée à la règle : il
   * prouve que la vue la **consulte avec le rôle de l'appelant**, et pas avec un
   * autre.
   */
  it('dérive les droits et les rôles offerts du rôle de l’appelant, pour chacun des trois', async () => {
    const { owner, other: member, organizationId } = await anOrganizationWithRole('member')
    const admin = await anAccount()

    await connection.db.insert(organizationMember).values({
      id: generateId('mbr'),
      organizationId,
      userId: admin.userId,
      role: 'admin',
    })

    /** La vue telle que ce compte la reçoit, son organisation courante posée. */
    const seenBy = async (session: ModuleSession): Promise<OrganizationsView> => {
      await call('switch', { session, body: { organizationId } })

      return await service.useCases.viewOrganizations(session.userId)
    }

    const viewers = [
      { session: owner, role: 'owner' as const },
      { session: admin, role: 'admin' as const },
      { session: member, role: 'member' as const },
    ]

    for (const viewer of viewers) {
      const view = await seenBy(viewer.session)
      const actor = { userId: viewer.session.userId, role: viewer.role }

      expect(view.permissions, viewer.role).toEqual(permissionsOf(viewer.role))
      expect(view.members, viewer.role).toHaveLength(3)

      for (const row of view.members) {
        expect(row.assignableRoles, `${viewer.role} → ${row.role}`).toEqual(
          assignableRolesFor(actor, { userId: row.userId, role: row.role }),
        )
      }
    }

    // Les ancres, pour que ce cas ne se compare pas seulement à lui-même : un
    // `member` ne se voit offrir **aucun** rôle nulle part et ne peut rien, un
    // `owner` s'en voit offrir sur les lignes des autres et aucun sur la sienne.
    const asMember = await seenBy(member)

    expect(asMember.members.flatMap((row) => row.assignableRoles)).toEqual([])
    expect(asMember.permissions['member.invite']).toBe(false)
    expect(asMember.permissions['member.set_role']).toBe(false)

    const asOwner = await seenBy(owner)
    const rowOf = (userId: string) => asOwner.members.find((row) => row.userId === userId)

    expect(rowOf(member.userId)?.assignableRoles).toEqual(['admin', 'owner'])
    expect(rowOf(admin.userId)?.assignableRoles).toEqual(['member', 'owner'])
    expect(rowOf(owner.userId)?.assignableRoles).toEqual([])
    expect(asOwner.permissions['member.set_role']).toBe(true)
  })

  it('ne montre ni membres ni invitations quand aucune organisation n’est courante', async () => {
    const account = await anAccount()

    expect(await service.useCases.viewOrganizations(account.userId)).toEqual(
      EMPTY_ORGANIZATIONS_VIEW,
    )
  })
})

describe.runIf(databaseReachable)('la purge et l’export du module', () => {
  it('efface les appartenances d’un compte, et se rejoue sans rien de plus', async () => {
    const account = await anAccount()

    await call('create', { session: account, body: { name: 'Studio', slug: aSlug() } })

    expect(await countRows('organization_member', 'user_id', account.userId)).toBe(1)

    await organizationsModule.purge({ kind: 'user', userId: account.userId })
    await organizationsModule.purge({ kind: 'user', userId: account.userId })

    expect(await countRows('organization_member', 'user_id', account.userId)).toBe(0)
    expect(await countRows('organization_active_selection', 'user_id', account.userId)).toBe(0)
  })

  it('efface l’adresse invitée avec le compte qui la porte, et se rejoue', async () => {
    // **`organization_invitation.email` est une donnée personnelle** (constat
    // F6) : c'est l'adresse d'une personne qui n'est pas encore membre, et qui
    // n'a pas nécessairement de compte. Mesuré avant la correction : après
    // `purge({kind:'user'})`, la ligne et son adresse étaient toujours là.
    const founder = await anAccount()
    const organizationId = await anOrganization(founder)
    const email = `s15-purge-${randomUUID()}@example.test`
    const guest = await anAccount(email)

    await call('invite', { session: founder, body: { organizationId, email } })

    expect(await countRows('organization_invitation', 'email', email)).toBe(1)

    await organizationsModule.purge({ kind: 'user', userId: guest.userId })
    await organizationsModule.purge({ kind: 'user', userId: guest.userId })

    expect(await countRows('organization_invitation', 'email', email)).toBe(0)
    // La catégorie est déclarée **et** dotée d'une politique : sans la
    // déclaration, rien n'obligeait à écrire cette purge.
    expect(organizationsModule.dataCategories).toContain('invitation')
  })

  it('rend à l’export les invitations adressées au compte', async () => {
    const founder = await anAccount()
    const organizationId = await anOrganization(founder)
    const email = `s15-export-${randomUUID()}@example.test`
    const guest = await anAccount(email)

    await call('invite', { session: founder, body: { organizationId, email } })

    const payload = await organizationsModule.export({ kind: 'user', userId: guest.userId })

    expect(payload).toMatchObject({
      invitations: [{ email, status: 'pending' }],
    })
  })

  it('efface une organisation et ses appartenances, et se rejoue', async () => {
    const account = await anAccount()

    await call('create', { session: account, body: { name: 'Studio', slug: aSlug() } })

    const [organization] = await service.useCases
      .viewOrganizations(account.userId)
      .then((view) => view.memberships)
    const organizationId = organization?.id ?? ''

    await organizationsModule.purge({ kind: 'organization', organizationId })
    await organizationsModule.purge({ kind: 'organization', organizationId })

    expect(await countRows('organization', 'id', organizationId)).toBe(0)
    expect(await countRows('organization_member', 'organization_id', organizationId)).toBe(0)
  })

  it('rend les appartenances d’un compte à l’export, sans rien d’autre', async () => {
    const account = await anAccount()
    const slug = aSlug()

    await call('create', { session: account, body: { name: 'Studio', slug } })

    const payload = await organizationsModule.export({ kind: 'user', userId: account.userId })

    expect(payload).toMatchObject({
      memberships: [{ slug, role: 'owner' }],
    })
  })
})

describe('le propriétaire d’une donnée, dans les deux configurations', () => {
  const session: ModuleSession = { userId: 'usr_1', roles: [] }

  it('est le compte quand aucune organisation n’est active — l’état mono-utilisateur', () => {
    expect(resolveDataOwner({ session, activeOrganizationId: null })).toEqual({
      kind: 'user',
      userId: 'usr_1',
    })
  })

  it('est l’organisation active dès qu’il y en a une, par le **même** appel', () => {
    expect(resolveDataOwner({ session, activeOrganizationId: 'org_1' })).toEqual({
      kind: 'organization',
      organizationId: 'org_1',
    })
  })
})

describe.runIf(databaseReachable)('la résolution du propriétaire, telle qu’elle est câblée', () => {
  it('rend le compte tant qu’aucune organisation n’est active, l’organisation ensuite', async () => {
    // Le point de composition **réel** de l'application, pas la fonction pure :
    // c'est le câblage qui est éprouvé ici. Un comportement se prouve, et son
    // câblage aussi — le mode d'échec n°11 du dépôt.
    const { dataOwnerOf, organizations } = await import('../apps/web/lib/organizations')
    const session = await anAccount()

    expect(await dataOwnerOf(session)).toEqual({ kind: 'user', userId: session.userId })

    // Aucun appelant ne change : seule l'organisation active apparaît.
    if (organizations.available) {
      const slug = aSlug()

      await call('create', { session, body: { name: 'Studio Martin', slug } })

      const activeId = await service.useCases.activeOrganizationId(session.userId)

      expect(await dataOwnerOf(session)).toEqual({
        kind: 'organization',
        organizationId: activeId,
      })
    }
  })

  it('n’a pas de propriétaire pour un visiteur anonyme, et n’interroge rien', async () => {
    const { dataOwnerOf } = await import('../apps/web/lib/organizations')

    expect(await dataOwnerOf(null)).toBeNull()
  })
})

describe('les identifiants réservés suivent les écrans réellement servis', () => {
  const SCREEN_ROOT = join(REPO_ROOT, 'apps/web/app')

  /**
   * Les segments de premier niveau que l'application sert, **lus sur le
   * disque**.
   *
   * Dérivés, jamais recopiés : une liste écrite à la main deviendrait fausse à
   * l'écran suivant, et c'est exactement le mode d'échec que ce dépôt a mesuré
   * trois fois. Les segments dynamiques (`[document]`) sont exclus : ils ne
   * sont pas un chemin réservable.
   */
  const servedSegments = (): readonly string[] =>
    readdirSync(SCREEN_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('['))
      .map((entry) => entry.name)
      .sort()

  it('trouve des écrans, faute de quoi ce cas ne vérifierait rien', () => {
    expect(servedSegments().length).toBeGreaterThan(3)
  })

  it.each(servedSegments())('réserve « %s », que l’application sert déjà', async (segment) => {
    const { reservedSlugs } = await import('../apps/web/lib/organizations')

    expect([...reservedSlugs]).toContain(segment)
  })

  it('réserve aussi chaque langue servie, que le préfixe d’URL occupe', async () => {
    const { reservedSlugs } = await import('../apps/web/lib/organizations')
    const { localeRouting } = await import('../apps/web/lib/locale-routing')

    for (const locale of localeRouting.locales) {
      expect([...reservedSlugs]).toContain(locale)
    }
  })

  it('réserve le premier segment de chaque entrée de navigation d’un module activé', async () => {
    const { reservedSlugs } = await import('../apps/web/lib/organizations')
    const { moduleRegistry } = await import('../apps/web/lib/module-registry')

    for (const entry of moduleRegistry.navigation) {
      const segment = entry.href.split('/').filter(Boolean)[0]

      if (segment !== undefined) {
        expect([...reservedSlugs]).toContain(segment)
      }
    }
  })
})

describe('un module `organizations` non activé', () => {
  it('déclare pourtant bien des routes, des tables et une entrée de navigation', () => {
    // Sans cette garde, tout ce qui suit serait vide de sens.
    expect(organizationsModule.routes.length).toBeGreaterThan(0)
    expect(organizationsModule.navigation.length).toBeGreaterThan(0)
    expect(Object.keys(organizationsModule.schema).length).toBe(4)
  })

  it('n’expose aucune route : chacune de ses URL répond 404', async () => {
    for (const route of organizationsModule.routes) {
      const response = await dispatchModuleRequest(
        withoutOrganizations,
        new Request(`${APP_URL}${MODULE_ROUTE_PREFIX}${route.path}`, { method: route.method }),
        { resolveSession: () => Promise.resolve({ userId: 'usr_1', roles: [] }) },
      )

      expect(response.status).toBe(404)
    }
  })

  it('n’apparaît dans aucune entrée de navigation, ni dans aucun catalogue', () => {
    expect(withoutOrganizations.navigation.map((entry) => entry.moduleId)).not.toContain(
      organizationsModule.id,
    )

    const keys = Object.values(withoutOrganizations.messages).flatMap((catalog) =>
      Object.keys(catalog),
    )

    expect(keys.filter((key) => key.startsWith(`${organizationsModule.id}.`))).toEqual([])
  })

  it('ne laisse aucune de ses tables sur une base vierge', async () => {
    // Les tables du module, telles qu'il les déclare — dérivées, pas recopiées.
    const declared = Object.values(organizationsModule.schema).map(
      (table) => getTableConfig(table as Parameters<typeof getTableConfig>[0]).name,
    )
    const plan = planModuleMigrations({
      modules: withoutOrganizations.modules,
      repoRoot: REPO_ROOT,
    })

    expect(plan.map((entry) => entry.moduleId)).not.toContain(organizationsModule.id)
    expect(declared.sort()).toEqual([
      'organization',
      'organization_active_selection',
      'organization_invitation',
      'organization_member',
    ])
  })

  it('laisse `resolveDataOwner` rattacher la donnée au compte, par le même appel', async () => {
    // C'est le critère « toute donnée est rattachée directement à
    // l'utilisateur » : rien ne change chez l'appelant, seule l'organisation
    // active vaut `null`.
    expect(EMPTY_ORGANIZATIONS_VIEW).toEqual({
      current: null,
      memberships: [],
      members: [],
      invitations: [],
      permissions: permissionsOf(null),
    })
    expect(
      resolveDataOwner({ session: { userId: 'usr_1', roles: [] }, activeOrganizationId: null }),
    ).toEqual({ kind: 'user', userId: 'usr_1' })
  })

  it('accorde toute action au compte, faute d’organisation à consulter', () => {
    // **Critère 7**, câblé : la vue servie module coupé porte les permissions de
    // « aucune organisation », c'est-à-dire toutes. Le même appel décide dans
    // les deux configurations, sans variante — c'est `allows(null, …)` qui le
    // tient, et son cas vit à la règle.
    for (const action of ORGANIZATION_ACTIONS) {
      expect(EMPTY_ORGANIZATIONS_VIEW.permissions[action], action).toBe(true)
    }
  })
})

/**
 * **Le sélecteur ne présente jamais un vide comme une organisation courante**
 * (constat F7 de la revue de s15).
 *
 * L'écran passait `empty.title` — « Aucune organisation » — en libellé
 * **courant** du sélecteur dès que la sélection active ne se retrouvait pas
 * parmi les appartenances. Le déclencheur est nommé par son texte visible :
 * une aide technique annonçait donc « Aucune organisation » comme l'état
 * courant d'un compte qui en a trois. C'est exactement l'état d'un membre
 * retiré (F1) et celui d'un compte invité (s16).
 *
 * Le rendu est statique : la présentation du module ne connaît ni `next-intl`,
 * ni cookie, ni base — `intl.t` rend ici la clé elle-même, ce qui fait de
 * l'assertion une lecture directe.
 */
describe('le sélecteur d’organisation, quand rien n’est sélectionné', () => {
  /**
   * Les URL des routes, **distinctes et improbables**.
   *
   * Les valeurs d'origine (`/c`, `/u`, `/m`…) étaient des sous-chaînes : `/u`
   * se trouve dans n'importe quel `</ul>`, et un cas « cette action n'est pas
   * offerte » passait donc au vert par accident. C'est le mode d'échec
   * « couverture par sous-chaîne » de la méthode, mesuré ici.
   */
  const ACTIONS = {
    create: '/route-create',
    switch: '/route-switch',
    update: '/route-update',
    invite: '/route-invite',
    resendInvitation: '/route-resend',
    revokeInvitation: '/route-revoke',
    removeMember: '/route-remove',
    setMemberRole: '/route-set-role',
  }
  const A_MEMBERSHIP = {
    id: 'org_1',
    name: 'Studio Martin',
    slug: 's15-studio',
    role: 'owner' as const,
  }

  const render = async (view: OrganizationsView): Promise<string> => {
    const { OrganizationsScreen } = await import('@repo/module-organizations/presentation')

    return renderToStaticMarkup(
      createElement(OrganizationsScreen, {
        view,
        intl: { t: (key: string) => key },
        actions: ACTIONS,
        viewerId: 'usr_1',
        refusalKey: null,
      }),
    )
  }

  it('invite à en choisir une, au lieu d’annoncer l’état vide comme courant', async () => {
    const html = await render({ ...EMPTY_ORGANIZATIONS_VIEW, memberships: [A_MEMBERSHIP] })

    expect(html).toContain(ORGANIZATIONS_KEYS.switcherNone)
    // Le libellé de l'état vide appartient à l'écran sans appartenance ; il n'a
    // rien à faire dans le déclencheur d'un compte qui en a une.
    expect(html).not.toContain(ORGANIZATIONS_KEYS.emptyTitle)
  })

  it('nomme l’organisation courante dès qu’il y en a une', async () => {
    const html = await render({
      ...EMPTY_ORGANIZATIONS_VIEW,
      current: A_MEMBERSHIP,
      memberships: [A_MEMBERSHIP],
    })

    expect(html).toContain(A_MEMBERSHIP.name)
    expect(html).not.toContain(ORGANIZATIONS_KEYS.switcherNone)
  })

  /**
   * **Le dernier propriétaire n'a pas de bouton de retrait** (critère 7, côté
   * écran).
   *
   * Ce n'est pas la permission — le serveur refuse de toute façon, et
   * `tests/organizations.test.ts` le mesure par le répartiteur —, c'est
   * l'affordance : promettre une action qu'on va refuser est un écran cassé.
   */
  it('n’offre pas de retrait au membre que la règle protège', async () => {
    const withMembers = (removable: boolean): OrganizationsView => ({
      ...EMPTY_ORGANIZATIONS_VIEW,
      current: A_MEMBERSHIP,
      memberships: [A_MEMBERSHIP],
      members: [
        {
          userId: 'usr_1',
          email: 'alice@example.test',
          role: 'owner' as const,
          removable,
          assignableRoles: [],
        },
      ],
    })

    expect(await render(withMembers(false))).not.toContain(ACTIONS.removeMember)
    expect(await render(withMembers(true))).toContain(ACTIONS.removeMember)
  })

  /**
   * **L'écran ne décide de rien** (s17).
   *
   * Il ne compare aucun rôle : il lit `permissions` et `assignableRoles`,
   * calculés par le serveur avec les fonctions qui gardent aussi les routes. Une
   * condition de rôle écrite dans le `.tsx` ferait exister la matrice à deux
   * endroits, et le second serait celui qui ment.
   *
   * Ce qui est mesuré ici est l'**affordance**, pas la permission : le serveur
   * refuse de toute façon, en 403, et les cas de câblage plus haut le prouvent.
   */
  it('ne montre à un simple membre ni l’invitation, ni les paramètres', async () => {
    const asRole = async (role: 'owner' | 'admin' | 'member'): Promise<string> => {
      const membership = { ...A_MEMBERSHIP, role }

      return await render({
        current: membership,
        memberships: [membership],
        members: [
          {
            userId: 'usr_1',
            email: 'alice@example.test',
            role,
            removable: true,
            assignableRoles: [],
          },
        ],
        invitations: [],
        permissions: permissionsOf(role),
      })
    }

    const asMember = await asRole('member')

    expect(asMember).not.toContain(ACTIONS.invite)
    expect(asMember).not.toContain(ACTIONS.update)
    // La carte des membres, elle, reste : savoir avec qui l'on partage ses
    // données n'est pas un privilège.
    expect(asMember).toContain(ORGANIZATIONS_KEYS.membersTitle)

    for (const role of ['owner', 'admin'] as const) {
      const html = await asRole(role)

      expect(html, role).toContain(ACTIONS.invite)
      expect(html, role).toContain(ACTIONS.update)
    }
  })

  it('n’offre un bouton de rôle que sur les lignes qui en reçoivent un', async () => {
    const withAssignable = (assignableRoles: readonly OrganizationRole[]): OrganizationsView => ({
      ...EMPTY_ORGANIZATIONS_VIEW,
      current: A_MEMBERSHIP,
      memberships: [A_MEMBERSHIP],
      members: [
        {
          userId: 'usr_2',
          email: 'paul@example.test',
          role: 'member' as const,
          removable: true,
          assignableRoles,
        },
      ],
      permissions: permissionsOf('owner'),
    })

    expect(await render(withAssignable([]))).not.toContain(ACTIONS.setMemberRole)

    const offered = await render(withAssignable(['admin', 'owner']))

    expect(offered).toContain(ACTIONS.setMemberRole)
    // Le libellé du bouton nomme le rôle **posé**, pas le rôle courant.
    expect(offered).toContain(ORGANIZATIONS_KEYS.membersTransfer)
  })
})

describe('le contrat du module', () => {
  it('déclare `auth` dans ses requis — c’est ce qui rend ses clés étrangères permises', () => {
    // ADR 018 : la clé étrangère de `organization_member` vers `auth_user` n'est
    // permise que parce que `auth` est un requis déclaré. `pnpm db:generate` la
    // refuserait autrement, en nommant les deux modules.
    expect(organizationsModule.requires).toContain('auth')
  })

  it('déclare une politique de rétention pour chacune de ses catégories', () => {
    for (const category of organizationsModule.dataCategories) {
      expect(organizationsModule.retention[category]).toBe('erase')
    }
  })

  it('déclare le niveau de protection de chaque route et de chaque entrée', () => {
    for (const route of organizationsModule.routes) {
      expect(route.protection).toEqual({ level: 'authenticated' })
    }

    for (const entry of organizationsModule.navigation) {
      expect(entry.protection).toEqual({ level: 'authenticated' })
    }
  })
})

describe('les clés composées du module', () => {
  it.each(appLocales)('sont toutes traduites en %s', (locale) => {
    // Les clés à valeur variable — rôle, motif de refus — sont invisibles au
    // balayage statique de `tests/i18n.test.ts`. Sans ce cas, un rôle ajouté
    // sans sa traduction ferait un écran en 500 et rien ne le dirait avant.
    const catalogue = flatMessagesFor(locale, registry)

    for (const key of organizationsMessageKeys()) {
      expect(Object.keys(catalogue)).toContain(key)
    }
  })
})

describe('l’annuaire du dépôt', () => {
  it('contient le module, sans quoi `pnpm ks toggle organizations` ne le trouverait pas', () => {
    expect(availableModules.map((module) => module.id)).toContain(organizationsModule.id)
  })
})

describe('une requête qu’aucune route ne sert', () => {
  it('n’a besoin d’aucune base : le service du module n’est pas construit', async () => {
    // Le répartiteur prépare les services à **chaque** requête. La première
    // version les construisait aussitôt, donc lisait `DATABASE_URL` pour
    // répondre 404 sur un chemin inconnu — `tests/module-off.test.ts` échouait
    // exactement là. La préparation dit désormais *comment* construire, jamais
    // *construis maintenant*.
    //
    // La mesure retire la variable et repart d'un graphe de modules neuf :
    // c'est la seule façon d'observer « rien n'a été construit », puisqu'un
    // service construit à la demande est indiscernable d'un service construit
    // d'avance une fois qu'on le demande.
    const saved = process.env['DATABASE_URL']

    vi.resetModules()
    delete process.env['DATABASE_URL']

    try {
      const { GET } = await import('../apps/web/app/api/modules/[...path]/route')
      const response = await GET(
        new Request(`${APP_URL}${MODULE_ROUTE_PREFIX}/chemin-inconnu`, { method: 'GET' }),
      )

      expect(response.status).toBe(404)
    } finally {
      process.env['DATABASE_URL'] = saved
      vi.resetModules()
    }
  })
})

/** Garde d'inertie : sans base, la moitié de ce fichier ne s'exécute pas. */
describe('la base de données de la suite', () => {
  it('est joignable', () => {
    expect(databaseReachable, 'docker compose up -d, puis DATABASE_URL').toBe(true)
  })
})

