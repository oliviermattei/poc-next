import { randomUUID } from 'node:crypto'

import { MODULE_ROUTE_PREFIX } from '@repo/core'
import { TWO_FACTOR_CHALLENGE_COOKIE_NAME } from '@repo/module-auth'
import { marketingRoutePath } from '@repo/module-marketing'
import { expect, test } from '@playwright/test'

import { BASE_URL } from '../playwright.config'
import { marketingSite } from '../apps/web/lib/marketing'
import { rateLimitPolicies } from '../config/security'
import { anEmail } from './support/account'
import { clickOnce } from './support/interaction'

/**
 * **La limitation de débit, contre l'application réellement démarrée** (s28).
 *
 * Ce que ce fichier prouve et qu'aucun test Vitest ne peut prouver : le
 * répartiteur monté par Next, le compteur dans le vrai PostgreSQL, les seuils
 * lus de `config/security.ts` au démarrage, et l'en-tête `Retry-After` tel que
 * le serveur l'écrit — la chaîne entière, sans un seul double.
 *
 * **Les tentatives portent des adresses d'appelant distinctes**, et c'est tout
 * l'enjeu : c'est le seau **par compte visé** qui doit refuser, pas celui de
 * l'appelant. Un parcours qui frapperait cent fois depuis la même adresse serait
 * vert contre un code qui ne protège pas du bourrage distribué — le piège que
 * le plan de la story nomme, et que la moitié des implémentations réelles rate.
 */

const SIGN_IN = `${MODULE_ROUTE_PREFIX}/auth/sign-in/email`

/**
 * **Un défi par cas, et non par milliseconde** (s52, même cause que la paire
 * OAuth : une identité partagée entre deux cas).
 *
 * Trois cas de ce fichier fabriquent un défi de second facteur, et le seau de
 * limitation est **clé sur sa valeur** : deux cas qui fabriquent le même défi
 * partagent un seau de quatre, et chacun compte alors les 429 de l'autre.
 * `defi-fabrique-${Date.now()}` distinguait donc les cas par leur milliseconde
 * de démarrage — ce que quatre travailleurs ne garantissent pas.
 *
 * **Mesuré le 05/09 sur cette branche**, écart entre les deux premiers défis
 * sur quinze passages à quatre travailleurs : 3, 2, 44, 1, 42, 12, 13, 12, 53,
 * 26, 31, 2, 52, **0**, 22 ms. Le passage à 0 ms est exactement celui qui a
 * rougi, et il a fait tomber les **deux** cas ensemble : `[429, 429]` pour l'un,
 * `[429, 429, 429, 429]` pour l'autre, là où un seul 429 est attendu. À un
 * travailleur, les mêmes écarts valent 456, 364, 348, 292 et 107 ms — la
 * collision y est hors d'atteinte, et c'est ce qui explique que ces cas passent
 * seuls et sous la recette socle.
 *
 * `randomUUID` supprime la ressource partagée, comme `anEmail` le fait déjà
 * pour les comptes visés de ce même fichier.
 */
const aChallenge = (): string => `defi-fabrique-${randomUUID()}`

const signInPolicy = rateLimitPolicies.signIn

/**
 * La configuration sert-elle des pages publiques — donc les formulaires qui vont
 * avec ? Dérivé de `marketingSite`, dont les listes sont vides quand le module
 * est coupé ; c'est le prédicat qu'utilise déjà `e2e/public-forms.spec.ts`.
 */
const servesPublicPages = marketingSite.sections.length > 0

