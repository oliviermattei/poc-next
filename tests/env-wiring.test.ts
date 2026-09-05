import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Env, EnvSource } from '@repo/config'
import { ENV_KEYS, parseEnv } from '@repo/config'
import { findRootEnvPath, loadRootEnv } from '@repo/config/server'

import { LOCAL_WEBHOOK_SECRET, resolveBillingConfig } from '../apps/web/lib/billing-config'
import { resolveOAuthConfig } from '../apps/web/lib/oauth-config'
import { COLD_GRAPH_TIMEOUT_MS } from './fixtures/intermittents'

/**
 * **Le délai de ce fichier, explicite et mesuré** (s52, cause A).
 *
 * Ce fichier importe `apps/web/next.config` — donc `next`, `@next/mdx`,
 * `next-intl/plugin` et `startup.ts` — après un `vi.resetModules()`, une
 * dizaine de fois. Le défaut de Vitest est 5 000 ms, exactement la valeur des
 * expirations observées : mesuré à saturation du processeur, le premier import
 * du graphe coûte 6 782 à 7 458 ms contre 1 875 ms à vide. Le détail de la
 * mesure et la raison du chiffre sont sur la constante.
 *
 * Posé sur le **fichier** et non sur un cas nommé : le coût tombe sur le
 * premier cas qui touche le graphe, et l'ordre des blocs n'est pas figé.
 */
vi.setConfig({ testTimeout: COLD_GRAPH_TIMEOUT_MS })

const TURBO_CONFIG_PATH = fileURLToPath(new URL('../turbo.json', import.meta.url))

const writeEnvFile = async (content: string): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'boilerplate-env-'))
  const path = join(directory, '.env')
  await writeFile(path, content, 'utf8')

  return path
}

describe('chargement du `.env` racine', () => {
  it('alimente l’environnement à partir du fichier', async () => {
    const path = await writeEnvFile('DATABASE_URL=postgres://user:password@localhost:5432/app\n')
    const target: EnvSource = {}

    loadRootEnv({ path, target })

    expect(target.DATABASE_URL).toBe('postgres://user:password@localhost:5432/app')
  })

  it('n’écrase pas une variable déjà exportée : l’environnement l’emporte sur le fichier', async () => {
    const path = await writeEnvFile('DATABASE_URL=postgres://file:file@localhost:5432/file\n')
    const target: EnvSource = { DATABASE_URL: 'postgres://shell:shell@localhost:5432/shell' }

    loadRootEnv({ path, target })

    expect(target.DATABASE_URL).toBe('postgres://shell:shell@localhost:5432/shell')
  })

  it('reste sans effet quand le fichier n’existe pas : tout peut venir de l’environnement', () => {
    const target: EnvSource = {}

    expect(() => loadRootEnv({ path: join(tmpdir(), 'boilerplate-absent', '.env'), target })).not.toThrow()
    expect(target).toEqual({})
  })

  it('vise le `.env` de la racine du dépôt, celui que `.env.example` demande de copier', () => {
    expect(findRootEnvPath()).toBe(fileURLToPath(new URL('../.env', import.meta.url)))
  })

  it('trouve la même racine depuis n’importe quel dossier du dépôt', () => {
    // `next dev` s'exécute depuis `apps/web`, les scripts de base depuis
    // `packages/db`, les tests depuis la racine : tous doivent lire le même
    // fichier. Le chemin est résolu à l'exécution, jamais par un bundler.
    const fromApp = fileURLToPath(new URL('../apps/web', import.meta.url))

    expect(findRootEnvPath(fromApp)).toBe(fileURLToPath(new URL('../.env', import.meta.url)))
  })

  it('ne désigne aucun fichier hors du dépôt : tout vient alors de l’environnement', () => {
    expect(findRootEnvPath(tmpdir())).toBeUndefined()
  })

  it('résout un dossier de départ relatif avant de remonter', () => {
    // Un chemin relatif n'a pas de racine (`parse('a/b').root === ''`) et
    // `dirname('.') === '.'` : sans résolution préalable, la remontée ne
    // s'arrête jamais hors du dépôt, et rend un chemin relatif à l'intérieur.
    expect(findRootEnvPath('.')).toBe(fileURLToPath(new URL('../.env', import.meta.url)))
    expect(findRootEnvPath('apps/web')).toBe(fileURLToPath(new URL('../.env', import.meta.url)))
  })

  it('termine sur un chemin relatif qui sort du dépôt', () => {
    // L'assertion précédente part de la racine du dépôt, où le marqueur est
    // toujours trouvé : un correctif partiel qui résoudrait le chemin sans
    // recalculer la racine la laisserait verte, boucle infinie comprise
    // (mesuré en revue de s01, finding N11). Celle-ci part d'un chemin relatif
    // qui résout hors de tout workspace : la fonction doit remonter jusqu'à la
    // racine du système de fichiers et s'y arrêter.
    const outsideRepo = relative(process.cwd(), tmpdir())

    expect(findRootEnvPath(outsideRepo)).toBeUndefined()
  })
})

/**
 * Les deux câblages ci-dessous sont invisibles pour les tests qui importent
 * directement un module applicatif : ils décident si `DATABASE_URL` atteint le
 * processus qui sert `/api/health`. Leur régression est silencieuse — 503
 * définitif, sans qu'aucun test métier ne bouge.
 */
