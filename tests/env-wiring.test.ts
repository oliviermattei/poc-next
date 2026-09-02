import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Env, EnvSource } from '@repo/config'
import { findRootEnvPath, loadRootEnv } from '@repo/config/server'

import { resolveOAuthConfig } from '../apps/web/lib/oauth-config'

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

  const loadNextConfig = async () => {
    vi.resetModules()
    const { default: config } = await import('../apps/web/next.config')

    return config
  }

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('refuse de démarrer sur une `DATABASE_URL` malformée, en la nommant', async () => {
    vi.stubEnv('DATABASE_URL', 'mysql://oops@localhost/x')
    stubMailer('capture')
    stubAuth('configure')
    stubStorage('disque')

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

    const config = await loadNextConfig()

    expect(() => config(DEV_SERVER_PHASE)).toThrowError(/STORAGE_S3_BUCKET/)
    expect(() => config(DEV_SERVER_PHASE)).toThrowError(/STORAGE_LOCAL_DIRECTORY/)
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
    stubOAuth()

    const config = await loadNextConfig()

    expect(() => config(DEV_SERVER_PHASE)).not.toThrow()
  })

  it('refuse de démarrer sur une paire de fournisseur incomplète, en nommant la variable absente', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://app:app@localhost:5432/app')
    stubMailer('capture')
    stubAuth('configure')
    stubStorage('disque')
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
    stubOAuth({ githubSecret: 'secret-de-test' })

    const config = await loadNextConfig()

    expect(() => config(DEV_SERVER_PHASE)).toThrowError(/GITHUB_CLIENT_ID/)
  })

  it('refuse le mode local **et** une clé de fournisseur : le choix serait implicite', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://app:app@localhost:5432/app')
    stubMailer('capture')
    stubAuth('configure')
    stubStorage('disque')
    stubOAuth({ githubId: 'id', githubSecret: 'secret', local: '1' })

    const config = await loadNextConfig()

    expect(() => config(DEV_SERVER_PHASE)).toThrowError(/OAUTH_LOCAL_PROVIDER/)
  })

  it('démarre en mode local sans aucune clé de fournisseur', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://app:app@localhost:5432/app')
    stubMailer('capture')
    stubAuth('configure')
    stubStorage('disque')
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
    stubOAuth({ local: '1' })

    const config = await loadNextConfig()

    expect(() => config(DEV_SERVER_PHASE)).toThrowError(/OAUTH_LOCAL_PROVIDER/)
  })

  it('ne réclame ni secret ni URL publique pendant `next build`', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://app:app@localhost:5432/app')
    stubMailer('capture')
    stubAuth('aucun')
    stubStorage('disque')

    const config = await loadNextConfig()

    expect(() => config(BUILD_PHASE)).not.toThrow()
  })

  it('ne réclame pas de mailer pendant `next build` : le build s’exécute sans les variables d’exécution', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://app:app@localhost:5432/app')
    stubMailer('aucun')
    stubAuth('aucun')
    stubStorage('disque')

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
