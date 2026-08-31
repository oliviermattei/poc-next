import { NextRequest } from 'next/server'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { contentSecurityPolicySources } from '../config/security'
import {
  CSP_REPORT_PATH,
  NONCE_HEADER,
  securityHeaders,
  type ContentSecurityPolicySources,
} from '../apps/web/lib/security-headers'
import { GET, POST } from '../apps/web/app/api/csp-report/route'
import { proxy } from '../apps/web/proxy'
// Le design system par son chemin de source : `@repo/ui` n'est pas une
// dépendance de la racine, et l'y ajouter pour un test aurait fait entrer React
// dans le graphe du dépôt racine.
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '../packages/ui/src/index'

/* ------------------------------------------------------------------------- *
 * Outils de lecture : on juge une politique en la **découpant**, jamais en y
 * cherchant une sous-chaîne. « `unsafe-inline` absent » vérifié au `includes`
 * serait vrai d'un `style-src-attr 'unsafe-inline'` écrit autrement, et faux
 * d'un commentaire. Ici, chaque directive rend la liste de ses sources.
 * ------------------------------------------------------------------------- */

type Directives = ReadonlyMap<string, readonly string[]>

const parsePolicy = (policy: string): Directives =>
  new Map(
    policy
      .split(';')
      .map((directive) => directive.trim())
      .filter((directive) => directive.length > 0)
      .map((directive) => {
        const [name, ...sources] = directive.split(/\s+/)

        return [name!, sources] as const
      }),
  )

/** Tous les mots-clés permissifs de CSP, quelle que soit la directive. */
const PERMISSIVE = ["'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'", "'wasm-unsafe-eval'"]

const allSources = (directives: Directives): readonly string[] =>
  [...directives.entries()]
    // `report-uri` porte un chemin, pas une source : l'inclure ferait passer
    // n'importe quelle URL pour une source déclarée.
    .filter(([name]) => name !== 'report-uri')
    .flatMap(([, sources]) => sources)

const NONCE = 'dGVzdC1ub25jZS0wMDAx'

const policyFor = (
  mode: 'development' | 'production',
  sources: ContentSecurityPolicySources = contentSecurityPolicySources,
  reportPath: string = CSP_REPORT_PATH,
): Directives =>
  parsePolicy(
    securityHeaders({ mode, nonce: NONCE, sources, reportPath })['content-security-policy']!,
  )

/* ------------------------------------------------------------------------- *
 * §1 du socle : la politique elle-même.
 * ------------------------------------------------------------------------- */

describe('la politique de sécurité du contenu', () => {
  it('n’autorise en production aucun mot-clé permissif, dans aucune directive', () => {
    // Le critère central de la story, et le seul que la revue mutera :
    // `unsafe-inline` ou `unsafe-eval` réapparu doit faire rougir ici.
    // Balayé : toutes les directives rendues, pas seulement `script-src`.
    for (const [name, sources] of policyFor('production')) {
      for (const keyword of PERMISSIVE) {
        expect(sources, `${name} porte ${keyword}`).not.toContain(keyword)
      }
    }
  })

  it('pose `default-src \'self\'` et le nonce de la requête sur les scripts', () => {
    const production = policyFor('production')

    expect(production.get('default-src')).toEqual(["'self'"])
    expect(production.get('script-src')).toContain(`'nonce-${NONCE}'`)
    expect(production.get('style-src')).toContain(`'nonce-${NONCE}'`)
  })

  it('ferme les vecteurs que `default-src` ne couvre pas', () => {
    // `object-src`, `base-uri`, `form-action` et `frame-ancestors` ne retombent
    // **pas** sur `default-src` : les omettre laisse une politique qui a l'air
    // stricte et ne l'est pas.
    const production = policyFor('production')

    expect(production.get('object-src')).toEqual(["'none'"])
    expect(production.get('base-uri')).toEqual(["'self'"])
    expect(production.get('frame-ancestors')).toEqual(["'none'"])
    expect(production.get('form-action')).toEqual(["'self'"])
  })

  it('n’assouplit en développement que l’évaluation et les styles, jamais les scripts en ligne', () => {
    // Mesuré (recherche §2.3) : React reconstruit les piles serveur par `eval`
    // et Turbopack injecte le CSS par JavaScript. Rien d'autre n'est nécessaire,
    // et surtout pas `'unsafe-inline'` dans `script-src` — c'est ce qui rend
    // démontrable dans un navigateur qu'un script en ligne sans nonce est
    // refusé, alors même que les parcours tournent sur `next dev`.
    const development = policyFor('development')

    expect(development.get('script-src')).toContain("'unsafe-eval'")
    expect(development.get('script-src')).not.toContain("'unsafe-inline'")
    expect(development.get('style-src')).toContain("'unsafe-inline'")
    expect(development.get('style-src')).not.toContain("'unsafe-eval'")
  })

  it('collecte les violations en développement, et nulle part ailleurs', () => {
    expect(policyFor('development').get('report-uri')).toEqual([CSP_REPORT_PATH])
    expect(policyFor('production').has('report-uri')).toBe(false)
  })

  it('collecte là où l’appelant le dit, et non là où le constructeur le décide', () => {
    // Le chemin du collecteur est un **argument**, comme le mode, le nonce et
    // les sources : c'est la signature que le plan (tâche 2) spécifie, et c'est
    // ce qui empêche la politique et la route qui la sert de diverger en
    // silence. Une constante de module aurait rendu la divergence indétectable.
    expect(policyFor('development', contentSecurityPolicySources, '/ailleurs').get('report-uri')).toEqual(
      ['/ailleurs'],
    )
  })
})