describe('transmission de `DATABASE_URL` jusqu’à l’application', () => {
  afterEach(() => {
    vi.doUnmock('@repo/config/server')
    vi.resetModules()
  })

  it('la configuration de `apps/web` charge le `.env` racine — Next ne lit que le dossier de l’app', async () => {
    const loadedPaths: (string | undefined)[] = []

    vi.doMock('@repo/config/server', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@repo/config/server')>()),
      loadRootEnv: (options?: { path?: string }) => {
        loadedPaths.push(options?.path ?? findRootEnvPath())
      },
    }))
    vi.resetModules()

    await import('../apps/web/next.config')

    expect(loadedPaths).toEqual([findRootEnvPath()])
  })

  it('turbo transmet `DATABASE_URL` à toutes les tâches qui joignent la base', async () => {
    const turbo = JSON.parse(await readFile(TURBO_CONFIG_PATH, 'utf8')) as {
      tasks: Record<string, { env?: string[] }>
    }

    for (const task of ['dev', 'build', 'db:migrate', 'db:seed']) {
      expect(turbo.tasks[task]?.env ?? []).toContain('DATABASE_URL')
    }
  })

  it('turbo compte le `.env` racine dans la clé de cache', async () => {
    // Turborepo hache les variables du processus, pas le fichier qui les porte :
    // sans cette déclaration, modifier `.env` puis relancer `build` rend
    // `FULL TURBO`. Dès la première variable `NEXT_PUBLIC_*`, inlinée au build,
    // le cache servirait un artefact construit avec l'ancienne valeur.
    const turbo = JSON.parse(await readFile(TURBO_CONFIG_PATH, 'utf8')) as {
      globalDependencies?: string[]
    }

    expect(turbo.globalDependencies ?? []).toContain('.env')
  })
})

/**
 * Critère 2 de la story : une variable absente ou malformée doit faire échouer
 * le **démarrage**, pas seulement la première requête. Next charge
 * `next.config.ts` avant de servir quoi que ce soit et abandonne quand ce
 * chargement lève — c'est le seul point de démarrage commun à `next dev` et à
 * `next start`, et il reçoit la phase, ce qui laisse `next build` passer.
 */
