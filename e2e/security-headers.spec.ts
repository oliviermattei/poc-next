import { expect, test } from '@playwright/test'

import { CSP_REPORT_PATH } from '../apps/web/lib/security-headers'
import { anonymousLanding, publicPath } from './support/locale'

/**
 * La politique de sécurité du contenu, vue depuis un navigateur qui l'applique.
 *
 * Ce que ce fichier prouve et qu'aucun test Vitest ne peut prouver : qu'un
 * script en ligne sans nonce **ne s'exécute pas**, que l'application reste
 * hydratée et utilisable sous la politique, et que rien de ce qu'elle sert n'est
 * refusé au passage. Un en-tête correct sur une page cassée n'est pas une
 * politique stricte, c'est une application cassée.
 *
 * **Ce que ce fichier ne peut pas prouver, et c'est dit plutôt que sous-entendu**
 * : `playwright.config.ts` démarre `next dev`, où la politique porte
 * `'unsafe-eval'` (React reconstruit les piles serveur par `eval`) et
 * `'unsafe-inline'` de **style** (Turbopack injecte le CSS par JavaScript).
 * Aucun parcours ne peut donc constater une violation de style. Ce que la
 * production interdit se mesure sur la réponse rendue par `proxy()` sous
 * `NODE_ENV=production` (`tests/security-headers.test.ts`).
 * `script-src`, lui, n'a **jamais** `'unsafe-inline'`, pas même en
 * développement : c'est ce qui rend le cas central de ce fichier possible.
 */

const home = anonymousLanding()

test('toute réponse porte le socle d’en-têtes, page comme route d’API', async ({ request }) => {
  for (const path of [publicPath(home), '/api/health', '/robots.txt']) {
    const headers = (await request.get(path)).headers()

    expect(headers['content-security-policy'], path).toContain("default-src 'self'")
    expect(headers['strict-transport-security'], path).toMatch(/max-age=\d+/)
    expect(headers['x-content-type-options'], path).toBe('nosniff')
    expect(headers['referrer-policy'], path).toBe('strict-origin-when-cross-origin')
    expect(headers['permissions-policy'], path).toContain('camera=()')
    expect(headers['x-frame-options'], path).toBe('DENY')
  }
})

test('le nonce change à chaque requête', async ({ request }) => {
  const nonceOf = async (): Promise<string> => {
    const policy = (await request.get(publicPath(home))).headers()['content-security-policy'] ?? ''

    return /'nonce-([^']+)'/.exec(policy)?.[1] ?? ''
  }

  const first = await nonceOf()

  expect(first).not.toBe('')
  expect(first).not.toBe(await nonceOf())
})

test('un script en ligne sans nonce ne s’exécute pas, et la violation est collectée', async ({
  page,
  request,
}) => {
  // Le script est injecté **dans le HTML servi**, exactement comme le ferait une
  // injection réussie : analysé par le parseur, donc jugé par `script-src` sans
  // que `'strict-dynamic'` puisse lui transmettre la confiance d'un script déjà
  // autorisé. L'injecter depuis `page.evaluate` aurait prouvé le contraire de ce
  // qu'on croit — `'strict-dynamic'` fait confiance à ce qu'un script de
  // confiance insère.
  await page.route(`**${publicPath(home)}`, async (route) => {
    const response = await route.fetch()
    const body = await response.text()

    await route.fulfill({
      response,
      // Dans `<head>`, hors de la racine d'hydratation de React : le parcours
      // mesure ce que fait le **navigateur** d'un script non nonçé, pas ce que
      // React fait d'un nœud inattendu au milieu de son arbre.
      body: body.replace('</head>', '<script>window.__injected = true</script></head>'),
    })
  })

  await page.goto(publicPath(home))
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  // Le script n'a pas tourné. Il s'exécute au parseur, avant toute hydratation :
  // ce constat ne dépend donc pas de la suite du chargement.
  expect(await page.evaluate(() => '__injected' in window)).toBe(false)

  // **Ce cas ne dit rien de l'hydratation, et c'est mesuré** : une interception
  // `page.route`, même en simple relais sans modifier un octet, suffit à
  // empêcher l'hydratation du serveur de développement — la connexion HMR de
  // Next échoue alors en `ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`, le
  // navigateur ne traitant pas une réponse forgée par Playwright comme la même
  // origine réseau. Vérifié en retirant l'injection : le menu ne s'ouvre pas
  // davantage. Que l'application reste hydratée sous la politique est donc
  // prouvé par le cas suivant, qui n'intercepte rien.

  // Le rapport est arrivé, sans service tiers : c'est l'application qui collecte.
  await expect(async () => {
    const collected = await (await request.get(CSP_REPORT_PATH)).json()

    expect(
      collected.reports.some((report: { directive: string }) =>
        report.directive.startsWith('script-src'),
      ),
    ).toBe(true)
  }).toPass({ timeout: 5_000 })
  // `toPass` est ici parce que le geste est réellement asynchrone : le
  // navigateur envoie son rapport après le chargement, hors de tout `await`.
})