/* ------------------------------------------------------------------------- *
 * « Les sources tierces autorisées sont déclarées dans une configuration
 * unique, jamais dispersées ; ajouter une source hors de cette configuration
 * fait échouer un test. »
 * ------------------------------------------------------------------------- */

describe('les sources tierces', () => {
  it('ne sortent que de `config/security.ts`, jamais du constructeur', () => {
    // La garde qui mord : un domaine écrit en dur dans le constructeur — le
    // geste naturel quand on « fait marcher » un script d'analyse — produit un
    // jeton qu'aucune ligne de la configuration ne justifie.
    const declared = new Set(Object.values(contentSecurityPolicySources).flat())

    for (const mode of ['production', 'development'] as const) {
      for (const source of allSources(policyFor(mode))) {
        expect(
          source.startsWith("'") || declared.has(source),
          `${source} n’est déclaré nulle part dans config/security.ts`,
        ).toBe(true)
      }
    }
  })

  it('reporte dans la politique celles que la configuration déclare, sans jamais perdre `\'self\'`', () => {
    // Sans ce cas, la garde ci-dessus serait vraie sur une configuration
    // ignorée : on prouve d'abord que le fichier est réellement lu.
    //
    // Les **sept** clés de `ContentSecurityPolicySources` sont exercées, une
    // origine sentinelle par clé — la revue de s45 a trouvé que `frame-src`
    // était la seule à **remplacer** `'self'` par la source déclarée au lieu de
    // l'y ajouter, et aucun cas ne le voyait : seuls `script` et `connect`
    // étaient exercés. Déclarer l'iframe d'un captcha aurait alors coupé les
    // iframes de même origine.
    const sentinel: ContentSecurityPolicySources = {
      script: ['https://captcha.example.test'],
      style: ['https://styles.example.test'],
      connect: ['https://analytics.example.test'],
      img: ['https://pixels.example.test'],
      font: ['https://fonts.example.test'],
      frame: ['https://widget.example.test'],
      formAction: ['https://checkout.example.test'],
    }
    const policy = policyFor('production', sentinel)
    const declaredIn: readonly (readonly [string, string])[] = [
      ['script-src', 'https://captcha.example.test'],
      ['style-src', 'https://styles.example.test'],
      ['connect-src', 'https://analytics.example.test'],
      ['img-src', 'https://pixels.example.test'],
      ['font-src', 'https://fonts.example.test'],
      ['frame-src', 'https://widget.example.test'],
      ['form-action', 'https://checkout.example.test'],
    ]

    for (const [directive, source] of declaredIn) {
      expect(policy.get(directive), directive).toContain(source)
      // Une source déclarée **s'ajoute**, elle ne remplace pas l'origine de
      // l'application : sinon le jour où s28 déclare son captcha, les iframes,
      // les images ou les polices servies par l'application cessent d'être
      // chargées.
      expect(policy.get(directive), `${directive} a perdu 'self'`).toContain("'self'")
    }
  })

  it('ferme `frame-src` quand aucun iframe n’est déclaré', () => {
    // L'état livré : `'none'`, et non `'self'`. L'application n'intègre aucun
    // iframe, et `frame-ancestors 'none'` dit déjà qu'elle refuse d'être
    // encadrée — la réciproque doit être aussi fermée par défaut.
    expect(policyFor('production').get('frame-src')).toEqual(["'none'"])
  })

  it('ne déclare aucune source tierce dans l’état livré', () => {
    // La justification écrite qu'exige `docs/security.md` §1 n'a rien à couvrir
    // aujourd'hui : ce cas rougit le jour où quelqu'un en ajoute une sans passer
    // par une story, et c'est exactement ce qu'on veut lui demander.
    expect(Object.values(contentSecurityPolicySources).flat()).toEqual([])
  })
})

