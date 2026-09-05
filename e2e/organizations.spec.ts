import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

import { flatMessagesFor } from '../apps/web/lib/messages'
import { organizations } from '../apps/web/lib/organizations'
import { defaultLocale } from '../config/i18n'
import { aSignedInAccount, linkSentTo, signIn, signUp } from './support/account'
import { publicPath, urlOf } from './support/locale'

/**
 * Les organisations, dans un vrai navigateur.
 *
 * Ce que ce fichier prouve et qu'aucun test de nœud ne peut prouver : la
 * soumission **native** des formulaires — aucun JavaScript de notre part —, la
 * redirection 303 suivie par le navigateur, le sélecteur d'organisation
 * réellement ouvert, et surtout la **persistance de l'organisation courante
 * entre deux sessions** : un contexte de navigation neuf, une reconnexion, elle
 * est toujours là.
 *
 * **Il doit passer dans les deux états de configuration.** Ses attentes sont
 * donc dérivées de `organizations.available`, jamais recopiées — la même
 * discipline que `e2e/marketing.spec.ts` avec `marketingSite`.
 *
 * Les deux formulaires de l'écran portent les mêmes libellés de champ (« Nom »,
 * « Identifiant ») : ils sont donc désignés par le **nom accessible de leur
 * formulaire**, pas par un index. Deux formulaires anonymes sur un même écran
 * seraient indiscernables pour une aide technique comme pour ce parcours.
 */

const catalogue = flatMessagesFor(defaultLocale)
const mounted = organizations.available

/** Le texte attendu à l'écran, lu dans le catalogue de la langue servie. */
const text = (key: string): string => {
  const value = catalogue[key]

  if (value === undefined) {
    throw new Error(`Le catalogue « ${defaultLocale} » ne livre pas « ${key} ».`)
  }

  return value
}

const aSlug = (): string => `e2e-${randomUUID().slice(0, 8)}`

/** Le formulaire de création, désigné par son nom accessible. */
const createForm = (page: Page) =>
  page.getByRole('form', { name: text('organizations.create.title') })

/** Le formulaire de paramètres, désigné par le sien. */
const settingsForm = (page: Page) =>
  page.getByRole('form', { name: text('organizations.settings.title') })

const submitCreation = async (page: Page, name: string, slug: string): Promise<void> => {
  const form = createForm(page)

  await form.getByLabel(text('organizations.create.nameLabel')).fill(name)
  await form.getByLabel(text('organizations.create.slugLabel')).fill(slug)
  await form.getByRole('button', { name: text('organizations.create.submit') }).click()
}

test('module coupé, l’écran des organisations n’existe pas', async ({ page }) => {
  test.skip(mounted, 'Le module est activé dans cette configuration.')

  await aSignedInAccount(page, 's15-off')

  const response = await page.goto(publicPath('/organizations'))

  expect(response?.status()).toBe(404)
})

test('crée une organisation, la renomme, et la retrouve à la session suivante', async ({
  page,
  browser,
}) => {
  test.skip(!mounted, 'Le module est coupé dans cette configuration.')

  const email = await aSignedInAccount(page, 's15')

  await page.goto(publicPath('/organizations'))

  // L'état vide dit ce qu'il faut faire : un tableau vide sans action est un
  // écran cassé (`docs/design-system.md`).
  await expect(page.getByText(text('organizations.empty.title'))).toBeVisible()

  await submitCreation(page, 'Studio Martin', aSlug())

  await expect(page).toHaveURL(urlOf('/organizations'))
  // Le déclencheur du sélecteur porte le nom de l'organisation courante.
  await expect(page.getByRole('button', { name: 'Studio Martin' })).toBeVisible()
  // Le créateur en est **propriétaire** (critère 4), et le rôle est traduit.
  // `first()` depuis s16 : le rôle est désormais affiché deux fois sur cet
  // écran — à côté du sélecteur, et sur la ligne du membre dans la carte
  // « Membres ». Les deux sont légitimes, et la carte courante vient d'abord.
  await expect(
    page.getByText(text('organizations.role.owner'), { exact: true }).first(),
  ).toBeVisible()

  // Le renommage passe par le formulaire de paramètres (critère 5).
  await settingsForm(page).getByLabel(text('organizations.settings.nameLabel')).fill('Atelier Nord')
  await settingsForm(page)
    .getByRole('button', { name: text('organizations.settings.submit') })
    .click()

  await expect(page.getByRole('button', { name: 'Atelier Nord' })).toBeVisible()

  // Un identifiant réservé est refusé, et le message ne dit pas **pourquoi** :
  // le même que pour un identifiant déjà pris (`docs/security.md` §7).
  await submitCreation(page, 'Compte', 'account')

  await expect(page.getByRole('alert')).toHaveText(text('organizations.error.slug_unavailable'))

  // **Le critère 2** : l'organisation courante survit à la session. Un contexte
  // neuf n'a ni cookie ni stockage — c'est bien une seconde session.
  const second = await browser.newContext({ locale: 'fr-FR' })
  const reopened = await second.newPage()

  await reopened.goto(publicPath('/sign-in'))
  await signIn(reopened, email)
  // La connexion navigue : attendre son atterrissage avant de demander l'écran
  // suivant, sans quoi la seconde navigation annule la première.
  await expect(reopened).toHaveURL(urlOf('/'))
  await reopened.goto(publicPath('/organizations'))

  await expect(reopened.getByRole('button', { name: 'Atelier Nord' })).toBeVisible()

  await second.close()
})

