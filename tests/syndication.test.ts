import { loadRootEnv } from '@repo/config/server'
import { robotsAllows, type RobotsPolicy } from '@repo/core'
import { describe, expect, it, vi } from 'vitest'

import { appLocales } from '../config/i18n'

/**
 * **Ce que l'application donne à indexer**, sur les deux fichiers qu'un robot
 * lit — et dans les configurations de modules qui les font diverger (s53).
 *
 * La règle pure vit dans `packages/core/src/syndication.test.ts`. Ce fichier-ci
 * pose les questions que la règle seule ne peut pas poser :
 *
 * 1. `app/robots.ts` **autorise-t-il `/blog`** ? C'est le critère 1, et il était
 *    faux jusqu'ici : s29 a livré le blog activé et interdit ;
 * 2. les articles sont-ils dans `app/sitemap.ts`, avec leurs alternates, et
 *    **seulement dans les langues où ils existent** ?
 * 3. que devient tout cela quand `marketing` est coupé, puis quand les deux le
 *    sont ? La bascule sur liste vide (`robotsPolicy`) change de sens dès qu'un
 *    second module contribue, et c'est écrit ici ;
 * 4. une contribution vers une route d'API reçoit-elle un préfixe de langue
 *    qu'aucun serveur ne sert ?
 *
 * **La configuration est reçue, jamais celle du dépôt** : le registre est
 * construit par le test, si bien que les quatre cas sont éprouvés dans la même
 * exécution, quel que soit l'état de `config/features.ts`.
 */

/**
 * Le `.env` racine, comme `tests/fixtures/database.ts` : `resolveSiteUrl()`
 * passe par `getEnv()`, qui valide **tout** l'environnement — `APP_URL` seule
 * stubée ne suffit donc pas. En intégration continue, le job pose déjà ces
 * variables ; en local, ce chargement évite d'avoir à les exporter à la main.
 * Aucune base n'est ouverte par ce fichier.
 */
loadRootEnv()

const SITE = 'https://app.test'

/**
 * Le registre est construit **dans la fabrique de la doublure**, après
 * `vi.resetModules()`, et c'est une nécessité mesurée : les modules gardent un
 * accès différé à leur contenu dans une variable de module. Un registre
 * construit avant la réinitialisation référencerait l'instance précédente de
 * `@repo/module-marketing`, si bien que `prepareModuleContent()` remplirait une
 * variable et que la contribution en lirait une autre — le refus « contenu non
 * fourni » tombe alors, et il est le bon.
 */
const requested = { enabled: [] as readonly string[], extra: [] as readonly unknown[] }

const registryNow = async () => {
  const { buildRegistry: build } = await import('@repo/core')
  const { availableModules: modules, requiredModules: base } = await import('../config/features')
  const { appLocales: locales } = await import('../config/i18n')

  return build({
    available: [...modules, ...(requested.extra as (typeof modules)[number][])],
    enabled: [...base, 'i18n', ...requested.enabled],
    required: [...base],
    locales: [...locales],
  })
}

interface ServedMetadata {
  readonly sitemap: readonly {
    url: string
    alternates?: { languages?: Record<string, string> }
    lastModified?: unknown
  }[]
  readonly robots: {
    rules: { userAgent?: string; allow?: string[] | string; disallow?: string[] | string }
    sitemap?: string
  }
}

/**
 * Les deux fichiers **tels que Next les rendra**, pour une configuration.
 *
 * Rien n'est doublé que le registre : les points de composition du site public
 * et du blog sont les vrais, ils lisent la vraie configuration marketing et les
 * vrais articles du disque.
 */
const servedFor = async (
  enabled: readonly string[],
  extra: readonly unknown[] = [],
): Promise<ServedMetadata> => {
  requested.enabled = enabled
  requested.extra = extra
  vi.stubEnv('APP_URL', `${SITE}/`)
  vi.resetModules()
  vi.doMock('../apps/web/lib/module-registry', async () => ({
    moduleRegistry: await registryNow(),
  }))

  const { default: sitemap } = await import('../apps/web/app/sitemap')
  const { default: robots } = await import('../apps/web/app/robots')

  const served = { sitemap: sitemap(), robots: robots() } as ServedMetadata

  vi.doUnmock('../apps/web/lib/module-registry')
  vi.unstubAllEnvs()

  return served
}