describe('validation de l’environnement au démarrage du serveur', () => {
  const DEV_SERVER_PHASE = 'phase-development-server'
  const BUILD_PHASE = 'phase-production-build'

  /**
   * Chaque cas déclare l'**intégralité** de ce que la garde lit.
   *
   * Un cas qui n'annonce que `DATABASE_URL` ne passe que sur un poste dont le
   * `.env` complète le reste : la suite d'un clone neuf rougit alors sur un
   * environnement que le test n'a jamais nommé (revue de s06, G1). La valeur
   * vide vaut absence — et c'est la seule forme qui tienne ici, `next.config`
   * rechargeant le `.env` racine à chaque import : une variable **supprimée**
   * y serait repeuplée par le fichier, une variable vide non.
   */
  const stubMailer = (choice: 'capture' | 'aucun'): void => {
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('EMAIL_FROM', '')
    vi.stubEnv('EMAIL_LOCAL_CAPTURE', choice === 'capture' ? '1' : '')
  }

  /**
   * Même raison que `stubMailer` : la garde d'authentification lit deux
   * variables, et un cas qui n'en déclare aucune ne passerait que sur un poste
   * dont le `.env` les complète.
   */
  const stubAuth = (choice: 'configure' | 'aucun'): void => {
    vi.stubEnv('AUTH_SECRET', choice === 'configure' ? 'x'.repeat(40) : '')
    vi.stubEnv('APP_URL', choice === 'configure' ? 'http://localhost:3000' : '')
  }

  /**
   * Même doctrine, pour la garde posée par s18 : le module `storage` activé
   * sans stockage configuré refuse le démarrage. Un cas qui ne déclare rien ne
   * passerait que sur un poste dont le `.env` porte un `STORAGE_*` — et
   * rougirait sur un clone neuf, ce que la revue de s06 avait déjà nommé.
   */
  const stubStorage = (choice: 'disque' | 'aucun'): void => {
    vi.stubEnv('STORAGE_S3_BUCKET', '')
    vi.stubEnv('STORAGE_S3_REGION', '')
    vi.stubEnv('STORAGE_S3_ACCESS_KEY_ID', '')
    vi.stubEnv('STORAGE_S3_SECRET_ACCESS_KEY', '')
    vi.stubEnv('STORAGE_LOCAL_DIRECTORY', choice === 'disque' ? '.storage' : '')
  }

  /**
   * Le paiement lit trois variables, et la garde en refuse deux états. Un cas
   * qui n'en déclare aucune ne passerait que sur un poste dont le `.env` les
   * complète — la même raison que `stubMailer`.
   */
  const stubPayments = (choice: 'local' | 'aucun'): void => {
    vi.stubEnv('STRIPE_SECRET_KEY', '')
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '')
    vi.stubEnv('PAYMENTS_LOCAL_MODE', choice === 'local' ? '1' : '')
  }

  /**
   * Les tâches de fond lisent trois variables, et la garde en refuse deux
   * états — même forme et même raison que `stubPayments` (s33).
   */
  const stubJobs = (choice: 'local' | 'aucun'): void => {
    vi.stubEnv('INNGEST_EVENT_KEY', '')
    vi.stubEnv('INNGEST_SIGNING_KEY', '')
    vi.stubEnv('INNGEST_BASE_URL', '')
    vi.stubEnv('JOBS_LOCAL_RUNNER', choice === 'local' ? '1' : '')
  }

  /**
   * Le module `billing` **activé**, quelle que soit la configuration du dépôt.
   *
   * `config/features.ts` bascule d'une configuration à l'autre (`pnpm ks
   * toggle billing`), et ces cas-ci mesurent la garde, pas l'état du dépôt.
   */
  /**
   * Le module `jobs` **activé**, quelle que soit la configuration du dépôt —
   * même forme et même raison que `withBillingEnabled` : `pnpm ks toggle jobs`
   * bascule d'une configuration à l'autre, et ce cas-ci mesure la garde, pas
   * l'état du dépôt.
   */
  const withJobsEnabled = (): void => {
    vi.doMock('../config/features', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../config/features')>()

      return { ...actual, enabledModules: [...new Set([...actual.enabledModules, 'jobs'])] }
    })
  }

  const withBillingEnabled = (): void => {
    vi.doMock('../config/features', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../config/features')>()

      return { ...actual, enabledModules: [...new Set([...actual.enabledModules, 'billing'])] }
    })
  }

  const loadNextConfig = async () => {
    vi.resetModules()
    const { default: config } = await import('../apps/web/next.config')

    return config
  }

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.doUnmock('../config/features')
    vi.doUnmock('../config/billing')
    vi.doUnmock('../config/gating')
    vi.resetModules()
  })

  it('refuse de démarrer sur une `DATABASE_URL` malformée, en la nommant', async () => {
    vi.stubEnv('DATABASE_URL', 'mysql://oops@localhost/x')
    stubMailer('capture')
    stubAuth('configure')
    stubStorage('disque')
    stubPayments('local')
    stubJobs('local')

    const config = await loadNextConfig()

    expect(() => config(DEV_SERVER_PHASE)).toThrowError(/DATABASE_URL/)
  })

  it('démarre sur une URL bien formée mais injoignable : c’est la sonde qui répondra 503', async () => {
    // Une base éteinte n'est pas une erreur de configuration : le serveur doit
    // démarrer et `/api/health` répondre 503.
    vi.stubEnv('DATABASE_URL', 'postgres://app:app@127.0.0.1:1/app')
    stubMailer('capture')
    stubAuth('configure')
    stubStorage('disque')
    stubPayments('local')
    stubJobs('local')

    const config = await loadNextConfig()

    expect(() => config(DEV_SERVER_PHASE)).not.toThrow()
  })

  it('refuse de démarrer quand aucun mailer n’est configuré, en nommant les deux variables', async () => {
    // C'est cette application qui **monte** le mailer : le choix se vérifie au
    // démarrage, pas au premier email — un expéditeur ou une clé manquants
    // n'échoueraient sinon qu'en production, sur un parcours d'inscription.
    // Le schéma d'environnement, lui, ne l'exige de personne : un conteneur de
    // migration muni du seul `DATABASE_URL` n'a aucun mailer à choisir (G3).
    vi.stubEnv('DATABASE_URL', 'postgres://app:app@localhost:5432/app')
    stubMailer('aucun')
    stubAuth('configure')
    stubStorage('disque')
    stubPayments('local')
    stubJobs('local')

    const config = await loadNextConfig()

    expect(() => config(DEV_SERVER_PHASE)).toThrowError(/RESEND_API_KEY/)
    expect(() => config(DEV_SERVER_PHASE)).toThrowError(/EMAIL_LOCAL_CAPTURE/)
  })

  it('refuse de démarrer quand le module `storage` est activé sans stockage, en nommant les variables', async () => {
    // Même doctrine que le mailer : c'est cette application qui **monte** le
    // stockage. Sans cette garde, un module activé sans seau ni disque
    // n'échouerait qu'au premier téléversement — donc chez un utilisateur, en
    // production, et sur un chemin que personne ne rejoue au démarrage.
    vi.stubEnv('DATABASE_URL', 'postgres://app:app@localhost:5432/app')
    stubMailer('capture')
    stubAuth('configure')
    stubStorage('aucun')
    stubPayments('local')
    stubJobs('local')

    const config = await loadNextConfig()

    expect(() => config(DEV_SERVER_PHASE)).toThrowError(/STORAGE_S3_BUCKET/)
    expect(() => config(DEV_SERVER_PHASE)).toThrowError(/STORAGE_LOCAL_DIRECTORY/)
  })

  /**
   * **La branche `'aucun'` de `stubJobs` était livrée et n'était appelée par
   * personne** (constat F1 de la revue de s33) : `stubMailer`, `stubStorage` et
   * `stubAuth` ont chacun leur cas de refus, celui des tâches manquait. La
   * conséquence était mesurable — retirer `assertJobsConfiguration(env)` de
   * `lib/startup.ts` laissait 2 407 cas verts, donc une application démarrait
   * sans avoir dit ce qu'elle fait de ses tâches.
   */
  it('refuse de démarrer quand le module `jobs` est activé sans exécuteur, en nommant les variables', async () => {
    withJobsEnabled()
    vi.stubEnv('DATABASE_URL', 'postgres://app:app@localhost:5432/app')
    stubMailer('capture')
    stubAuth('configure')
    stubStorage('disque')
    stubPayments('local')
    stubJobs('aucun')

    const config = await loadNextConfig()

    expect(() => config(DEV_SERVER_PHASE)).toThrowError(/INNGEST_EVENT_KEY/)
    expect(() => config(DEV_SERVER_PHASE)).toThrowError(/JOBS_LOCAL_RUNNER/)
  })

  /**
   * **Ce que le premier appel, sans condition de phase, tient tout seul.**
   *
   * `lib/startup.ts` appelle `assertJobsConfiguration()` deux fois : une fois
   * avant la sortie de phase — le **plancher** et la lecture des expressions
   * cron, qui ne lisent aucune variable —, une fois après, avec l'environnement.
   * La revue de s33 a mesuré que neutraliser le **premier** laissait la suite
   * verte : au démarrage, le second rattrape tout.
   *
   * Sa contribution propre est donc exactement celle-ci — une expression cron
   * illisible fait échouer la **construction**, où le second appel ne s'exécute
   * jamais. Sans ce cas, un `pnpm build` vert livrerait une image dont
   * l'ordonnanceur refuse de démarrer.
   */
  it('refuse la construction sur une expression cron illisible, en nommant la tâche', async () => {
    vi.doMock('../config/features', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../config/features')>()
      const broken = {
        id: 'fixture-cron-casse',
        requires: [],
        schema: {},
        migrations: null,
        routes: [],
        navigation: [],
        publicUrls: () => [],
        messages: { fr: {}, en: {} },
        emails: [],
        webhooks: [],
        jobs: [{ id: 'jamais', schedule: 'tous les matins', run: async () => {} }],
        dataCategories: [],
        retention: {},
        purge: async () => {},
        export: async () => ({}),
      }

      return {
        ...actual,
        availableModules: [...actual.availableModules, broken],
        enabledModules: [...actual.enabledModules, 'fixture-cron-casse'],
      }
    })

    const config = await loadNextConfig()

    // La phase de **construction** : l'environnement d'exécution n'y est pas
    // validé, et le second appel n'est jamais atteint.
    expect(() => config(BUILD_PHASE)).toThrowError(/fixture-cron-casse\.jamais/)
  })

  it('refuse de démarrer sans secret de session ni URL publique, en nommant les deux variables', async () => {
    // Même raison que le mailer, et même partage : le schéma d'environnement
    // ne les exige de personne — `pnpm db:migrate` ne signe aucun cookie —
    // mais cette application, qui monte l'authentification, refuse de démarrer
    // sans avoir dit avec quoi elle signe ses sessions et où pointent les liens
    // qu'elle envoie par email.
    vi.stubEnv('DATABASE_URL', 'postgres://app:app@localhost:5432/app')
    stubMailer('capture')
    stubAuth('aucun')
    stubStorage('disque')
    stubPayments('local')
    stubJobs('local')

    const config = await loadNextConfig()

    expect(() => config(DEV_SERVER_PHASE)).toThrowError(/AUTH_SECRET/)
    expect(() => config(DEV_SERVER_PHASE)).toThrowError(/APP_URL/)
  })

  /**
   * Les fournisseurs OAuth (s12) : quatre variables, deux paires.
   *
   * Chaque cas déclare l'intégralité de ce que la garde lit, pour la même
   * raison que `stubMailer` — un `.env` de poste complèterait sinon ce que le
   * test n'a pas nommé.
   */
  const stubOAuth = (
    values: {
      readonly googleId?: string
      readonly googleSecret?: string
      readonly githubId?: string
      readonly githubSecret?: string
      readonly local?: string
    } = {},
  ): void => {
    vi.stubEnv('GOOGLE_CLIENT_ID', values.googleId ?? '')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', values.googleSecret ?? '')
    vi.stubEnv('GITHUB_CLIENT_ID', values.githubId ?? '')
    vi.stubEnv('GITHUB_CLIENT_SECRET', values.githubSecret ?? '')
    vi.stubEnv('OAUTH_LOCAL_PROVIDER', values.local ?? '')
  }

  it('démarre sans aucun fournisseur : OAuth absent n’est pas une panne', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://app:app@localhost:5432/app')
    stubMailer('capture')
    stubAuth('configure')
    stubStorage('disque')
    stubPayments('local')
    stubJobs('local')
    stubOAuth()

    const config = await loadNextConfig()

    expect(() => config(DEV_SERVER_PHASE)).not.toThrow()
  })

  it('refuse de démarrer sur une paire de fournisseur incomplète, en nommant la variable absente', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://app:app@localhost:5432/app')
    stubMailer('capture')
    stubAuth('configure')
    stubStorage('disque')
    stubPayments('local')
    stubJobs('local')
    // Un identifiant sans secret : la bibliothèque se contenterait d'un
    // avertissement dans le journal, et l'échec n'apparaîtrait qu'au premier
    // clic sur le bouton, en production.
    stubOAuth({ googleId: 'client-de-test' })

    const config = await loadNextConfig()

    expect(() => config(DEV_SERVER_PHASE)).toThrowError(/GOOGLE_CLIENT_SECRET/)
  })

  it('refuse de démarrer sur un secret sans identifiant, en nommant la variable absente', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://app:app@localhost:5432/app')
    stubMailer('capture')
    stubAuth('configure')
    stubStorage('disque')
    stubPayments('local')
    stubJobs('local')
    stubOAuth({ githubSecret: 'secret-de-test' })

    const config = await loadNextConfig()

    expect(() => config(DEV_SERVER_PHASE)).toThrowError(/GITHUB_CLIENT_ID/)
  })

  it('refuse le mode local **et** une clé de fournisseur : le choix serait implicite', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://app:app@localhost:5432/app')
    stubMailer('capture')
    stubAuth('configure')
    stubStorage('disque')
    stubPayments('local')
    stubJobs('local')
    stubOAuth({ githubId: 'id', githubSecret: 'secret', local: '1' })

    const config = await loadNextConfig()

    expect(() => config(DEV_SERVER_PHASE)).toThrowError(/OAUTH_LOCAL_PROVIDER/)
  })

  it('démarre en mode local sans aucune clé de fournisseur', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://app:app@localhost:5432/app')
    stubMailer('capture')
    stubAuth('configure')
    stubStorage('disque')
    stubPayments('local')
    stubJobs('local')
    stubOAuth({ local: '1' })

    const config = await loadNextConfig()

    expect(() => config(DEV_SERVER_PHASE)).not.toThrow()
  })

  it('refuse de démarrer avec le fournisseur local en production, en nommant la variable', async () => {
    // Le témoin de refus au **démarrage** : la règle est éprouvée là où elle
    // vit, plus bas ; ce cas prouve seulement qu'elle est branchée. Sans lui,
    // la garde pourrait être parfaite et n'être appelée par personne.
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('DATABASE_URL', 'postgres://app:app@localhost:5432/app')
    stubMailer('capture')
    stubAuth('configure')
    stubStorage('disque')
    stubPayments('local')
    stubJobs('local')
    stubOAuth({ local: '1' })

    const config = await loadNextConfig()

    expect(() => config(DEV_SERVER_PHASE)).toThrowError(/OAUTH_LOCAL_PROVIDER/)
  })

  /* ----------------------------------------------------------------------- *
   * Le **catalogue d'offres** (s19, constat F2 de la revue).
   *
   * Premier critère de la story : « une offre malformée fait échouer le
   * démarrage ». `parseBillingCatalogue` refusait bien — mais personne ne
   * l'appelait au démarrage. L'application démarrait, servait, et la première
   * requête qui construisait le service transformait le webhook **public** en
   * 500 : Stripe rejoue, abandonne, et l'état des abonnements diverge en
   * silence.
   *
   * Ces cas prouvent le **câblage**, pas la règle : la règle est éprouvée dans
   * `packages/modules/billing/src/domain/billing-rules.test.ts`.
   * ----------------------------------------------------------------------- */
  const malformedCatalogue = (): void => {
    vi.doMock('../config/billing', () => ({
      // Deux offres sur le **même prix** : la forme exacte que `satisfies`
      // laisse passer et que `parseBillingCatalogue` refuse.
      billingOffers: [
        {
          id: 'pro-monthly',
          mode: 'subscription',
          priceId: 'price_pro_monthly',
          amount: 2900,
          currency: 'eur',
          interval: 'month',
          trialDays: 14,
          perSeat: false,
        },
        {
          id: 'pro-yearly',
          mode: 'subscription',
          priceId: 'price_pro_monthly',
          amount: 29_000,
          currency: 'eur',
          interval: 'year',
          trialDays: 14,
          perSeat: false,
        },
      ],
    }))
  }

  it('refuse de démarrer sur une offre malformée, en nommant le prix fautif', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://app:app@localhost:5432/app')
    stubMailer('capture')
    stubAuth('configure')
    stubOAuth()
    stubPayments('local')
    stubJobs('local')
    withBillingEnabled()
    malformedCatalogue()

    const config = await loadNextConfig()

    expect(() => config(DEV_SERVER_PHASE)).toThrowError(/price_pro_monthly/)
    expect(() => config(DEV_SERVER_PHASE)).toThrowError(/config\/billing\.ts/)
  })

  it('refuse aussi pendant `next build` : un catalogue ne lit aucune variable', async () => {
    // La trappe de la phase de build et `SKIP_ENV_VALIDATION` ne concernent que
    // l'**environnement**. Le catalogue est du code : rien ne justifie qu'un
    // artefact se construise sur une configuration que le démarrage refusera.
    withBillingEnabled()
    malformedCatalogue()

    const config = await loadNextConfig()

    expect(() => config(BUILD_PHASE)).toThrowError(/price_pro_monthly/)
  })

  it('démarre sur le catalogue livré, module de facturation activé', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://app:app@localhost:5432/app')
    stubMailer('capture')
    stubAuth('configure')
    stubOAuth()
    stubStorage('disque')
    stubPayments('local')
    stubJobs('local')
    withBillingEnabled()

    const config = await loadNextConfig()

    expect(() => config(DEV_SERVER_PHASE)).not.toThrow()
  })

  /* ----------------------------------------------------------------------- *
   * Les **fonctionnalités réservées** (s21, ADR 043).
   *
   * Même classe de faute que le catalogue d'offres, et donc même endroit : une
   * déclaration fausse doit arrêter le démarrage, pas se découvrir au premier
   * appel. Deux fautes, et elles ne se ressemblent pas :
   *
   * - une fonctionnalité qui **nomme une offre inexistante** serait fermée pour
   *   toujours à qui a pourtant payé ;
   * - une route qui **réserve une fonctionnalité que rien ne déclare** serait
   *   refusée à tout le monde — l'inverse exact de la leçon de s17, et pire,
   *   puisque le refus est silencieux.
   *
   * Ces cas prouvent le **câblage** ; la règle est éprouvée dans
   * `packages/core/src/entitlement.test.ts`.
   * ----------------------------------------------------------------------- */
  it('refuse de démarrer sur une fonctionnalité qui nomme une offre inconnue', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://app:app@localhost:5432/app')
    stubMailer('capture')
    stubAuth('configure')
    stubOAuth()
    stubStorage('disque')
    stubPayments('local')
    stubJobs('local')
    withBillingEnabled()
    vi.doMock('../config/gating', () => ({
      featureGates: [{ id: 'premium-report', offers: ['pro-quarterly'] }],
    }))

    const config = await loadNextConfig()

    expect(() => config(DEV_SERVER_PHASE)).toThrowError(/pro-quarterly/)
    expect(() => config(DEV_SERVER_PHASE)).toThrowError(/config\/gating\.ts/)
  })

  it('refuse de démarrer quand une route réserve une fonctionnalité non déclarée', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://app:app@localhost:5432/app')
    stubMailer('capture')
    stubAuth('configure')
    stubOAuth()
    stubStorage('disque')
    stubPayments('local')
    stubJobs('local')
    withBillingEnabled()
    // Aucune déclaration : la route réservée du module de démonstration ne
    // serait plus ouverte par personne.
    vi.doMock('../config/gating', () => ({ featureGates: [] }))

    const config = await loadNextConfig()

    expect(() => config(DEV_SERVER_PHASE)).toThrowError(/premium-report/)
  })

  it('démarre sur les fonctionnalités réservées livrées', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://app:app@localhost:5432/app')
    stubMailer('capture')
    stubAuth('configure')
    stubOAuth()
    stubStorage('disque')
    stubPayments('local')
    stubJobs('local')
    withBillingEnabled()

    const config = await loadNextConfig()

    expect(() => config(DEV_SERVER_PHASE)).not.toThrow()
  })

  it('ne réclame ni secret ni URL publique pendant `next build`', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://app:app@localhost:5432/app')
    stubMailer('capture')
    stubAuth('aucun')
    stubStorage('disque')
    stubPayments('local')
    stubJobs('local')

    const config = await loadNextConfig()

    expect(() => config(BUILD_PHASE)).not.toThrow()
  })

  it('ne réclame pas de mailer pendant `next build` : le build s’exécute sans les variables d’exécution', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://app:app@localhost:5432/app')
    stubMailer('aucun')
    stubAuth('aucun')
    stubStorage('disque')
    stubPayments('local')
    stubJobs('local')

    const config = await loadNextConfig()

    expect(() => config(BUILD_PHASE)).not.toThrow()
  })

  it('ne réclame pas de mailer sous `SKIP_ENV_VALIDATION` : la trappe reste ouverte', async () => {
    // La garde du mailer se greffe sur ce que `assertStartupEnv` rend, et cette
    // fonction ne rend rien quand elle n'a rien validé. Sans cela, la garde
    // déciderait sur des valeurs non vérifiées, et le contournement documenté
    // pour diagnostiquer un environnement cassé (`SKIP_ENV_VALIDATION=1 next
    // info`) échouerait précisément quand on en a besoin.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      vi.stubEnv('DATABASE_URL', 'postgres://app:app@localhost:5432/app')
      stubMailer('aucun')
      stubAuth('aucun')
      stubStorage('disque')
      stubPayments('local')
      stubJobs('local')
      vi.stubEnv('SKIP_ENV_VALIDATION', '1')

      const config = await loadNextConfig()

      expect(() => config(DEV_SERVER_PHASE)).not.toThrow()
    } finally {
      warn.mockRestore()
    }
  })

  it('ne valide pas pendant `next build` : le build s’exécute sans les variables d’exécution', async () => {
    vi.stubEnv('DATABASE_URL', 'mysql://oops@localhost/x')

    const config = await loadNextConfig()

    expect(() => config(BUILD_PHASE)).not.toThrow()
  })

  /* ----------------------------------------------------------------------- *
   * **Ce dont le harnais a besoin se déclare dans sa configuration**, jamais
   * dans le `.env` d'un poste.
   *
   * Chaque story qui ajoute une garde de démarrage ajoute une variable que la
   * CI doit poser. Trois l'ont déjà fait (mailer, authentification, OAuth) ;
   * s19 en a ajouté une quatrième — le fournisseur de paiement — sans la
   * déclarer, et `next dev` mourait après `✓ Ready` dans les **deux** branches
   * de la matrice : `pnpm test:e2e` échouait au démarrage du serveur, alors que
   * l'arbre du poste restait vert grâce à son `.env` (constat C1 de la seconde
   * revue).
   *
   * Les cas ci-dessous démarrent la configuration de Next avec l'environnement
   * que le dépôt **contrôle**, et rien d'autre : toute variable du schéma
   * absente de ces deux fichiers est posée vide, donc lue comme absente, et le
   * `.env` du poste ne peut plus la compléter.
   * ----------------------------------------------------------------------- */
  const CI_WORKFLOW_PATH = fileURLToPath(new URL('../.github/workflows/ci.yml', import.meta.url))

  /**
   * Les variables du job `quality`, lues dans le workflow.
   *
   * Balayage volontairement étroit, et il est décrit plutôt que promis : il
   * cherche le job **nommé**, puis le premier bloc `env:` posé au niveau d'un
   * job (indentation de quatre espaces) qui le suit, ses entrées nues ou entre
   * guillemets, et ignore les commentaires. Il ne lit ni un `env:` d'étape, ni
   * celui d'un autre job.
   *
   * L'ancrage sur le nom du job n'est pas décoratif (constat F6 de la revue de
   * s25) : le workflow porte désormais **deux** blocs `env:` de job — `quality`
   * et `parcours-dore` —, et une lecture qui prenait « le premier » aurait
   * changé de sujet en silence le jour où les jobs seraient réordonnés.
   */
  const readCiJobEnv = async (job = 'quality'): Promise<Record<string, string>> => {
    const lines = (await readFile(CI_WORKFLOW_PATH, 'utf8')).split('\n')
    const declared = lines.indexOf(`  ${job}:`)

    if (declared === -1) {
      throw new Error(`Aucun job \`${job}\` dans \`.github/workflows/ci.yml\`.`)
    }

    const offset = lines.slice(declared).indexOf('    env:')

    if (offset === -1) {
      throw new Error(`Aucun bloc \`env:\` dans le job \`${job}\` de \`.github/workflows/ci.yml\`.`)
    }

    const start = declared + offset

    const collected: Record<string, string> = {}

    for (const line of lines.slice(start + 1)) {
      if (line.trim() === '' || line.startsWith('      #')) {
        continue
      }

      const entry = /^ {6}([A-Z0-9_]+):\s*(.*)$/.exec(line)

      if (entry === null) {
        break
      }

      collected[entry[1] ?? ''] = (entry[2] ?? '').trim().replace(/^['"]|['"]$/g, '')
    }

    return collected
  }

  /** Les variables que Playwright pose sur le serveur qu'il démarre lui-même. */
  const readPlaywrightServerEnv = async (): Promise<Record<string, string>> => {
    const { default: playwright } = await import('../playwright.config')
    const server = playwright.webServer

    if (server === undefined || Array.isArray(server)) {
      throw new Error('`playwright.config.ts` ne démarre plus un serveur unique.')
    }

    return Object.fromEntries(
      Object.entries(server.env ?? {}).map(([key, value]) => [key, String(value)]),
    )
  }

  /**
   * Pose exactement cet environnement, et **vide tout le reste du schéma**.
   *
   * La valeur vide vaut absence, et c'est la seule forme qui tienne :
   * `next.config` recharge le `.env` racine à chaque import, et une variable
   * supprimée y serait repeuplée par le fichier du poste — c'est-à-dire par ce
   * que ces cas existent justement pour ne pas mesurer.
   */
  const onlyThisEnv = (values: Record<string, string>): void => {
    for (const key of ENV_KEYS) {
      vi.stubEnv(key, values[key] ?? '')
    }
  }

  it('démarre le serveur que Playwright lance avec le seul environnement du harnais', async () => {
    const harness = { ...(await readCiJobEnv()), ...(await readPlaywrightServerEnv()) }

    onlyThisEnv(harness)
    withBillingEnabled()

    const config = await loadNextConfig()

    expect(() => config(DEV_SERVER_PHASE)).not.toThrow()
  })

  it('ne laisse le job de CI joindre aucun fournisseur de paiement réel', async () => {
    // Le régime de la CI est celui des doublures (`AGENTS.md`, « Third-party
    // integrations ») : le job ne porte aucune clé, et le mode de paiement doit
    // donc y être **choisi**, jamais laissé au hasard d'un environnement.
    const ci = await readCiJobEnv()

    expect(resolveBillingConfig(parseEnv(ci))).toEqual({
      kind: 'local',
      webhookSecret: LOCAL_WEBHOOK_SECRET,
    })
  })

  it('ne laisse le serveur de Playwright joindre aucun fournisseur de paiement réel', async () => {
    // Le parcours de souscription **est** celui du simulateur : il termine le
    // checkout sur une route servie par l'application. Le mode se déclare donc
    // dans le fichier qui décrit ce serveur, et il l'emporte sur le `.env` du
    // poste — un poste muni d'une vraie clé verra le démarrage refuser les deux
    // ensemble, en le disant, plutôt que d'encaisser pendant un test.
    const server = await readPlaywrightServerEnv()

    expect(
      resolveBillingConfig(parseEnv({ DATABASE_URL: 'postgres://app@localhost:5432/app', ...server })),
    ).toEqual({ kind: 'local', webhookSecret: LOCAL_WEBHOOK_SECRET })
  })
})

