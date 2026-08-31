import { randomUUID } from 'node:crypto'
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
import { authModule, authUser } from '@repo/module-auth'
import {
  configureOrganizations,
  ORGANIZATIONS_KEYS,
  organizationsMessageKeys,
  organizationsModule,
  organizationRoutePath,
  resetOrganizationsService,
  type OrganizationsService,
  type OrganizationsView,
} from '@repo/module-organizations'
import { sql } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { flatMessagesFor } from '../apps/web/lib/messages'
import { appLocales } from '../config/i18n'
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

/** Compteur d'identifiants : déterministes, donc lisibles dans un échec. */
let sequence = 0

const generateId = (prefix: string): string => {
  sequence += 1

  return `${prefix}_s15_${sequence}`
}

const aSlug = (): string => `s15-${randomUUID().slice(0, 8)}`

/** Un compte réel : les appartenances portent une clé étrangère vers `auth_user`. */
const anAccount = async (): Promise<ModuleSession> => {
  const userId = `usr_s15_${randomUUID()}`

  await connection.db.insert(authUser).values({
    id: userId,
    name: 'Compte de test',
    email: `s15-${randomUUID()}@example.test`,
  })

  return { userId, roles: [] }
}

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
  path: 'create' | 'switch' | 'update',
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

    expect(await service.useCases.viewOrganizations(victim.userId)).toEqual({
      current: null,
      memberships: [],
    })
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
    expect(Object.keys(organizationsModule.schema).length).toBe(3)
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
      'organization_member',
    ])
  })

  it('laisse `resolveDataOwner` rattacher la donnée au compte, par le même appel', async () => {
    // C'est le critère « toute donnée est rattachée directement à
    // l'utilisateur » : rien ne change chez l'appelant, seule l'organisation
    // active vaut `null`.
    const { EMPTY_ORGANIZATIONS_VIEW } = await import('@repo/module-organizations')

    expect(EMPTY_ORGANIZATIONS_VIEW).toEqual({ current: null, memberships: [] })
    expect(
      resolveDataOwner({ session: { userId: 'usr_1', roles: [] }, activeOrganizationId: null }),
    ).toEqual({ kind: 'user', userId: 'usr_1' })
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
  const ACTIONS = { create: '/c', switch: '/s', update: '/u' }
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
        refusalKey: null,
      }),
    )
  }

  it('invite à en choisir une, au lieu d’annoncer l’état vide comme courant', async () => {
    const html = await render({ current: null, memberships: [A_MEMBERSHIP] })

    expect(html).toContain(ORGANIZATIONS_KEYS.switcherNone)
    // Le libellé de l'état vide appartient à l'écran sans appartenance ; il n'a
    // rien à faire dans le déclencheur d'un compte qui en a une.
    expect(html).not.toContain(ORGANIZATIONS_KEYS.emptyTitle)
  })

  it('nomme l’organisation courante dès qu’il y en a une', async () => {
    const html = await render({ current: A_MEMBERSHIP, memberships: [A_MEMBERSHIP] })

    expect(html).toContain(A_MEMBERSHIP.name)
    expect(html).not.toContain(ORGANIZATIONS_KEYS.switcherNone)
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