test('bascule d’organisation, et refuse celle d’un autre compte', async ({ page, browser }) => {
  test.skip(!mounted, 'Le module est coupé dans cette configuration.')

  await aSignedInAccount(page, 's15-switch')
  await page.goto(publicPath('/organizations'))

  for (const name of ['Première', 'Seconde']) {
    await submitCreation(page, name, aSlug())
    await expect(page).toHaveURL(urlOf('/organizations'))
  }

  // La bascule est une **soumission**, pas un lien : basculer change un état
  // serveur. Le menu se désigne par son nom accessible, ses options par le leur.
  const option = page.getByRole('menuitem', { name: 'Première' })

  // **Ouvrir le menu demande que React ait pris la main** : un clic qui devance
  // l'hydratation ne fait rien, et le reste de l'écran, lui, fonctionne sans
  // JavaScript. Le geste est idempotent — ouvrir un menu déjà ouvert ne change
  // rien —, donc il est rejouable, et c'est la seule raison pour laquelle
  // `toPass` est employé ici (`playwright.config.ts`, `retries: 0`).
  await expect(async () => {
    await page.getByRole('button', { name: 'Seconde' }).click()
    await expect(option).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 15_000 })

  await option.click()

  await expect(page).toHaveURL(urlOf('/organizations'))
  await expect(page.getByRole('button', { name: 'Première' })).toBeVisible()

  // L'identifiant de l'organisation courante, tel que l'écran le pose dans son
  // formulaire de paramètres : c'est lui qu'un autre compte va tenter.
  const organizationId = await settingsForm(page)
    .locator('input[name="organizationId"]')
    .inputValue()

  const other = await browser.newContext({ locale: 'fr-FR' })
  const stranger = await other.newPage()
  const strangerEmail = `s15-stranger-${randomUUID()}@example.test`

  await signUp(stranger, strangerEmail)
  await stranger.goto(await linkSentTo(strangerEmail))
  await signIn(stranger, strangerEmail)
  // La connexion doit avoir atterri : sans session, le répartiteur répondrait
  // 401, et le cas ne prouverait plus rien du périmètre organisationnel.
  await expect(stranger).toHaveURL(urlOf('/'))

  // **404, jamais 403** : un 403 confirmerait que cette organisation existe.
  const refused = await stranger.request.post('/api/modules/organizations/switch', {
    form: { organizationId },
    maxRedirects: 0,
  })

  expect(refused.status()).toBe(404)

  await other.close()
})

/**
 * **Le parcours d'invitation, de bout en bout** (s16).
 *
 * Ce que ce parcours prouve et qu'aucun test de nœud ne peut prouver : l'email
 * part réellement par le port `Mailer` — il est lu **sur le disque**, dans la
 * capture locale —, le lien qu'il contient s'ouvre dans un navigateur **sans
 * consommer le jeton**, et l'acceptation est une soumission native suivie d'une
 * redirection 303 que le navigateur suit.
 *
 * Il enchaîne ensuite les deux gestes qui achèvent la story : le membre apparaît
 * dans la liste, puis il est retiré et **perd immédiatement l'organisation**,
 * sans reconnexion — c'est ce qui remplace la rotation d'identifiant de session
 * (ADR 026).
 */