describe('le préambule qui compile l’application avant les parcours', () => {
  /*
   * Le défaut mesuré : `next dev` compile à la demande, et la première requête
   * d'une route paie la facture. Sur deux cœurs, l'inscription passe de 350 ms
   * à 7 630 ms — vingt fois le geste, et bien au-delà des 5 000 ms du délai de
   * `expect`. La suite était verte sur un poste à huit cœurs et rouge sur le
   * runner, sur un ensemble de parcours qui changeait d'une exécution à
   * l'autre : celui qui se trouvait toucher la route en premier.
   *
   * Ce que ces cas gardent est la **dérivation** des points d'entrée. Une
   * dérivation vide, ou qui laisserait un segment dynamique tel quel, rendrait
   * le préambule silencieusement inutile — la route attrape-tout des modules
   * n'est atteinte par aucune URL contenant `[...path]`, et c'est précisément
   * elle que l'inscription emprunte.
   */

  it('demande une URL que le routeur peut atteindre, pour chaque point d’entrée', async () => {
    const { warmUpTargets } = await import('../e2e/support/warm-up')
    const targets = await warmUpTargets()

    expect(targets.length).toBeGreaterThan(0)
    expect(targets.filter((target) => /[[\]()@]/.test(target))).toEqual([])
  })

  it('couvre la route attrape-tout des modules, celle que l’inscription emprunte', async () => {
    const { warmUpTargets } = await import('../e2e/support/warm-up')

    expect(
      (await warmUpTargets()).some((target) => target.startsWith('/api/modules/')),
    ).toBe(true)
  })

  it('refuse un segment qu’il ne sait pas traduire, plutôt que de l’ignorer', async () => {
    const { urlSegment } = await import('../e2e/support/warm-up')

    expect(() => urlSegment('(marketing)')).toThrow(/préambule/)
    expect(() => urlSegment('@panneau')).toThrow(/préambule/)
  })
})