test('la connexion est bloquée après N tentatives sur le même compte, depuis N adresses différentes', async ({
  request,
}) => {
  // Une adresse jamais vue : le seau du compte visé doit compter les adresses
  // inconnues comme les autres, sans quoi l'attaquant apprendrait lesquelles
  // existent (`docs/security.md` §3).
  const target = anEmail('s28-e2e')
  const attempt = async (index: number) =>
    await request.post(SIGN_IN, {
      // Une adresse d'appelant par tentative : chacune reste très loin sous le
      // seuil par appelant, qui est cinq fois plus haut.
      headers: { 'x-forwarded-for': `198.51.100.${index % 250}`, 'content-type': 'application/json' },
      data: { email: target, password: 'mot-de-passe-quelconque' },
      failOnStatusCode: false,
    })

  const statuses: number[] = []
  let refused: Awaited<ReturnType<typeof attempt>> | undefined

  for (let index = 0; index <= (signInPolicy.maxPerSubject ?? 0); index += 1) {
    const response = await attempt(index)

    statuses.push(response.status())

    if (response.status() === 429) {
      refused = response
    }
  }

  // Exactement une de trop : les précédentes passent (et échouent à
  // s'authentifier, ce qui n'est pas le sujet), la dernière est refusée.
  //
  // **L'échec montre les statuts qu'il a lus** (s52). Ce cas figure dans la
  // liste des intermittents et sa cause n'est pas établie : le seul rouge
  // observé sur cette branche rendait `[]` — aucun 429 du tout, pas un de trop
  // —, dans un passage où deux autres cas échouaient sur « element(s) not
  // found », donc contre un serveur qui ne servait pas encore. Le tableau
  // filtré cache ce qu'il a vu ; le message le rend, pour que la prochaine
  // rencontre ait la mesure au lieu d'une enquête.
  expect(statuses.filter((status) => status === 429), `statuts lus : ${statuses.join(', ')}`)
    .toHaveLength(1)
  expect(statuses.at(-1), `statuts lus : ${statuses.join(', ')}`).toBe(429)

  // `Retry-After` doit suivre la **fenêtre réelle**, pas être une constante :
  // une valeur figée ferait réessayer un client honnête trop tôt.
  const retryAfter = Number(refused?.headers()['retry-after'])

  expect(retryAfter).toBeGreaterThan(0)
  expect(retryAfter).toBeLessThanOrEqual(signInPolicy.windowSeconds)

  // Et le blocage ne déborde pas sur les autres comptes : depuis les **mêmes**
  // adresses, un autre compte visé passe encore. C'est ce qui distingue le seau
  // par compte d'une coupure générale.
  const other = await request.post(SIGN_IN, {
    headers: { 'x-forwarded-for': '198.51.100.1', 'content-type': 'application/json' },
    data: { email: anEmail('s28-e2e-autre'), password: 'mot-de-passe-quelconque' },
    failOnStatusCode: false,
  })

  expect(other.status()).not.toBe(429)
})


/**
 * **Le constat C1 de la revue, éprouvé par les deux routes HTTP à la suite.**
 *
 * Le balayage de `marketing` part à la **première** soumission de chaque fenêtre
 * de dix minutes, et la limitation s'exécute avant toute validation : un POST
 * **vide** suffit à le déclencher. Tant que `sweep` a voulu dire « efface tout ce
 * qui précède cet instant », ce POST remettait à zéro les seaux **horaires** des
 * autres routes — la réinitialisation de mot de passe, le magic link,
 * l'invitation, tous à cinq par heure.
 *
 * La revue a prouvé la faille au niveau du limiteur ; ce parcours-ci la prouve
 * fermée là où l'attaquant l'aurait exploitée : deux routes publiques, une
 * application démarrée, un vrai PostgreSQL.
 */
test('un formulaire public soumis à vide ne remet pas à zéro le seau horaire d’une autre route', async ({
  request,
}) => {
  const victim = anEmail('s28-c1')
  const resetPolicy = rateLimitPolicies.passwordReset
  const reset = async (index: number) =>
    await request.post(`${MODULE_ROUTE_PREFIX}/auth/request-password-reset`, {
      headers: { 'x-forwarded-for': `203.0.113.${index % 250}`, 'content-type': 'application/json' },
      data: { email: victim },
      failOnStatusCode: false,
    })

  // Le seuil par compte visé est consommé, depuis autant d'adresses que d'essais.
  for (let index = 0; index < (resetPolicy.maxPerSubject ?? 0); index += 1) {
    expect((await reset(index)).status()).not.toBe(429)
  }

  expect((await reset(99)).status()).toBe(429)

  // **Le geste de l'attaquant** : un POST vide sur un formulaire public, qui
  // déclenche le balayage du module `marketing`.
  const emptyPost = await request.post(marketingRoutePath('newsletter'), {
    headers: { 'content-type': 'application/json' },
    data: {},
    failOnStatusCode: false,
  })

  // Il est refusé pour son propre compte — corps invalide ou débit —, ce qui
  // n'a aucune importance : le balayage a déjà eu lieu quand la validation parle.
  //
  // **Dans une configuration qui ne sert aucune page publique, le geste n'existe
  // pas** : la route répond 404, et l'attendu est dérivé de la configuration
  // plutôt que recopié — même idiome que `e2e/public-forms.spec.ts`. C'est la
  // branche `socle` de la matrice de CI, et ce cas y échouait : personne n'avait
  // jamais joué `pnpm test:e2e` sous cette configuration hors du runner (s48).
  // Le cas reste **exécuté** dans les deux, et la propriété qui suit aussi.
  expect(servesPublicPages ? [200, 400, 429] : [404]).toContain(emptyPost.status())

  // Et la réinitialisation reste bloquée. C'est toute la propriété.
  expect((await reset(98)).status()).toBe(429)
})


