import { fileURLToPath } from 'node:url'

import { buildRegistry, MODULE_ROUTE_PREFIX, type ModuleScope } from '@repo/core'
import {
  countSeededRows,
  planModuleSeeders,
  planModuleMigrations,
  runModuleMigrations,
  runSeeders,
  type DatabaseConnection,
  type Seeder,
} from '@repo/db'
import { createRecordingMailer } from '@repo/mailer-testing'
import {
  authDemonstrationSeed,
  authModule,
  configureAuth,
  resetAuthService,
  DEMONSTRATION_PASSWORD,
} from '@repo/module-auth'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { availableModules, enabledModules, requiredModules } from '../config/features'
import { appLocales } from '../config/i18n'
import { dispatchAllowingRateLimit } from './fixtures/rate-limit'
import {
  createTemporaryDatabase,
  isDatabaseReachable,
  type TemporaryDatabase,
} from './fixtures/database'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const APP_URL = 'http://localhost:3000'

/**
 * L'adresse du premier compte semé. Elle est **écrite ici**, comme dans le
 * `README.md` : c'est la valeur que quelqu'un tape, et un test qui la dériverait
 * du module resterait vert après un changement qui invaliderait la recette.
 */
const DEMONSTRATION_EMAIL = 'ada@demonstration.invalid'

/**
 * **Ce que ce fichier mesure, et pourquoi il lui faut une base à lui** (s58).
 *
 * Le défaut de départ n'est pas une commande cassée, c'est une commande vide :
 * `pnpm db:seed` imprimait « Aucun seed à exécuter » et sortait **0**, toutes
 * les tables du schéma public à zéro ligne. Rien ne le signalait, et le seul
 * test d'idempotence qui existait éprouvait un seeder qu'il s'injectait
 * lui-même.
 *
 * Ce qui se mesure ici, sur les seeds **réellement livrés** sauf mention :
 *
 * 1. le **plancher** — un seed déclaré qui n'écrit rien sur une base vide fait
 *    échouer la commande, **même quand un autre seed a écrit** : c'est le
 *    plancher par seed, et c'est ce qui manquait au plancher global ;
 * 2. la **garde** — un compte que le seed n'a pas créé suffit à le faire
 *    refuser, il ne refuse pas à moitié (rien n'est écrit), et sans aucun
 *    périmètre reçu **tout** compte lui est étranger ;
 * 3. la **transaction unique** — un refus annule ce qu'un seed précédent a déjà
 *    écrit. C'est ce qui rend la garde indépendante de l'ordre du graphe, et
 *    c'est la seule des mesures d'ici qui emploie un seed **témoin** : voir le
 *    cas lui-même pour la raison ;
 * 4. la **rejouabilité** — deux exécutions, un comptage avant et après, jamais
 *    une lecture du code ;
 * 5. le **seed qui échoue est nommé** — un module se trompe sur la forme de la
 *    connexion qu'il déclare, et l'échec doit dire lequel ;
 * 6. la **recette du `README.md`** — un compte semé ouvre une session par la
 *    route de connexion ordinaire.
 *
 * La plupart portent sur l'état **entier** de la base. La suite tourne en
 * parallèle sur celle du poste, donc la mesure se fait dans une base créée pour
 * l'exécution puis détruite, comme le font déjà `pnpm test:minimal-profile` et
 * le parcours doré.
 */
const registry = buildRegistry({
  available: [...availableModules],
  enabled: [...enabledModules],
  required: [...requiredModules],
  locales: [...appLocales],
})

/** Les seeds du dépôt tel qu'il est configuré, dérivés du registre. */
const seeders = planModuleSeeders(registry.seeds)

const databaseReachable = await isDatabaseReachable()

describe('le plancher : une exécution qui ne crée rien est un échec', () => {
  // Un `db` inutilisable : le refus doit tomber avant toute ouverture de base.
  const unusableDb = {} as never

  it('refuse une exécution sans aucun seed, plutôt que de sortir vert', async () => {
    await expect(runSeeders({ db: unusableDb, seeders: [] })).rejects.toThrowError(
      /aucun module activé/i,
    )
  })
})