test('une visite normale ne produit aucune violation', async ({ page }) => {
  // Le défaut typique de cette story : une politique qui passe les tests
  // d'en-têtes et casse l'écran. On traverse donc ce que l'application a de
  // plus injecteur de styles et de scripts — thème, menu déroulant, panneau
  // mobile, navigation — et la console doit rester muette.
  const violations: string[] = []

  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      const detail = `${event.effectiveDirective} ${event.blockedURI} ${event.sample}`

      ;(window as unknown as { __violations: string[] }).__violations ??= []
      ;(window as unknown as { __violations: string[] }).__violations.push(detail)
    })
  })

  const collect = async () => {
    violations.push(
      ...(await page.evaluate(
        () => (window as unknown as { __violations?: string[] }).__violations ?? [],
      )),
    )
  }

  await page.goto(publicPath(home))
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  // Le menu de thème est un composant client : qu'il s'ouvre est la preuve que
  // l'application est **hydratée** sous la politique. Une politique qui casse
  // l'hydratation n'est pas une politique stricte, c'est une page morte.
  await page.getByRole('button', { name: /th[eè]me/i }).click()
  await expect(page.getByRole('menuitem').first()).toBeVisible()
  await page.getByRole('menuitem').nth(1).click()
  await collect()

  await page.setViewportSize({ width: 380, height: 800 })
  await page.goto(publicPath(home))
  await page.getByRole('button', { name: /navigation/i }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await collect()

  await page.goto(publicPath('/sign-in'))
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await collect()

  expect([...new Set(violations)]).toEqual([])
})

test('tout `<style>` injecté par une bibliothèque porte le nonce de la requête', async ({
  page,
}) => {
  // **Ce cas mesure la cause, parce que le serveur de développement en cache la
  // sanction.** En `next dev`, `style-src` porte `'unsafe-inline'` : un `<style>`
  // injecté sans nonce y est appliqué sans le moindre bruit, et le cas « aucune
  // violation » reste vert — vérifié en retirant le câblage du nonce, cinq
  // parcours sur cinq restaient verts. En production le même élément est refusé,
  // et le fond de page cesse d'être verrouillé derrière le panneau ouvert.
  //
  // Deux bibliothèques injectent, et ce sont les deux que le parcours réveille :
  // `next-themes` (la feuille qui coupe les transitions au changement de thème)
  // et `react-remove-scroll` via Radix (le verrou de défilement d'un `Sheet` ou
  // d'un `DropdownMenu`).
  const nonceOfDocument = async (): Promise<string> =>
    (await page.evaluate(
      () =>
        [...document.querySelectorAll('script[nonce]')]
          .map((element) => (element as HTMLScriptElement).nonce)
          .find((value) => value !== '') ?? '',
    )) ?? ''

  await page.setViewportSize({ width: 380, height: 800 })
  await page.goto(publicPath(home))
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  await page.getByRole('button', { name: /th[eè]me/i }).click()
  await expect(page.getByRole('menuitem').first()).toBeVisible()
  await page.getByRole('menuitem').nth(1).click()

  await page.getByRole('button', { name: /navigation/i }).click()
  await expect(page.getByRole('dialog')).toBeVisible()

  const nonce = await nonceOfDocument()

  expect(nonce).not.toBe('')

  const styles = await page.evaluate(() =>
    [...document.querySelectorAll('style')]
      // La surcouche de développement de Next pose ses propres feuilles —
      // `@font-face` de sa police, styles de son panneau d'erreurs — et elle
      // n'existe pas en production : mesuré, le HTML de `next start` ne contient
      // aucun `<style>` (`docs/research/s45-security-headers.md` §2.1). Les
      // juger ici ferait rougir ce cas pour du code que le produit n'embarque
      // pas. Ce sont les seules exclusions, et elles se reconnaissent au
      // préfixe que Next donne à tout ce qui lui appartient.
      .filter(
        (element) =>
          !(element.textContent ?? '').includes('__nextjs') &&
          element.closest('nextjs-portal') === null,
      )
      .map((element) => ({
        nonce: element.nonce ?? '',
        text: (element.textContent ?? '').slice(0, 60),
      })),
  )

  // La garde contre le vide : sans élément injecté, tout ce qui suit serait vrai
  // sur zéro cas.
  expect(styles.length).toBeGreaterThan(0)
  for (const style of styles) {
    expect(style.nonce, style.text).toBe(nonce)
  }
})

