import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { EnvSource } from '@repo/config'
import { findRootEnvPath, loadRootEnv } from '@repo/config/server'

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

    const config = await loadNextConfig()

    expect(() => config(DEV_SERVER_PHASE)).toThrowError(/DATABASE_URL/)
  })

  it('démarre sur une URL bien formée mais injoignable : c’est la sonde qui répondra 503', async () => {
    // Une base éteinte n'est pas une erreur de configuration : le serveur doit
    // démarrer et `/api/health` répondre 503.
    vi.stubEnv('DATABASE_URL', 'postgres://app:app@127.0.0.1:1/app')
    stubMailer('capture')
    stubAuth('configure')

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

    const config = await loadNextConfig()

    expect(() => config(DEV_SERVER_PHASE)).toThrowError(/RESEND_API_KEY/)
    expect(() => config(DEV_SERVER_PHASE)).toThrowError(/EMAIL_LOCAL_CAPTURE/)
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

    const config = await loadNextConfig()

    expect(() => config(DEV_SERVER_PHASE)).toThrowError(/AUTH_SECRET/)
    expect(() => config(DEV_SERVER_PHASE)).toThrowError(/APP_URL/)
  })

  it('ne réclame ni secret ni URL publique pendant `next build`', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://app:app@localhost:5432/app')
    stubMailer('capture')
    stubAuth('aucun')

    const config = await loadNextConfig()

    expect(() => config(BUILD_PHASE)).not.toThrow()
  })

  it('ne réclame pas de mailer pendant `next build` : le build s’exécute sans les variables d’exécution', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://app:app@localhost:5432/app')
    stubMailer('aucun')
    stubAuth('aucun')

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