test('invite quelqu’un, il accepte, puis il est retiré', async ({ page, browser }) => {
  test.skip(!mounted, 'Le module est coupé dans cette configuration.')

  await aSignedInAccount(page, 's16-founder')
  await page.goto(publicPath('/organizations'))
  await submitCreation(page, 'Studio Invité', aSlug())
  await expect(page).toHaveURL(urlOf('/organizations'))

  // L'invité a **déjà** un compte : c'est la moitié « utilisateur existant » du
  // critère 2. L'autre moitié — l'inscription enchaînée — est couverte par le
  // parcours anonyme plus bas.
  const guestContext = await browser.newContext({ locale: 'fr-FR' })
  const guest = await guestContext.newPage()
  const guestEmail = await aSignedInAccount(guest, 's16-guest')

  const sentAfter = Date.now()

  await page
    .getByRole('form', { name: text('organizations.invitations.title') })
    .getByLabel(text('organizations.invitations.emailLabel'))
    .fill(guestEmail)
  await page
    .getByRole('form', { name: text('organizations.invitations.title') })
    .getByRole('button', { name: text('organizations.invitations.submit') })
    .click()

  // L'invitation apparaît dans la liste en attente (critère 1).
  await expect(page).toHaveURL(urlOf('/organizations'))
  await expect(page.getByText(guestEmail, { exact: true })).toBeVisible()
  await expect(
    page.getByText(text('organizations.invitations.status.pending')),
  ).toBeVisible()

  // L'email est lu **dans la capture locale** : c'est le vrai port, et le lien
  // est celui que l'invité recevrait.
  const invitationLink = await linkSentTo(guestEmail, { since: sentAfter })

  // **Ouvrir le lien ne le consomme pas** : deux `GET` d'affilée, puis
  // l'acceptation fonctionne encore.
  await guest.goto(invitationLink)
  await guest.goto(invitationLink)
  await guest.getByRole('button', { name: text('organizations.accept.submit') }).click()

  await expect(guest).toHaveURL(urlOf('/organizations'))
  await expect(guest.getByRole('button', { name: 'Studio Invité' })).toBeVisible()

  // Le même lien, rejoué : refus explicite, et aucune seconde appartenance.
  await guest.goto(invitationLink)
  // Désigné par son **texte** : sur un chargement complet, Next pose son propre
  // `role="alert"` (l'annonceur de route), et un sélecteur par rôle en trouve
  // deux.
  await expect(
    guest.getByText(text('organizations.error.invitation_accepted')),
  ).toBeVisible()
  await expect(
    guest.getByRole('button', { name: text('organizations.accept.submit') }),
  ).toBeHidden()

  // Côté fondateur, le membre est là et l'invitation a quitté la liste.
  await page.reload()
  await expect(page.getByText(guestEmail, { exact: true })).toBeVisible()
  await expect(
    page.getByText(text('organizations.invitations.emptyTitle')),
  ).toBeVisible()

  // Le retrait, et la perte d'accès **immédiate** pour la même session.
  await page.getByRole('button', { name: `Retirer ${guestEmail}` }).click()
  await expect(page).toHaveURL(urlOf('/organizations'))
  await expect(page.getByText(guestEmail, { exact: true })).toBeHidden()

  await guest.goto(publicPath('/organizations'))
  await expect(guest.getByRole('button', { name: 'Studio Invité' })).toBeHidden()
  await expect(guest.getByText(text('organizations.empty.title'))).toBeVisible()

  await guestContext.close()
})

/**
 * **Les rôles, dans un vrai navigateur** (s17).
 *
 * Ce que ce parcours prouve et qu'aucun test de nœud ne peut prouver : la
 * promotion est une soumission **native** suivie d'une redirection 303 que le
 * navigateur suit, l'écran de l'intéressé change **sans reconnexion**, et
 * surtout — c'est le point de la story — **masquer un déclencheur n'est pas une
 * permission** : le même compte, une fois rétrogradé, poste directement sur la
 * route d'invitation et reçoit un 403.
 */