/**
 * **Le contournement par leurre de cookie, joué contre l'application démarrée**
 * (constat C1 de la re-revue).
 *
 * L'en-tête `Cookie` est écrit intégralement par l'appelant. Tant que la lecture
 * se faisait par suffixe, un `two_factor=<compteur>` posé **en tête** suffisait :
 * le limiteur comptait le leurre qui tourne, la bibliothèque validait le vrai
 * cookie, et les six chiffres redevenaient énumérables sans borne. La mesure
 * d'alors : 401×20 sans un seul 429.
 *
 * Le défi est fabriqué — la bibliothèque le refusera en 401 — et c'est sans
 * importance : ce qui est mesuré ici est **qui compte**, pas qui valide. Le
 * refus doit arriver au seuil, leurre ou pas.
 */
test('la vérification 2FA reste bornée malgré un leurre de cookie posé en tête', async ({
  request,
}) => {
  const policy = rateLimitPolicies.twoFactor
  const challenge = aChallenge()
  const statuses: number[] = []

  for (let attempt = 0; attempt <= (policy.maxPerSubject ?? 0); attempt += 1) {
    const response = await request.post(`${MODULE_ROUTE_PREFIX}/auth/two-factor/verify-totp`, {
      headers: {
        'content-type': 'application/json',
        // Une adresse par essai : le seau d'appelant ne mord jamais, c'est
        // celui du défi qui doit mordre.
        'x-forwarded-for': `198.51.101.${attempt % 250}`,
        // **Le leurre d'abord**, valeur qui tourne à chaque essai.
        cookie: `two_factor=leurre-${attempt}; __Secure-better-auth.two_factor=${challenge}`,
      },
      data: { code: '123456' },
      failOnStatusCode: false,
    })

    statuses.push(response.status())
  }

  expect(statuses.filter((status) => status === 429)).toHaveLength(1)
  expect(statuses.at(-1)).toBe(429)
})

/**
 * **Le même défi, ré-encodé, contre l'application démarrée** (constat M1 de la
 * troisième revue).
 *
 * Le nom lu était le bon ; la valeur ne l'était pas. Le serveur lit
 * `parsedCookies.get(nom)`, qui retire les guillemets encadrants puis décode
 * dès qu'il y a un `%` (`better-call@1.4.0/dist/cookies.mjs:19-40`) ; le
 * limiteur prenait la sous-chaîne brute. L'appelant écrivant l'en-tête `Cookie`
 * en entier, il scindait son propre seau à volonté. La mesure d'alors : quinze
 * encodages d'un même défi → 401×15, la même valeur brute → 401×10 puis 429×5.
 *
 * Comme le cas ci-dessus, il mesure **qui compte**, pas qui valide : le défi est
 * fabriqué et la bibliothèque le refuse en 401.
 */
test('la vérification 2FA compte le même défi ré-encodé dans le même seau', async ({
  request,
}) => {
  const policy = rateLimitPolicies.twoFactor
  const challenge = aChallenge()
  /** Le même défi, avec un caractère de plus écrit en `%XX` à chaque essai. */
  const encodedAt = (index: number): string =>
    [...challenge]
      .map((character, position) =>
        position <= index ? `%${character.charCodeAt(0).toString(16).toUpperCase()}` : character,
      )
      .join('')
  const statuses: number[] = []

  expect(challenge.length).toBeGreaterThan(policy.maxPerSubject ?? 0)

  for (let attempt = 0; attempt <= (policy.maxPerSubject ?? 0); attempt += 1) {
    const response = await request.post(`${MODULE_ROUTE_PREFIX}/auth/two-factor/verify-totp`, {
      headers: {
        'content-type': 'application/json',
        // Une adresse par essai **et** un encodage par essai : seule la valeur
        // que le serveur lira se répète, et c'est elle qui doit refuser.
        'x-forwarded-for': `198.51.102.${attempt % 250}`,
        cookie: `__Secure-better-auth.two_factor=${encodedAt(attempt)}`,
      },
      data: { code: '123456' },
      failOnStatusCode: false,
    })

    statuses.push(response.status())
  }

  expect(statuses.filter((status) => status === 429)).toHaveLength(1)
  expect(statuses.at(-1)).toBe(429)
})