/** La politique telle qu'un robot la lit, à partir de ce que Next rendra. */
const policyOf = (served: ServedMetadata): RobotsPolicy => {
  const list = (value: string[] | string | undefined): string[] =>
    value === undefined ? [] : Array.isArray(value) ? [...value] : [value]

  return {
    rules: {
      userAgent: '*',
      allow: list(served.robots.rules.allow),
      disallow: list(served.robots.rules.disallow),
    },
    ...(served.robots.sitemap === undefined ? {} : { sitemap: served.robots.sitemap }),
  }
}

const pathnamesOf = (served: ServedMetadata): string[] =>
  served.sitemap.map((entry) => new URL(entry.url).pathname)

describe('tout est activé : le blog est indexable', () => {
  it('autorise `/blog` et chaque article, et les référence dans le plan de site', async () => {
    const served = await servedFor(['marketing', 'blog'])
    const policy = policyOf(served)
    const { blogCatalog } = await import('../apps/web/lib/blog')
    const { marketingSite } = await import('../apps/web/lib/marketing')

    // Garde contre l'inertie : sans article lu sur le disque, tout ce qui suit
    // serait vrai sur rien.
    expect(blogCatalog.articles.length).toBeGreaterThan(0)
    expect(marketingSite.publicPaths.length).toBeGreaterThan(0)

    // Le critère 1 : `/blog` était **interdit** jusqu'à cette story.
    expect(robotsAllows(policy, '/fr/blog')).toBe(true)
    expect(pathnamesOf(served)).toContain('/fr/blog')

    for (const article of blogCatalog.articles) {
      const url = `/${article.locale}/blog/${article.slug}`

      // Autorisé dans **chaque** langue où il existe ; référencé une seule
      // fois, sa canonique portant les autres langues en `hreflang` — deux
      // entrées pour la même page seraient deux URL pour un moteur.
      expect(robotsAllows(policy, url), url).toBe(true)
      expect(
        served.sitemap.some((entry) =>
          Object.values(entry.alternates?.languages ?? {}).includes(`${SITE}${url}`),
        ),
        url,
      ).toBe(true)
    }

    expect(pathnamesOf(served)).toContain(
      `/fr/blog/${blogCatalog.articles[0]?.slug ?? ''}`,
    )

    // Et le site public n'a rien perdu au passage : ses chemins restent
    // autorisés, alors que plus une ligne des deux fichiers ne le nomme.
    for (const pathname of marketingSite.publicPaths) {
      const url = pathname === '/' ? '/fr' : `/fr${pathname}`

      expect(robotsAllows(policy, url), url).toBe(true)
    }

    expect(policy.sitemap).toBe(`${SITE}/sitemap.xml`)
  })

  it('n’ouvre rien de plus qu’avant : ni l’application, ni un slug inconnu', async () => {
    const policy = policyOf(await servedFor(['marketing', 'blog']))

    for (const url of [
      '/fr/account',
      '/fr/sign-in',
      '/fr/reset-password?token=jeton-de-reinitialisation',
      // Un article qui n'existe pas : le motif est **ancré**, il n'ouvre pas
      // `/blog/*`.
      '/fr/blog/article-inconnu',
      '/fr/blog/mon-article/annexe',
    ]) {
      expect(robotsAllows(policy, url), url).toBe(false)
    }
  })

  it('n’indexe pas un écran au seul motif que sa navigation est publique', async () => {
    // La décision de s53, mesurée : la configuration livrée compte **cinq**
    // entrées de navigation publiques, dont `/sign-in`, `/pricing` et une route
    // d'API. Les dériver aurait publié l'écran de connexion dans le plan de
    // site (`docs/security.md` §7). Seule la quinzième clé décide (ADR 054).
    const served = await servedFor(['marketing', 'blog', 'billing', 'organizations'])
    const policy = policyOf(served)
    const { moduleRegistry } = await import('../apps/web/lib/module-registry')
    const publicEntries = moduleRegistry.navigation.filter(
      (entry) => entry.protection.level === 'public',
    )
    const declared = new Set(pathnamesOf(served))

    // Garde contre l'inertie : sans entrée publique non contribuée, ce cas ne
    // vérifierait rien.
    const notContributed = publicEntries.filter(
      (entry) => !declared.has(`/fr${entry.href}`) && !declared.has(entry.href),
    )

    expect(notContributed.map((entry) => entry.href)).toContain('/sign-in')

    for (const entry of notContributed) {
      expect(robotsAllows(policy, `/fr${entry.href}`), entry.href).toBe(false)
    }
  })

  it('porte une variante par langue, et jamais une langue où l’article n’existe pas', async () => {
    const served = await servedFor(['marketing', 'blog'])
    const { blogCatalog } = await import('../apps/web/lib/blog')
    const localesOf = (slug: string) =>
      blogCatalog.articles.filter((article) => article.slug === slug).map((a) => a.locale)
    const slugs = [...new Set(blogCatalog.articles.map((article) => article.slug))]
    const partial = slugs.filter((slug) => localesOf(slug).length < appLocales.length)

    // Garde contre l'inertie : sans article partiellement traduit, la boucle
    // ci-dessous ne prouverait rien du critère i18n.
    expect(partial.length).toBeGreaterThan(0)

    for (const slug of slugs) {
      const entry = served.sitemap.find((candidate) =>
        candidate.url.endsWith(`/blog/${slug}`),
      )

      expect(Object.keys(entry?.alternates?.languages ?? {}).sort(), slug).toEqual(
        [...localesOf(slug)].sort(),
      )
    }

    const [orphan] = partial

    expect(
      robotsAllows(
        policyOf(served),
        `/${appLocales.find((locale) => !localesOf(orphan ?? '').includes(locale))}/blog/${orphan}`,
      ),
    ).toBe(false)
  })
})