test('promeut un membre, puis le rétrograde : l’écran et la route suivent', async ({
  page,
  browser,
}) => {
  test.skip(!mounted, 'Le module est coupé dans cette configuration.')

  await aSignedInAccount(page, 's17-owner')
  await page.goto(publicPath('/organizations'))
  await submitCreation(page, 'Studio Rôles', aSlug())
  await expect(page).toHaveURL(urlOf('/organizations'))

  const memberContext = await browser.newContext({ locale: 'fr-FR' })
  const member = await memberContext.newPage()
  const memberEmail = await aSignedInAccount(member, 's17-membre')

  const sentAfter = Date.now()

  await page
    .getByRole('form', { name: text('organizations.invitations.title') })
    .getByLabel(text('organizations.invitations.emailLabel'))
    .fill(memberEmail)
  await page
    .getByRole('form', { name: text('organizations.invitations.title') })
    .getByRole('button', { name: text('organizations.invitations.submit') })
    .click()
  await expect(page).toHaveURL(urlOf('/organizations'))

  await member.goto(await linkSentTo(memberEmail, { since: sentAfter }))
  await member.getByRole('button', { name: text('organizations.accept.submit') }).click()
  await expect(member).toHaveURL(urlOf('/organizations'))

  // **Un simple membre ne voit ni la carte d'invitation, ni les paramètres.**
  await expect(
    member.getByRole('form', { name: text('organizations.invitations.title') }),
  ).toBeHidden()
  await expect(
    member.getByRole('form', { name: text('organizations.settings.title') }),
  ).toBeHidden()
  // La carte des membres, elle, reste : savoir avec qui l'on partage ses
  // données n'est pas un privilège.
  await expect(member.getByText(text('organizations.members.title'))).toBeVisible()

  // Le propriétaire le promeut, par un bouton de ligne nommant sa cible.
  await page.reload()
  await page
    .getByRole('button', { name: `Nommer ${memberEmail} administrateur` })
    .click()
  await expect(page).toHaveURL(urlOf('/organizations'))

  // **Sans reconnexion** : le même contexte, le même cookie, un simple
  // rechargement — et la carte d'invitation est là.
  await member.reload()
  await expect(
    member.getByRole('form', { name: text('organizations.invitations.title') }),
  ).toBeVisible()

  // L'identifiant de l'organisation, tel que l'écran le pose dans son
  // formulaire d'invitation : c'est lui que l'appel direct fournira.
  const organizationId = await member
    .getByRole('form', { name: text('organizations.invitations.title') })
    .locator('input[name="organizationId"]')
    .inputValue()

  // Rétrogradé, toujours sans reconnexion.
  await page.getByRole('button', { name: `Ramener ${memberEmail} au rang de membre` }).click()
  await expect(page).toHaveURL(urlOf('/organizations'))

  await member.reload()
  await expect(
    member.getByRole('form', { name: text('organizations.invitations.title') }),
  ).toBeHidden()

  // **Le déclencheur est masqué ; la route, elle, refuse.** 403 et non 404 : ce
  // compte est membre de cette organisation, il en connaît l'existence.
  const refused = await member.request.post('/api/modules/organizations/invite', {
    form: { organizationId, email: `s17-direct-${randomUUID()}@example.test` },
    maxRedirects: 0,
  })

  expect(refused.status()).toBe(403)

  await memberContext.close()
})

/**
 * **À 390 px, on doit lire quelle invitation on révoque** (revue de s16, F5).
 *
 * La mesure de la première livraison — débordement horizontal nul — était
 * exacte, et elle reste vraie ; elle ne mesurait simplement pas la lisibilité.
 * La ligne rendait l'adresse tronquée à **un ou deux caractères** (« c. »,
 * « u. ») à côté d'un bouton « Révoquer » : deux invitations devenaient
 * indiscernables, alors que la ligne porte une action destructive.
 *
 * Ce que ce parcours mesure, et qu'aucun test de nœud ne peut mesurer : la
 * **largeur réellement rendue** du libellé, dans un moteur, à la largeur où la
 * carte se comprime. Une assertion sur une classe utilitaire (`basis-full`)
 * prouverait qu'on a écrit la classe, jamais qu'on lit l'adresse.
 */