/**
 * Les écrans dont le HTML est jugé, et le statut qu'ils doivent rendre.
 *
 * Une URL inexistante est dans la liste depuis la revue de s45, et c'est le
 * point : le composant 404 intégré de Next émettait **quatre attributs `style`
 * et un `<style>` sans nonce**, donc deux violations en production, sur une page
 * qu'un visiteur atteint. Le balayage de la recherche portait sur onze réponses,
 * toutes existantes ; la classe entière était ouverte. Un écran d'erreur qui
 * réintroduirait du style en ligne rougit désormais ici.
 *
 * **Trouvé jusqu'ici, sur ces deux formes de réponse** — une page servie et une
 * URL sans route. Le reste des écrans est mesuré par `tests/rendered-text.test.ts`
 * et par la vérification navigateur consignée dans la revue.
 */
const SERVED = [
  { path: publicPath(home), status: 200 },
  { path: publicPath('/cette-adresse-n-existe-pas'), status: 404 },
] as const

test('le HTML servi ne porte ni style en ligne ni script sans nonce', async ({ request }) => {
  // La contrepartie statique du cas précédent, et elle voit ce que la console de
  // développement ne peut pas voir : en `next dev`, `style-src` porte
  // `'unsafe-inline'`, donc un attribut `style` rendu par le serveur n'y
  // déclenche aucune violation — alors qu'il en déclencherait une en production.
  // Ce cas-ci mesure la **source**, pas la sanction.
  for (const served of SERVED) {
    const response = await request.get(served.path)

    // Le statut est dans le cas parce que sans lui, une 404 devenue 200 — ou
    // l'inverse — ferait juger une autre page que celle qu'on croit.
    expect(response.status(), served.path).toBe(served.status)

    const html = await response.text()

    expect(html.match(/\sstyle="[^"]*"/g) ?? [], served.path).toEqual([])

    // Un `<style>` sans nonce est la seconde moitié du défaut : `style-src-elem`
    // le refuse en production, et `style-src-attr` — qui ne connaît pas les
    // nonces — refuse la première.
    const styleTags = html.match(/<style[^>]*>/g) ?? []

    for (const tag of styleTags) {
      expect(tag, `${served.path} : ${tag}`).toMatch(/\snonce="/)
    }

    const inlineScripts = html.match(/<script(?![^>]*\ssrc=)[^>]*>/g) ?? []

    expect(inlineScripts.length, served.path).toBeGreaterThan(0)
    for (const tag of inlineScripts) {
      expect(tag, `${served.path} : ${tag}`).toMatch(/\snonce="/)
    }
  }
})

test('une URL inexistante porte le socle d’en-têtes et l’écran du design system', async ({
  page,
}) => {
  // L'autre moitié : ce que le visiteur voit. Le composant intégré rendait une
  // page dénudée, hors du shell, sans thème et sans navigation — et une console
  // bruyante est exactement ce qui pousse l'agent suivant à ajouter
  // `'unsafe-inline'`, le mode d'échec contre lequel l'ADR 012 met en garde.
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      ;(window as unknown as { __violations: string[] }).__violations ??= []
      ;(window as unknown as { __violations: string[] }).__violations.push(
        `${event.effectiveDirective} ${event.blockedURI}`,
      )
    })
  })

  const response = await page.goto(publicPath('/cette-adresse-n-existe-pas'))

  expect(response?.status()).toBe(404)
  expect(response?.headers()['content-security-policy']).toContain("default-src 'self'")

  // L'affordance qui sort de l'impasse, et **une seule** : le composant intégré
  // n'en offrait aucune dans le contenu de la page. C'est le contrat que le
  // design system pose sur `EmptyState` — « un état vide sans action est un
  // écran cassé ».
  const wayOut = page.getByRole('main').getByRole('link')

  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(wayOut).toHaveCount(1)
  await expect(wayOut).toHaveAttribute('href', publicPath('/'))

  expect(
    [
      ...new Set(
        await page.evaluate(
          () => (window as unknown as { __violations?: string[] }).__violations ?? [],
        ),
      ),
    ],
  ).toEqual([])
})