/* ------------------------------------------------------------------------- *
 * Les cinq autres en-têtes du socle §1.
 * ------------------------------------------------------------------------- */

describe('les autres en-têtes du socle', () => {
  const headers = securityHeaders({
    mode: 'production',
    nonce: NONCE,
    sources: contentSecurityPolicySources,
    reportPath: CSP_REPORT_PATH,
  })

  it('impose HTTPS pour au moins un an, sous-domaines compris', () => {
    const hsts = headers['strict-transport-security']!
    const maxAge = Number(/max-age=(\d+)/.exec(hsts)?.[1])

    expect(maxAge).toBeGreaterThanOrEqual(31_536_000)
    expect(hsts).toMatch(/includeSubDomains/)
  })

  it('refuse le reniflage de type, la fuite de référent et l’encadrement', () => {
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
    expect(headers['x-frame-options']).toBe('DENY')
  })

  it('refuse caméra, micro et géolocalisation par défaut', () => {
    const permissions = headers['permissions-policy']!

    for (const feature of ['camera', 'microphone', 'geolocation']) {
      expect(permissions, feature).toMatch(new RegExp(`${feature}=\\(\\)`))
    }
  })
})

/* ------------------------------------------------------------------------- *
 * « Un rapport de violation est collecté en développement, sans dépendre d'un
 * service tiers. »
 * ------------------------------------------------------------------------- */

const aViolation = (directive: string) =>
  new Request(`https://example.test${CSP_REPORT_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/csp-report' },
    body: JSON.stringify({
      'csp-report': {
        'document-uri': 'https://example.test/fr',
        'effective-directive': directive,
        'blocked-uri': 'inline',
        'script-sample': 'window.pwned = 1',
      },
    }),
  })

describe('le collecteur de violations', () => {
  it('enregistre en développement ce que le navigateur signale', async () => {
    vi.stubEnv('NODE_ENV', 'development')

    expect((await POST(aViolation('script-src-elem'))).status).toBe(204)

    const collected = await (await GET()).json()

    expect(collected.reports.at(-1)).toMatchObject({
      directive: 'script-src-elem',
      blockedUri: 'inline',
      documentUri: 'https://example.test/fr',
    })
  })

  it('refuse un corps qui n’est pas un rapport, sans rien enregistrer', async () => {
    // Zod à chaque frontière (`docs/security.md` §4) : cette route accepte un
    // POST anonyme et non authentifié, c'est exactement le genre d'entrée qu'on
    // ne recopie pas telle quelle dans un journal.
    vi.stubEnv('NODE_ENV', 'development')

    const before = (await (await GET()).json()).reports.length

    expect((await POST(new Request(`https://example.test${CSP_REPORT_PATH}`, {
      method: 'POST',
      body: 'pas du json',
    }))).status).toBe(400)
    expect((await (await GET()).json()).reports).toHaveLength(before)
  })

  it('n’écrit jamais une ligne de journal que le rapport aurait choisie', async () => {
    // Injection de journal : `blocked-uri`, `document-uri` et `script-sample`
    // viennent d'un POST anonyme et finissent interpolés dans le terminal du
    // développeur. Un retour à la ligne y fabrique une **seconde ligne**, qu'un
    // humain — ou l'agent qui lit la sortie — prendra pour un message du
    // serveur. Bornées en longueur par Zod, ces valeurs ne l'étaient pas en
    // forme.
    vi.stubEnv('NODE_ENV', 'development')

    const warned: string[] = []
    const spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warned.push(args.map(String).join(' '))
    })

    const response = await POST(
      new Request(`https://example.test${CSP_REPORT_PATH}`, {
        method: 'POST',
        body: JSON.stringify({
          'csp-report': {
            'document-uri': 'https://example.test/fr\n[info] rien à signaler',
            'effective-directive': 'script-src-elem',
            'blocked-uri': 'inline\r\n[erreur] la base est tombée',
            'script-sample': 'window.pwned = 1\nCSP: aucune violation',
          },
        }),
      }),
    )

    spy.mockRestore()

    expect(response.status).toBe(204)
    expect(warned).toHaveLength(1)
    expect(warned[0]).not.toMatch(/[\r\n]/)

    // Le tampon relu par `GET` non plus : c'est la même donnée, et elle finit
    // aussi sous les yeux de quelqu'un.
    const stored = (await (await GET()).json()).reports.at(-1)

    expect(JSON.stringify(stored)).not.toMatch(/\\[rn]/)
  })

  it('borne ce qu’il garde en mémoire', async () => {
    // N'importe quelle page peut déclencher un rapport : une liste non bornée
    // est une fuite mémoire à la demande (`docs/reliability.md` §5).
    vi.stubEnv('NODE_ENV', 'development')

    for (let index = 0; index < 80; index += 1) {
      await POST(aViolation('style-src-elem'))
    }

    expect((await (await GET()).json()).reports.length).toBeLessThanOrEqual(50)
  })

  it('n’existe pas en production, ni en écriture ni en lecture', async () => {
    // La politique de production ne porte pas de `report-uri` : la route ne doit
    // pas non plus offrir une surface d'écriture anonyme à qui la devinerait.
    vi.stubEnv('NODE_ENV', 'production')

    expect((await POST(aViolation('script-src-elem'))).status).toBe(404)
    expect((await GET()).status).toBe(404)
  })
})