test('à 390 px, l’adresse invitée reste lisible à côté de ses actions', async ({ page }) => {
  test.skip(!mounted, 'Le module est coupé dans cette configuration.')

  await page.setViewportSize({ width: 390, height: 844 })
  await aSignedInAccount(page, 's16-etroit')
  await page.goto(publicPath('/organizations'))
  await submitCreation(page, 'Studio Étroit', aSlug())

  // Deux invitations : une adresse longue, et une courte qui doit tenir en
  // entier. Deux lignes, parce que c'est le cas où les confondre coûte cher.
  const long = `s16-adresse-tres-longue-${randomUUID()}@example.test`
  const short = `s16-${randomUUID().slice(0, 4)}@ex.test`

  for (const email of [long, short]) {
    await page
      .getByRole('form', { name: text('organizations.invitations.title') })
      .getByLabel(text('organizations.invitations.emailLabel'))
      .fill(email)
    await page
      .getByRole('form', { name: text('organizations.invitations.title') })
      .getByRole('button', { name: text('organizations.invitations.submit') })
      .click()
    await expect(page).toHaveURL(urlOf('/organizations'))
  }

  const longLabel = page.getByText(long, { exact: true })

  await expect(longLabel).toBeVisible()

  // **La largeur visible du libellé**, en pixels rendus. Avant la correction :
  // une dizaine de pixels, soit un caractère et un point de troncature.
  const longBox = await longLabel.boundingBox()

  expect(longBox?.width ?? 0).toBeGreaterThanOrEqual(200)

  // L'adresse courte, elle, est lue **en entier** : rien ne la tronque.
  const shortLabel = page.getByText(short, { exact: true })
  const truncated = await shortLabel.evaluate(
    (element) => element.scrollWidth > element.clientWidth + 1,
  )

  expect(truncated).toBe(false)

  // Et la propriété déjà acquise ne se perd pas : aucun débordement horizontal.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )

  expect(overflow).toBeLessThanOrEqual(0)
})

/**
 * **Le lien ouvert par quelqu'un qui n'a pas encore de compte** (critère 2).
 *
 * L'écran ne consomme rien : il montre l'organisation et propose les deux
 * chemins. La connexion emporte le retour vers cette même URL, jeton compris.
 */
test('un lien d’invitation ouvert sans session propose de se connecter', async ({
  page,
  browser,
}) => {
  test.skip(!mounted, 'Le module est coupé dans cette configuration.')

  await aSignedInAccount(page, 's16-anon-founder')
  await page.goto(publicPath('/organizations'))
  await submitCreation(page, 'Studio Anonyme', aSlug())

  const invited = `s16-nouveau-${randomUUID()}@example.test`
  const sentAfter = Date.now()

  await page
    .getByRole('form', { name: text('organizations.invitations.title') })
    .getByLabel(text('organizations.invitations.emailLabel'))
    .fill(invited)
  await page
    .getByRole('form', { name: text('organizations.invitations.title') })
    .getByRole('button', { name: text('organizations.invitations.submit') })
    .click()
  await expect(page).toHaveURL(urlOf('/organizations'))

  const invitationLink = await linkSentTo(invited, { since: sentAfter })

  const anonymous = await browser.newContext({ locale: 'fr-FR' })
  const visitor = await anonymous.newPage()

  await visitor.goto(invitationLink)

  // Le nom de l'organisation est là, l'acceptation ne l'est pas.
  await expect(visitor.getByText('Studio Anonyme')).toBeVisible()
  await expect(
    visitor.getByRole('button', { name: text('organizations.accept.submit') }),
  ).toBeHidden()
  await expect(
    visitor.getByRole('link', { name: text('organizations.accept.signIn') }),
  ).toBeVisible()
  await expect(
    visitor.getByRole('link', { name: text('organizations.accept.signUp') }),
  ).toBeVisible()

  await anonymous.close()
})

/**
 * **La bascule sans JavaScript** (arbitrage 3 de la revue de s15).
 *
 * Le menu du sélecteur est portalisé : Radix ne monte son contenu qu'à
 * l'ouverture, et l'ouverture est un état React. Sans script, le déclencheur
 * est donc un bouton qui ne fait rien, et la revue relevait qu'un visiteur sans
 * JavaScript voyait ses organisations sans pouvoir en changer.
 *
 * Le repli tient dans le formulaire qui existait déjà : les mêmes options, en
 * boutons de soumission natifs, dans un `<noscript>`. Aucun composant nouveau,
 * aucun jeton nouveau — et le navigateur les masque dès que le script tourne.
 *
 * Ce parcours est le seul endroit du dépôt qui puisse le prouver : `pnpm test`
 * rend le balisage mais n'a pas de moteur qui décide d'afficher un `<noscript>`.
 */