/**
 * **Deux seeds de même identifiant qualifié** — le refus que `jobs` applique au
 * démarrage (`assertJobSchedulesAreValid`) et que les seeds n'appliquaient pas.
 *
 * Sans lui, un copier-coller dans un module donne deux entrées que le journal
 * et le plancher par seed nomment de la même façon : « le seed *x* n'a rien
 * laissé » désignerait alors deux fonctions différentes.
 */
describe('la planification des seeds du registre', () => {
  const seed = { id: 'demonstration', run: () => Promise.resolve() }

  it('qualifie chaque identifiant par son module', () => {
    const planned = planModuleSeeders([
      { moduleId: 'alpha', seed },
      { moduleId: 'beta', seed },
    ])

    expect(planned.map((entry) => entry.id)).toEqual(['alpha.demonstration', 'beta.demonstration'])
  })

  it('refuse deux seeds de même identifiant qualifié', () => {
    expect(() =>
      planModuleSeeders([
        { moduleId: 'alpha', seed },
        { moduleId: 'alpha', seed },
      ]),
    ).toThrowError(/alpha\.demonstration/)
  })
})

describe.skipIf(!databaseReachable)('les seeds livrés, sur une base créée pour la mesure', () => {
  let temporary: TemporaryDatabase
  let connection: DatabaseConnection

  beforeAll(async () => {
    temporary = await createTemporaryDatabase('s58_seed')
    connection = temporary.connection

    await runModuleMigrations({
      db: connection.db,
      plan: planModuleMigrations({ modules: registry.modules, repoRoot: REPO_ROOT }),
    })
  }, 120_000)

  afterAll(async () => {
    await temporary.drop()
  })

  /**
   * Chaque cas part d'une base **vide de lignes**, tables comprises : les trois
   * mesures portent sur l'état entier de la base, donc aucune ne peut hériter
   * de ce qu'un cas précédent a laissé. La liste des tables est dérivée du
   * catalogue, jamais écrite — une liste recopiée ici vieillirait au premier
   * module.
   */
  beforeEach(async () => {
    await connection.db.execute(sql`
      do $$
      declare statement text;
      begin
        select 'truncate table ' || string_agg(format('%I.%I', schemaname, tablename), ', ') ||
               ' cascade'
        into statement
        from pg_tables
        where schemaname = 'public';

        if statement is not null then
          execute statement;
        end if;
      end $$;
    `)
  })

  /**
   * **Un seed témoin**, et il n'y en a qu'ici : deux mesures ont besoin d'un
   * seed qui écrit *à côté* d'un autre, et aucun seed livré ne peut jouer ce
   * rôle dans **toutes** les configurations — en configuration coupée
   * (`pnpm test:minimal-profile`, branche « socle » de la CI), le seul seed
   * livré est celui qui porte la garde, et les autres ne s'exécutent pas seuls
   * (leurs lignes référencent les comptes). Un témoin qui écrit une ligne est
   * donc la seule forme qui mesure la même chose dans les deux branches.
   *
   * Il écrit dans la table des comptes parce qu'elle est la seule présente dans
   * **toute** configuration — `auth` est un module du socle. La ligne posée est
   * un compte que le seed de démonstration n'a pas créé : c'est aussi ce que la
   * garde regarde.
   */
  const witnessSeeder = (id: string): Seeder => ({
    id,
    run: async (database) => {
      await database.execute(sql`
        insert into auth_user (id, name, email)
        values (${`temoin-${id}`}, 'Témoin', ${`temoin-${id}@demonstration.invalid`})
        on conflict do nothing
      `)
    },
  })

  describe('le plancher', () => {
    it('échoue quand un seed déclaré n’a rien laissé, même si un autre a écrit', async () => {
      // Exactement le défaut mesuré, et la version que le plancher global
      // laissait passer : un seed a « oublié » d'écrire, mais la base n'est pas
      // vide pour autant — les lignes d'un *autre* seed suffisaient à la faire
      // sortir verte.
      await expect(
        runSeeders({
          db: connection.db,
          seeders: [witnessSeeder('a-ecrit'), { id: 'oubli', run: () => Promise.resolve() }],
        }),
      ).rejects.toThrowError(/oubli/)

      // Le refus tombe dans la transaction : la ligne du témoin n'est pas restée.
      const state = await countSeededRows(connection.db)

      expect(state.rows).toBe(0)
      expect(state.tables).toBeGreaterThan(0)
    })

    it('nomme le seed dont l’exécution échoue', async () => {
      // Le cas que le typage ne tient pas (`ModuleSeedDatabase` est `never`) :
      // un module annonce une forme de connexion que le lanceur ne fournit pas,
      // et l'échec atterrit à l'exécution. Ce qui est tenu, c'est qu'il **dise
      // lequel** — « insert is not a function » sans nom ne désignerait rien
      // dans une configuration qui compte quatre seeds.
      await expect(
        runSeeders({
          db: connection.db,
          seeders: [
            {
              id: 'module-imaginaire.forme-inattendue',
              run: () => Promise.reject(new TypeError('database.insert is not a function')),
            },
          ],
        }),
      ).rejects.toThrowError(/module-imaginaire\.forme-inattendue/)
    })
  })

  /**
   * **La garde se dérive d'un fait de la base, jamais de `NODE_ENV`** — le
   * socle refuse d'en déduire un comportement, et un seed est exactement le
   * genre d'outil qui ne doit pas dépendre d'une variable pour être inoffensif.
   *
   * Le fait retenu : un compte que le seed n'a pas créé lui-même. Un produit en
   * service en a toujours un ; une base de découverte n'en a aucun.
   */
  describe('la garde de non-écrasement', () => {
    it('refuse dès qu’un compte qu’il n’a pas créé existe, et ne laisse rien derrière lui', async () => {
      await connection.db.execute(
        sql`insert into auth_user (id, name, email) values ('compte-en-service', 'Cliente', 'cliente@exemple.test')`,
      )

      await expect(runSeeders({ db: connection.db, seeders })).rejects.toThrowError(
        /n’a pas créé/i,
      )

      // **Le refus n'est pas à moitié** : la ligne posée à la main est la seule
      // que la base porte. Un seed qui aurait écrit avant de refuser laisserait
      // des données de démonstration dans un produit en service.
      const state = await countSeededRows(connection.db)

      expect(state.rows).toBe(1)

      await connection.db.execute(sql`delete from auth_user where id = 'compte-en-service'`)
    })

    /**
     * **Aucun périmètre reçu : tout compte est alors étranger.**
     *
     * La branche existe dans le seed — un `notInArray` sur une liste vide ne
     * dirait pas la même chose — et rien ne l'exerçait : les périmètres livrés
     * portent toujours deux comptes, donc le refus n'était vrai que par
     * lecture. Il se mesure **au seed lui-même**, à l'endroit où la règle vit,
     * et non par le lanceur qui ne sait pas composer d'autres périmètres.
     *
     * Le transtypage est la couture documentée du contrat : `ModuleSeedDatabase`
     * vaut `never`, et c'est `planModuleSeeders` qui restitue le type en
     * production.
     */
    it('refuse quand il ne reçoit aucun périmètre : aucun compte ne lui appartient', async () => {
      await connection.db.execute(
        sql`insert into auth_user (id, name, email) values ('compte-quelconque', 'Cliente', 'cliente@exemple.test')`,
      )

      const runAuthSeed = authDemonstrationSeed.run as unknown as (context: {
        readonly database: unknown
        readonly demonstration: readonly ModuleScope[]
      }) => Promise<void>

      await expect(
        runAuthSeed({ database: connection.db, demonstration: [] }),
      ).rejects.toThrowError(/n’a pas créé/i)

      await connection.db.execute(sql`delete from auth_user where id = 'compte-quelconque'`)
    })

    /**
     * **« Quel que soit l'ordre du graphe »**, la phrase que quatre documents
     * écrivent et que rien ne mesurait.
     *
     * Le cas ci-dessus ne mord que parce que le seed qui porte la garde est en
     * tête du registre : c'est l'accident que la transaction devait supprimer,
     * pas une garantie. Ici, un seed écrit **avant** que la garde refuse. Sans
     * `db.transaction` dans `runSeeders`, sa ligne survit au refus — c'est-à-
     * dire des données de démonstration écrites dans une base en service.
     *
     * Le seed qui écrit est le **témoin** plutôt qu'un seed livré : les seeds
     * livrés qui n'ont aucune clé étrangère vers les comptes ne sont pas les
     * mêmes d'une configuration à l'autre, et dans la configuration coupée il
     * n'y en a aucun. Un cas qui ne mordrait que dans la branche livrée de la
     * CI serait un cas que l'autre branche n'exécute jamais.
     */
    it('annule ce qu’un seed a déjà écrit quand un seed suivant refuse', async () => {
      await expect(
        runSeeders({
          db: connection.db,
          seeders: [witnessSeeder('deja-ecrit'), ...seeders],
        }),
      ).rejects.toThrowError(/n’a pas créé/i)

      const state = await countSeededRows(connection.db)

      expect(state.rows).toBe(0)
    })
  })

  /**
   * **La rejouabilité, mesurée et non promise.**
   *
   * Le commentaire du contrat demande depuis le premier jour des identifiants
   * déterministes et des écritures tolérantes au conflit ; rien ne l'a jamais
   * vérifié — le test d'idempotence qui existait s'injectait le seeder qu'il
   * mesurait. Ici, ce sont les seeds **livrés** qui tournent, deux fois, et
   * c'est le comptage qui répond.
   */
  describe('la rejouabilité des seeds livrés', () => {
    it('deux exécutions successives laissent exactement le même nombre de lignes', async () => {
      const first = await runSeeders({ db: connection.db, seeders })
      const second = await runSeeders({ db: connection.db, seeders })

      // La première a semé une base vide…
      expect(first.rowsBefore).toBe(0)
      expect(first.rowsAfter).toBeGreaterThan(0)
      // …la seconde n'a rien ajouté, et elle a bien trouvé les lignes de la
      // première : sans cette égalité-là, « rien ajouté » serait vrai d'une
      // base qu'on aurait vidée entre-temps.
      expect(second.rowsBefore).toBe(first.rowsAfter)
      expect(second.rowsAfter).toBe(first.rowsAfter)
      expect(second.executed).toEqual(first.executed)
    })
  })

  /**
   * **Ce qui rend la recette de découverte vraie** (s58, tâche 7).
   *
   * Le `README.md` promet qu'on se connecte avec un compte semé, sans
   * inscription ni email à lire sur le disque. La promesse ne vaut que si le
   * compte passe par le **chemin ordinaire** : le répartiteur, la route de la
   * bibliothèque, l'empreinte du mot de passe et l'émetteur du compte lié. Une
   * relecture du seed ne le dirait pas — c'est exactement le genre de détail
   * (`issuer`, format d'empreinte) qu'on croit juste jusqu'à l'essayer.
   */
  describe('un compte de démonstration se connecte', () => {
    it('ouvre une session par la route de connexion, sans inscription ni vérification', async () => {
      await runSeeders({ db: connection.db, seeders })

      const service = configureAuth({
        db: connection.db,
        mailer: createRecordingMailer(),
        secret: 'secret-de-test-uniquement-0123456789abcdef',
        appUrl: APP_URL,
      })

      const authRegistry = buildRegistry({
        available: [authModule],
        enabled: ['auth'],
        locales: [...appLocales],
      })

      const response = await dispatchAllowingRateLimit(
        authRegistry,
        new Request(`${APP_URL}${MODULE_ROUTE_PREFIX}/auth/sign-in/email`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: APP_URL },
          body: JSON.stringify({
            email: DEMONSTRATION_EMAIL,
            password: DEMONSTRATION_PASSWORD,
          }),
        }),
        { resolveSession: (request) => service.resolveSession(request) },
      )

      expect(response.status).toBe(200)
      expect(
        response.headers.getSetCookie().some((cookie) => cookie.includes('session_token=')),
      ).toBe(true)

      resetAuthService()
    })
  })
})