/* ------------------------------------------------------------------------- *
 * Ce que la politique refuse dans le HTML servi. Un attribut `style` rendu par
 * le serveur est gouverné par `style-src-attr`, qui ne connaît pas les nonces :
 * il ne reste qu'à ne plus en émettre.
 * ------------------------------------------------------------------------- */

describe('le design system n’émet aucun style en ligne', () => {
  it('rend un accordéon sans attribut `style`', () => {
    // Mesuré (recherche §2.2) : Radix écrit **toujours** deux variables CSS sur
    // le contenu d'accordéon, `--radix-accordion-content-height` et sa jumelle
    // de largeur. Aucune règle de `packages/ui/src/styles.css` ne s'en sert, et
    // pourtant chaque visite de l'accueil public déclenchait une violation
    // `style-src-attr`. Le composé du design system les neutralise donc.
    const markup = renderToStaticMarkup(
      createElement(
        Accordion,
        { type: 'single', collapsible: true, defaultValue: 'a' },
        createElement(
          AccordionItem,
          { value: 'a' },
          createElement(AccordionTrigger, null, 'q'),
          createElement(AccordionContent, null, 'r'),
        ),
      ),
    )

    expect(markup).toContain('data-slot="accordion-content"')
    expect(markup).not.toMatch(/\sstyle="/)
  })

  it('laisse passer le style qu’un appelant demande explicitement', () => {
    // La neutralisation ne doit pas devenir une interdiction : un appelant qui
    // pose un style le garde, et c'est alors **sa** story qui doit en répondre
    // devant la politique.
    const markup = renderToStaticMarkup(
      createElement(
        Accordion,
        { type: 'single', collapsible: true, defaultValue: 'a' },
        createElement(
          AccordionItem,
          { value: 'a' },
          createElement(AccordionTrigger, null, 'q'),
          createElement(AccordionContent, { style: { color: 'red' } }, 'r'),
        ),
      ),
    )

    expect(markup).toMatch(/style="color:red"/)
  })
})

/* ------------------------------------------------------------------------- *
 * Ce que le serveur envoie **réellement** : la réponse rendue par le proxy,
 * pas le texte d'un fichier de configuration. Une garde qui lit la forme se
 * contourne par une reformulation ; celle-ci mesure le comportement.
 * ------------------------------------------------------------------------- */

const responseFor = (path: string) =>
  proxy(new NextRequest(new URL(`https://example.test${path}`), { headers: { 'accept-language': 'fr' } }))

const servedPolicy = (path: string): Directives =>
  parsePolicy(responseFor(path).headers.get('content-security-policy') ?? '')

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('les en-têtes réellement servis', () => {
  it('accompagnent une page, une route d’API et un fichier racine', () => {
    // Critère : « présents aussi bien sur les pages publiques que sur les routes
    // de l'API ». `/robots.txt` est le troisième cas, celui que l'ancien
    // `matcher` excluait par son motif à point.
    for (const path of ['/fr/sign-in', '/api/health', '/robots.txt']) {
      const headers = responseFor(path).headers

      expect(headers.get('content-security-policy'), path).toBeTruthy()
      expect(headers.get('strict-transport-security'), path).toBeTruthy()
      expect(headers.get('x-content-type-options'), path).toBe('nosniff')
      expect(headers.get('referrer-policy'), path).toBe('strict-origin-when-cross-origin')
      expect(headers.get('permissions-policy'), path).toBeTruthy()
      expect(headers.get('x-frame-options'), path).toBe('DENY')
    }
  })

  it('ne porte, sous NODE_ENV=production, aucun mot-clé permissif', () => {
    // **Le critère qui compte le plus.** Il se lit sur l'en-tête que la réponse
    // emporte, pas sur une constante du dépôt : rendre la politique depuis un
    // autre fichier, la reformuler ou la concaténer autrement ne change rien à
    // ce que le navigateur reçoit, donc rien à ce que ce cas mesure.
    vi.stubEnv('NODE_ENV', 'production')

    for (const path of ['/fr/sign-in', '/api/health']) {
      for (const [name, sources] of servedPolicy(path)) {
        for (const keyword of PERMISSIVE) {
          expect(sources, `${path} → ${name} porte ${keyword}`).not.toContain(keyword)
        }
      }
    }
  })

  it('donne un nonce neuf à chaque requête, et le même à Next qu’au navigateur', () => {
    // Next lit le nonce dans les en-têtes de la **requête**
    // (`app-render.js` → `getScriptNonceFromHeader`), pas de la réponse. Poser
    // l'un sans l'autre donne une politique correcte et une page cassée.
    const first = responseFor('/fr/sign-in')
    const second = responseFor('/fr/sign-in')

    const nonceOf = (response: ReturnType<typeof responseFor>): string => {
      const matched = /'nonce-([^']+)'/.exec(
        response.headers.get('content-security-policy') ?? '',
      )

      return matched?.[1] ?? ''
    }

    expect(nonceOf(first)).not.toBe('')
    expect(nonceOf(first)).not.toBe(nonceOf(second))
    expect(first.headers.get(NONCE_HEADER)).toBe(nonceOf(first))

    // La politique que Next lira : `NextResponse.next({ request })` encode les
    // en-têtes de requête réécrits sous `x-middleware-request-…`. C'est là que
    // se voit — sans démarrer de serveur — que la politique atteint bien le
    // rendu, et pas seulement le navigateur. Retirer la ligne du proxy laisse
    // une politique parfaite sur une page qui ne s'hydrate plus.
    expect(first.headers.get('x-middleware-request-content-security-policy')).toBe(
      first.headers.get('content-security-policy'),
    )
    expect(first.headers.get('x-middleware-request-x-nonce')).toBe(nonceOf(first))
  })

  it('laisse le préfixe de locale exactement où il était', () => {
    // La régression que l'élargissement du `matcher` rendait possible : sans
    // condition interne, `canonicalPath('/robots.txt')` redirige vers
    // `/fr/robots.txt` et le plan de site cesse d'être servi.
    //
    // Les **quatre** exclusions de l'ancien motif
    // (`'/((?!api|_next|favicon.ico|.*\\..*).*)'`) sont reprises une à une, et
    // c'est le sens du mot « identique » : la revue de s45 a mesuré que la
    // première version, qui ne cherchait le point que sur le **dernier**
    // segment et avait laissé tomber `_next`, redirigeait désormais
    // `/v1.2/page` et `/_next/quelque-chose` — deux formes que le motif
    // excluait. Aucune route de ce genre n'existe aujourd'hui ; la propriété
    // affirmée par `proxy.ts` doit être vraie quand même.
    for (const path of [
      '/api/health',
      '/api/modules/auth/session',
      '/_next/quelque-chose',
      '/favicon.ico',
      '/robots.txt',
      '/sitemap.xml',
      // Un point ailleurs que sur le dernier segment : le motif l'excluait
      // (`.*\..*` balaie tout le chemin), la condition interne doit l'exclure
      // aussi.
      '/v1.2/page',
    ]) {
      expect(responseFor(path).status, path).toBe(200)
      expect(responseFor(path).headers.get('location'), path).toBeNull()
    }

    // Et il continue de s'appliquer là où il s'appliquait : une page sans
    // préfixe est redirigée vers sa forme canonique.
    expect(responseFor('/sign-in').headers.get('location')).toContain('/fr/sign-in')
  })
})