/* ------------------------------------------------------------------------- *
 * La règle des fournisseurs, éprouvée **là où elle vit** (s12).
 *
 * Les cas de démarrage ci-dessus passent par le schéma d'environnement, qui
 * refuse déjà une paire incomplète : ils prouvent que le démarrage échoue,
 * pas que cette règle-ci décide. Or le schéma ne valide rien sous
 * `SKIP_ENV_VALIDATION` ni en phase de build, et c'est exactement le chemin où
 * `.env.example` livre des variables **vides** que `getEnv` rend telles quelles
 * (revue de s06, G2). Mesuré : neutraliser la règle ci-dessous laisse les cas
 * de démarrage verts.
 * ------------------------------------------------------------------------- */
describe('les fournisseurs OAuth configurés', () => {
  /** Un environnement valide, réduit à ce que cette règle lit. */
  const envWith = (values: Partial<Env>): Env =>
    ({ NODE_ENV: 'development', DATABASE_URL: 'postgres://app@localhost:5432/app', ...values }) as Env

  it('refuse un identifiant sans son secret, en nommant la variable absente', () => {
    expect(() => resolveOAuthConfig(envWith({ GOOGLE_CLIENT_ID: 'id' }))).toThrowError(
      /GOOGLE_CLIENT_SECRET/,
    )
  })

  it('refuse un secret sans son identifiant, en nommant la variable absente', () => {
    expect(() => resolveOAuthConfig(envWith({ GITHUB_CLIENT_SECRET: 'secret' }))).toThrowError(
      /GITHUB_CLIENT_ID/,
    )
  })

  it('lit une variable vide comme absente : `.env.example` la livre ainsi', () => {
    const config = resolveOAuthConfig(
      envWith({ GOOGLE_CLIENT_ID: '  ', GOOGLE_CLIENT_SECRET: '', OAUTH_LOCAL_PROVIDER: '1' }),
    )

    expect(config).toEqual({ providers: [], localProvider: true })
  })

  it('refuse le mode local en présence d’une clé : le repli silencieux est le défaut à éviter', () => {
    expect(() =>
      resolveOAuthConfig(
        envWith({
          GITHUB_CLIENT_ID: 'id',
          GITHUB_CLIENT_SECRET: 'secret',
          OAUTH_LOCAL_PROVIDER: '1',
        }),
      ),
    ).toThrowError(/OAUTH_LOCAL_PROVIDER/)
  })

  /**
   * **Le drapeau seul, en production, est un contournement d'authentification.**
   *
   * Le fournisseur de développement ouvre **toujours** une session sur la même
   * adresse, sans mot de passe et sans réseau : posé sur un déploiement de
   * production, il donne un bouton « Continuer avec Fournisseur local » à tout
   * visiteur anonyme. La forme de l'opt-in était conforme au socle ; il
   * manquait la ligne qui refuse.
   *
   * `NODE_ENV` ne l'**active** jamais — la règle du socle est intacte : le
   * drapeau reste l'unique opt-in, `NODE_ENV` ne fait que le **restreindre**.
   */
  it('refuse le fournisseur local en production : un opt-in n’est pas une porte', () => {
    expect(() =>
      resolveOAuthConfig({
        ...envWith({ OAUTH_LOCAL_PROVIDER: '1' }),
        NODE_ENV: 'production',
      } as Env),
    ).toThrowError(/OAUTH_LOCAL_PROVIDER/)
  })

  it('laisse le fournisseur local monter en développement et en test', () => {
    // Trop large, la règle interdirait le mode local partout : elle prouverait
    // qu'elle est fausse, pas qu'elle marche.
    for (const nodeEnv of ['development', 'test'] as const) {
      expect(
        resolveOAuthConfig({
          ...envWith({ OAUTH_LOCAL_PROVIDER: '1' }),
          NODE_ENV: nodeEnv,
        } as Env).localProvider,
      ).toBe(true)
    }
  })

  it('rend les paires complètes, dans l’ordre déclaré', () => {
    const config = resolveOAuthConfig(
      envWith({
        GOOGLE_CLIENT_ID: 'google-id',
        GOOGLE_CLIENT_SECRET: 'google-secret',
        GITHUB_CLIENT_ID: 'github-id',
        GITHUB_CLIENT_SECRET: 'github-secret',
      }),
    )

    expect(config.providers.map((provider) => provider.id)).toEqual(['google', 'github'])
    expect(config.localProvider).toBe(false)
  })
})