test('bascule d’organisation sans JavaScript', async ({ page, browser }) => {
  test.skip(!mounted, 'Le module est coupé dans cette configuration.')

  await aSignedInAccount(page, 's15-nojs')
  await page.goto(publicPath('/organizations'))

  for (const name of ['Alpha', 'Bêta']) {
    await submitCreation(page, name, aSlug())
    await expect(page).toHaveURL(urlOf('/organizations'))
  }

  // La session est reprise telle quelle ; seul le script est coupé.
  const withoutScript = await browser.newContext({
    locale: 'fr-FR',
    javaScriptEnabled: false,
    storageState: await page.context().storageState(),
  })
  const silent = await withoutScript.newPage()

  await silent.goto(publicPath('/organizations'))

  // Le déclencheur porte l'organisation courante, et il ne s'ouvrira pas.
  await expect(silent.getByRole('button', { name: 'Bêta' })).toBeVisible()

  // L'option, elle, est un bouton de soumission du formulaire — pas un élément
  // de menu : sans script, il n'y a pas de menu.
  await silent.getByRole('button', { name: 'Alpha' }).click()

  await expect(silent).toHaveURL(urlOf('/organizations'))
  await expect(silent.getByRole('button', { name: 'Alpha' })).toBeVisible()

  await withoutScript.close()
})

/**
 * **Le motif de plafond, rendu à l'écran d'acceptation** (s47).
 *
 * Ce cas existe parce qu'aucun test de nœud ne peut le tenir. `ACCEPT_REFUSALS`
 * est un **sous-ensemble écrit** d'`INVITATION_REFUSALS`, et c'est la liste
 * contre laquelle le paramètre `?error=` de cet écran est validé : un motif
 * absent de cette liste-là serait **muet à l'écran** sans qu'un seul cas
 * unitaire rougisse, puisqu'ils valident tous *contre cette même liste*.
 * Seul un navigateur voit la différence entre « le code existe » et « le
 * visiteur lit quelque chose ».
 *
 * L'invitation est **vivante** : c'est la situation exacte que s23 décrivait à
 * propos de `seat_sync_unavailable` — dire « lien invalide » à quelqu'un dont
 * l'invitation est parfaitement valide l'enverrait en demander une nouvelle,
 * indéfiniment.
 */
test('affiche le refus de plafond sur une invitation vivante', async ({ page, browser }) => {
  test.skip(!mounted, 'Le module est coupé dans cette configuration.')

  await aSignedInAccount(page, 's47-founder')
  await page.goto(publicPath('/organizations'))
  await submitCreation(page, 'Studio Plafonné', aSlug())
  await expect(page).toHaveURL(urlOf('/organizations'))

  const guestContext = await browser.newContext({ locale: 'fr-FR' })
  const guest = await guestContext.newPage()
  const guestEmail = await aSignedInAccount(guest, 's47-guest')
  const sentAfter = Date.now()

  await page
    .getByRole('form', { name: text('organizations.invitations.title') })
    .getByLabel(text('organizations.invitations.emailLabel'))
    .fill(guestEmail)
  await page
    .getByRole('form', { name: text('organizations.invitations.title') })
    .getByRole('button', { name: text('organizations.invitations.submit') })
    .click()
  await expect(page).toHaveURL(urlOf('/organizations'))

  const invitationLink = await linkSentTo(guestEmail, { since: sentAfter })

  // La destination **exacte** que la route d'acceptation compose sur un refus :
  // le jeton reposé, et le motif. Rien d'autre n'est simulé.
  await guest.goto(`${invitationLink}&error=seat_limit_reached`)

  /**
   * **Le texte de l'invité, pas celui du membre** (s47, décision 3) : qui lit
   * cet écran n'appartient pas à l'organisation, et le message ne nomme ni son
   * offre ni son nombre de places. L'assertion négative qui le prouve vit dans
   * `tests/organizations.test.ts`, ancrée sur ce que le message contient ; ici,
   * ce qui est mesuré est que **c'est bien celui-là** qui s'affiche.
   */
  await expect(guest.getByText(text('organizations.accept.seatLimit'))).toBeVisible()
  await expect(guest.getByText(text('organizations.error.seat_limit_reached'))).toBeHidden()

  await guestContext.close()
})