describe('le site public coupé, le blog activé', () => {
  it('annonce le plan de site là où il était tu, et n’autorise que le blog', async () => {
    // **La bascule que la story assume** (piège 3 de la recherche) :
    // `robotsPolicy` rend `disallow: ['/']` **sans `Sitemap:`** quand aucun
    // chemin n'est public. Avec un second contributeur, la liste cesse d'être
    // vide dans une configuration où elle l'était : le plan de site réapparaît.
    // Ce n'est pas un défaut — il référence de vrais articles.
    const served = await servedFor(['blog'])
    const policy = policyOf(served)

    expect(policy.sitemap).toBe(`${SITE}/sitemap.xml`)
    expect(robotsAllows(policy, '/fr/blog')).toBe(true)

    // Le site public n'existe plus : ni sa racine, ni son contact.
    for (const url of ['/fr', '/', '/fr/contact']) {
      expect(robotsAllows(policy, url), url).toBe(false)
    }

    expect(pathnamesOf(served)).not.toContain('/fr/contact')
    expect(pathnamesOf(served)).toContain('/fr/blog')
  })
})

describe('les deux coupés', () => {
  it('n’annonce plus rien : tout est interdit, aucun plan de site', async () => {
    const served = await servedFor([])

    expect(served.sitemap).toEqual([])
    expect(served.robots.sitemap).toBeUndefined()
    expect(served.robots.rules).toEqual({ userAgent: '*', disallow: ['/'] })
  })
})

describe('une contribution vers une route montée', () => {
  it('n’est jamais préfixée d’une langue que rien ne sert', async () => {
    // Le piège nommé par la recherche : `publicPath` préfixe **sans
    // condition**, alors que `apps/web/proxy.ts` ne préfixe jamais `/api…`.
    // Le dépôt en compte déjà une entrée de navigation publique
    // (`demo-enabled`) ; une contribution du même chemin produirait une URL
    // que rien ne sert, autorisée pour rien.
    const contributor = {
      id: 'essai-api',
      requires: [],
      schema: {},
      migrations: null,
      routes: [],
      navigation: [],
      publicUrls: () => [{ path: '/api/modules/essai-api/flux', locales: ['fr', 'en'] }],
      messages: { fr: {}, en: {} },
      emails: [],
      webhooks: [],
      jobs: [],
      dataCategories: [],
      retention: {},
      purge: () => Promise.resolve(),
      export: () => Promise.resolve({}),
    }

    const served = await servedFor(['essai-api'], [contributor])

    expect(pathnamesOf(served)).toEqual(['/api/modules/essai-api/flux'])
    expect(policyOf(served).rules.allow).toEqual(['/api/modules/essai-api/flux$'])
  })
})

describe('l’origine des URL de métadonnées', () => {
  it('vient d’`APP_URL`, et ne fait jamais tomber un rendu quand elle manque', async () => {
    // `app/layout.tsx` la lit sur **chaque** écran et pendant `next build`, où
    // aucune `APP_URL` n'est posée. Elle rend donc `null` au lieu de lever —
    // c'est l'inverse de `resolveSiteUrl`, dont l'absence doit crier.
    const { metadataBaseUrl } = await import('../apps/web/lib/site-url')

    expect(metadataBaseUrl({ APP_URL: `${SITE}/` } as never)?.origin).toBe(SITE)
    expect(metadataBaseUrl({} as never)).toBeNull()
    expect(metadataBaseUrl({ APP_URL: 'pas-une-url' } as never)).toBeNull()
  })
})