/**
 * **Les dépendances de suppression de compte, branchées au point de
 * composition** (s34, observation de la troisième revue).
 *
 * Les trois options de `configureAuth` que s34 ajoute ont des défauts, et deux
 * d'entre eux sont **fail-closed** : sans `purgeScope` la purge échoue en le
 * disant, sans `jobs` l'émission refuse. Le troisième ne peut pas l'être :
 * `soleOwnerships` et `releaseOrganizations` rendent une liste vide, parce que
 * c'est l'état légitime d'un projet dont le module `organizations` est coupé.
 *
 * **Conséquence, et c'est ce que ce cas garde** : perdre la ligne au point de
 * composition ne casse rien de visible. Il n'y a plus de 409 à la demande, plus
 * d'email de refus, et le refus du module des organisations est reclassé en
 * `provider_unavailable` — donc transitoire, donc rejoué jusqu'au plafond.
 * L'organisation garde son propriétaire, mais le produit ment à la personne.
 *
 * **Ce que ce cas mesure, exactement** : que le point de composition **nomme**
 * ces options. Il lit la source, pas le comportement — construire le service
 * ici demanderait une base, un mailer et la bibliothèque entière. C'est un
 * garde-fou contre la ligne perdue, pas une preuve que la fonction branchée est
 * la bonne ; celle-là est dans `tests/account-deletion.test.ts`, qui les
 * branche pour de vrai.
 */