/**
 * **Ce que l'utilisateur lit quand il est refusé** (constat M1 de la troisième
 * revue), dans un navigateur, sur l'écran réel.
 *
 * Le répartiteur refuse **avant** le gestionnaire : ni `twoFactorRefusal` ni
 * aucune route n'est appelée, et le corps du refus est `{"error":"rate_limited"}`.
 * Les deux formulaires d'authentification le repliaient sur leur message de
 * saisie fautive — « Ce code n'est pas valide. » et « Demande invalide. Vérifiez
 * les informations saisies. ». Quelqu'un dont la saisie est **correcte** lisait
 * qu'elle ne l'est pas, et se voyait implicitement invité à recommencer,
 * c'est-à-dire à faire exactement ce que la limitation demande de ne pas faire.
 *
 * `tests/rate-limiting.test.ts` tient la **classification** ; ces deux cas-ci
 * tiennent ce qui est **rendu** — l'alerte telle qu'elle est lue, avec le délai
 * que le serveur a écrit dans `Retry-After`. Aucun test de nœud ne peut le voir :
 * le message n'existe qu'après une soumission, donc après hydratation.
 *
 * Les seaux sont remplis par l'API, avec une adresse d'appelant par essai : le
 * navigateur ne fait que la tentative **de trop**, celle qui est refusée.
 */

test('l’écran de second facteur annonce l’attente, il n’accuse pas le code', async ({
  page,
  request,
}) => {
  const policy = rateLimitPolicies.twoFactor
  // Le défi est fabriqué : la bibliothèque le refuse en 401 sans jamais le
  // compter, et c'est sans importance ici — ce qui est mesuré est ce que
  // l'**écran** affiche du refus de débit, pas qui valide le code.
  const challenge = aChallenge()
  // Sans HTTPS ni production, `secureCookiePrefix` est vide : c'est ce nom-là
  // que le serveur lit, et le seul que le navigateur accepte de poser sur
  // `http://localhost`.
  const cookie = `better-auth.${TWO_FACTOR_CHALLENGE_COOKIE_NAME}`

  for (let attempt = 0; attempt < (policy.maxPerSubject ?? 0); attempt += 1) {
    const response = await request.post(`${MODULE_ROUTE_PREFIX}/auth/two-factor/verify-totp`, {
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': `198.51.104.${attempt % 250}`,
        cookie: `${cookie}=${challenge}`,
      },
      data: { code: '123456' },
      failOnStatusCode: false,
    })

    // Le seau doit être **plein sans avoir débordé** : un 429 ici voudrait dire
    // que le cas mesure autre chose que la tentative de trop.
    expect(response.status()).toBe(401)
  }

  await page.context().addCookies([{ name: cookie, value: challenge, url: BASE_URL }])
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': '198.51.104.251' })
  await page.goto('/two-factor')
  await page.getByLabel('Code à six chiffres').fill('123456')

  await clickOnce(page, page.getByRole('button', { name: 'Vérifier' }), async () => {
    await expect(page.getByText(/Trop de tentatives\..+ dans \d+ minutes?\./)).toBeVisible()
  })

  // Le message que la story avait rendu atteignable, et qui est le défaut :
  // dire « ce code est faux » à qui a saisi le bon.
  await expect(page.getByText('n’est pas valide')).toHaveCount(0)
})

test('l’écran de mot de passe oublié annonce l’attente, il n’accuse pas la saisie', async ({
  page,
  request,
}) => {
  const policy = rateLimitPolicies.passwordReset
  const victim = anEmail('s28-lecture')

  for (let attempt = 0; attempt < (policy.maxPerSubject ?? 0); attempt += 1) {
    const response = await request.post(`${MODULE_ROUTE_PREFIX}/auth/request-password-reset`, {
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': `198.51.107.${attempt % 250}`,
      },
      data: { email: victim },
      failOnStatusCode: false,
    })

    expect(response.status()).not.toBe(429)
  }

  await page.setExtraHTTPHeaders({ 'x-forwarded-for': '198.51.107.251' })
  await page.goto('/forgot-password')
  await page.getByLabel('Adresse email').fill(victim)

  await clickOnce(page, page.getByRole('button', { name: 'Recevoir un lien' }), async () => {
    await expect(page.getByText(/Trop de tentatives\..+ dans \d+ minutes?\./)).toBeVisible()
  })

  await expect(page.getByText('Demande invalide')).toHaveCount(0)
})