describe('le point de composition de l’authentification', () => {
  const sourceOf = async (path: string): Promise<string> =>
    await readFile(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8')

  /**
   * **Le délégué que cette option nomme réellement.**
   *
   * On coupe la source à l'option, puis on cherche le **premier** appel parmi
   * les délégués candidats. C'est ce qui distingue « la ligne est là » de « la
   * ligne dit la bonne chose » : deux options peuvent partager une signature,
   * et les intervertir compile, passe le typecheck et passe une garde qui ne
   * regarderait que la présence des noms.
   *
   * **La dernière occurrence, pas la première**, et c'est mesuré : dans
   * `lib/organizations.ts`, le même nom apparaît d'abord dans la déclaration de
   * l'interface, puis dans l'état « module coupé » — deux endroits sans appel,
   * qui faisaient lire le délégué de l'option **suivante**. Le câblage réel est
   * le dernier des trois. Conséquence à connaître : si le câblage disparaît, la
   * recherche tombe sur l'état coupé, n'y trouve aucun candidat, et rend `null`
   * — ce qui rougit aussi.
   */
  const delegateNamedBy = (
    source: string,
    option: string,
    candidates: readonly string[],
  ): string | null => {
    const declaration = source.lastIndexOf(`${option}:`)

    if (declaration === -1) {
      return null
    }

    const body = source.slice(declaration)
    const found = candidates
      .map((candidate) => ({ candidate, at: body.indexOf(`.${candidate}(`) }))
      .filter((entry) => entry.at !== -1)
      .sort((left, right) => left.at - right.at)

    return found[0]?.candidate ?? null
  }

  it('passe à `configureAuth` les dépendances que le module ne peut pas se procurer', async () => {
    const source = await sourceOf('apps/web/lib/auth.ts')

    // Le plancher : sans cet appel, les assertions suivantes chercheraient des
    // noms dans un fichier qui ne configure plus rien.
    expect(source).toContain('configureAuth({')

    const missing = [
      // s34 — l'effacement de tous les modules activés, fail-closed sans lui.
      'purgeScope:',
      // s34 — le refus du dernier propriétaire, à la demande…
      'soleOwnerships:',
      // …et sa revendication atomique au moment d'effacer.
      'releaseOrganizations:',
      // s33 — le port d'émission, fail-closed sans lui.
      'jobs:',
    ].filter((option) => !source.includes(option))

    expect(missing).toEqual([])
  })

  /**
   * **La paire, pas seulement le nom** (constat m4 de la quatrième revue).
   *
   * `soleOwnerships` et `releaseOrganizations` ont **la même signature** —
   * `(userId: string) => Promise<readonly string[]>` —, si bien que les
   * intervertir compile, lint et passe la garde ci-dessus. Les conséquences ne
   * sont pas symétriques : brancher l'option d'effacement sur la **lecture**
   * rouvre exactement la course que la troisième revue a fait fermer, et
   * brancher le refus de la demande sur la **revendication** retirerait les
   * appartenances d'une personne qui n'a encore rien confirmé.
   *
   * Ce cas lit la source, comme son voisin, et pour la même raison : construire
   * les deux points de composition demanderait une base et la bibliothèque
   * entière. Ce qu'il garde est l'appariement, pas le comportement — celui-ci
   * est mesuré dans `tests/account-deletion.test.ts`, qui branche ses propres
   * dépendances et ne verrait donc jamais une inversion ici.
   */
  it('nomme le bon délégué derrière chaque option, et pas seulement un délégué', async () => {
    const candidates = ['soleOwnerships', 'releaseOrganizations', 'releaseMemberships'] as const

    const expected: readonly {
      readonly file: string
      readonly option: string
      readonly delegate: string
    }[] = [
      // Le point de composition de l'authentification délègue au module des
      // organisations, option par option.
      { file: 'apps/web/lib/auth.ts', option: 'soleOwnerships', delegate: 'soleOwnerships' },
      {
        file: 'apps/web/lib/auth.ts',
        option: 'releaseOrganizations',
        delegate: 'releaseOrganizations',
      },
      // Lequel, à son tour, délègue aux cas d'usage — et c'est là que les deux
      // noms cessent de se ressembler : la revendication s'appelle
      // `releaseMemberships`.
      {
        file: 'apps/web/lib/organizations.ts',
        option: 'soleOwnerships',
        delegate: 'soleOwnerships',
      },
      {
        file: 'apps/web/lib/organizations.ts',
        option: 'releaseOrganizations',
        delegate: 'releaseMemberships',
      },
    ]

    const wrong: string[] = []

    for (const entry of expected) {
      const named = delegateNamedBy(await sourceOf(entry.file), entry.option, candidates)

      if (named !== entry.delegate) {
        wrong.push(`${entry.file} · ${entry.option} → ${named ?? 'aucun'}`)
      }
    }

    expect(wrong).toEqual([])
  })
})
