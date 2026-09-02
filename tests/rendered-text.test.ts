import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { NextIntlClientProvider } from 'next-intl'
import { createElement, isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { defaultLocale } from '../config/i18n'

/* ------------------------------------------------------------------------- *
 * Le critère 3, tenu par le rendu et non par la forme de la source.
 *
 * Les deux revues de s09 ont mesuré la limite d'un balayage syntaxique : élargi
 * deux fois, il laissait encore passer `const BADGE = 'Beta'` rendu par
 * `<p>{BADGE}</p>`, et un libellé rangé dans un littéral d'objet
 * (`options={{ light: 'Light' }}`) — l'idiome même du dépôt. Une maille de plus
 * n'était pas la réponse : la question « cette chaîne s'affiche-t-elle ? » ne se
 * pose pas sur une ligne de texte.
 *
 * Le levier est donc inversé. Les écrans sont **rendus** avec un catalogue
 * pseudo-locale dont chaque valeur est un marqueur dérivé de sa clé, et ce test
 * refuse tout ce qui, dans le rendu, n'est pas un marqueur. La forme de la
 * source disparaît de la question : variable, objet, concaténation, fonction
 * d'aide, fichier `.ts` ou `dangerouslySetInnerHTML` produisent tous une chaîne
 * qui n'est pas un marqueur.
 *
 * Ce qui est remplacé ici est la **base de données et le contexte de requête**
 * (`lib/auth`, `lib/i18n`), jamais une règle : les écrans, les composants du
 * design system, la navigation dérivée du registre et le traducteur de
 * `next-intl` sont les vrais.
 *
 * Deux observations, parce qu'un rendu statique ne voit pas tout :
 *
 * 1. **le balisage produit** — nœuds de texte et attributs lus par quelqu'un ;
 * 2. **les chaînes confiées aux composants** — l'arbre d'éléments avant
 *    expansion. C'est ce qui attrape le texte remis à un composant du design
 *    system dans une surface flottante (menu déroulant, panneau), que React ne
 *    monte pas tant qu'elle est fermée.
 *
 * Ce que ce filet ne voit pas, et qui est tenu ailleurs : un texte écrit en dur
 * **à l'intérieur** d'une surface flottante d'un composant de `packages/ui`
 * (fermée, donc non rendue, et ses chaînes ne transitent par aucune prop) — le
 * balayage syntaxique de `tests/i18n.test.ts` le voit, et c'est ainsi que le
 * « Fermer » de `sheet.tsx` a été trouvé. Les deux moitiés ne se remplacent pas.
 * ------------------------------------------------------------------------- */

vi.mock('../apps/web/lib/auth', async () => {
  const { authRoutePath, readOAuthFailureClass, safeRedirectPath } = await import(
    '@repo/module-auth'
  )
  const { FIXTURE_PASSKEYS, FIXTURE_SESSIONS, FIXTURE_SIGN_IN_METHODS, viewerState } = await import(
    './fixtures/screen-viewer'
  )

  return {
    authRoutePath,
    readOAuthFailureClass,
    safeRedirectPath,
    currentViewer: () => Promise.resolve(viewerState.value),
    currentSessions: () =>
      Promise.resolve(viewerState.value.session === null ? [] : FIXTURE_SESSIONS),
    currentSignInMethods: () =>
      Promise.resolve(viewerState.value.session === null ? [] : FIXTURE_SIGN_IN_METHODS),
    // Trois passkeys, dont deux sans nom et une non déliable : les trois formes
    // de la ligne sont rendues, donc les trois passent sous le filet.
    currentPasskeys: () =>
      Promise.resolve(viewerState.value.session === null ? [] : FIXTURE_PASSKEYS),
    // Les deux fournisseurs réels **et** celui de développement : les trois
    // libellés passent ainsi sous le filet, dans la configuration la plus
    // fournie. Aucun fournisseur configuré ne rendrait rien du tout.
    oauthProviders: () => ['google', 'github', 'local'],
  }
})

/**
 * Les organisations de l'appelant : **la base**, et rien d'autre.
 *
 * `available` reste celui du vrai point de composition — c'est lui qui décide
 * si l'écran rend ou refuse, et le doubler ferait de ce fichier une
 * démonstration de sa propre fixture. Seules les deux lectures sont remplacées,
 * comme `lib/auth` l'est plus haut.
 */
vi.mock('../apps/web/lib/organizations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../apps/web/lib/organizations')>()
  const { FIXTURE_INVITATION, FIXTURE_ORGANIZATIONS } = await import('./fixtures/screen-viewer')

  return {
    ...actual,
    organizations: {
      ...actual.organizations,
      activeOrganizationId: () => Promise.resolve(FIXTURE_ORGANIZATIONS.current.id),
      view: () => Promise.resolve(FIXTURE_ORGANIZATIONS),
      invitation: () => Promise.resolve(FIXTURE_INVITATION),
    },
  }
})

/**
 * Le stockage : **la base**, et rien d'autre (s18).
 *
 * `available` reste celui du vrai point de composition — c'est lui qui décide
 * si la carte est rendue, et le doubler ferait de ce fichier une démonstration
 * de sa propre fixture. Seule la lecture est remplacée, comme pour
 * `lib/organizations`.
 */
vi.mock('../apps/web/lib/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../apps/web/lib/storage')>()
  const { FIXTURE_AVATAR } = await import('./fixtures/screen-viewer')

  return {
    ...actual,
    storage: { ...actual.storage, avatarOf: () => Promise.resolve(FIXTURE_AVATAR) },
  }
})

/**
 * La facturation : **le point de composition, et rien d'autre**.
 *
 * `available` reste celui du vrai point de composition — c'est lui qui décide si
 * l'écran rend ou refuse, et le doubler ferait de ce fichier une démonstration
 * de sa propre fixture. Seule la lecture est remplacée, comme `lib/auth` et
 * `lib/organizations` plus haut.
 */
vi.mock('../apps/web/lib/billing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../apps/web/lib/billing')>()
  const { billingState } = await import('./fixtures/screen-viewer')

  return {
    ...actual,
    billing: {
      ...actual.billing,
      view: () => Promise.resolve(billingState.value),
    },
  }
})

/**
 * Le consentement (s36) : **la configuration la plus fournie**, et le contexte
 * de requête.
 *
 * Même raison que `oauthProviders` juste au-dessus : le dépôt ne déclare aucun
 * script non essentiel dans son état livré, donc ni la bannière ni les cases de
 * l'écran de préférences ne seraient rendues, et leurs libellés sortiraient du
 * filet. Deux scripts sont donc déclarés, et l'état est choisi pour que la
 * bannière **et** l'écran rendent quelque chose : une catégorie accordée (donc
 * un script injecté et un badge « accepté »), une catégorie en attente (donc la
 * bannière et un badge « en attente »).
 *
 * `available` reste celui du vrai point de composition : c'est lui qui décide
 * si l'écran rend ou refuse, et le doubler ferait de ce fichier une
 * démonstration de sa propre fixture.
 */
vi.mock('../apps/web/lib/consent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../apps/web/lib/consent')>()
  const { declaredCategories, resolveConsentState } = await import('@repo/module-consent')
  const { FIXTURE_CONSENT_SCRIPTS } = await import('./fixtures/screen-viewer')

  return {
    ...actual,
    // Écrit champ par champ, jamais étalé depuis l'original : `scripts` et
    // `categories` y sont des accesseurs qui lisent l'environnement, et les
    // étaler les évaluerait au chargement du double.
    consent: {
      available: actual.consent.available,
      scripts: FIXTURE_CONSENT_SCRIPTS,
      categories: declaredCategories(FIXTURE_CONSENT_SCRIPTS),
      prepare: () => {},
    },
    currentConsent: () =>
      Promise.resolve(resolveConsentState(FIXTURE_CONSENT_SCRIPTS, { analytics: true })),
  }
})

vi.mock('../apps/web/lib/i18n', async () => {
  const { createTranslator } = await import('next-intl')
  const { localeRouting } = await import('../apps/web/lib/locale-routing')
  const { pseudoRequestConfig } = await import('./fixtures/pseudo-locale')
  const { defaultLocale: locale } = await import('../config/i18n')

  return {
    appIntl: () =>
      Promise.resolve({
        locale,
        t: createTranslator(pseudoRequestConfig(locale)),
        path: (pathname: string) => localeRouting.publicPath(pathname, locale),
      }),
  }
})

/**
 * Le catalogue de secours de `app/global-error.tsx`, en pseudo-locale.
 *
 * Cet écran remplace `app/layout.tsx` : il n'a ni `NextIntlClientProvider` ni
 * locale de requête, donc il lit le catalogue de l'application directement
 * (`lib/fallback-text.ts`). Le double reproduit la règle du vrai module — il
 * **lève** sur une clé qu'aucun catalogue ne livre — et rend un marqueur sur
 * les autres, faute de quoi cet écran-là échapperait au filet.
 */
vi.mock('../apps/web/lib/fallback-text', async () => {
  const { catalogueKeys, markerFor } = await import('./fixtures/pseudo-locale')
  const { defaultLocale: locale } = await import('../config/i18n')
  const keys = new Set(catalogueKeys(locale))

  return {
    fallbackLocale: locale,
    fallbackText: (key: string) => {
      if (!keys.has(key)) {
        throw new Error(`Traduction manquante : « ${key} »`)
      }

      return markerFor(key)
    },
  }
})

/**
 * Le routeur, absent d'un rendu de nœud : les composants clients qui
 * rafraîchissent l'écran après un enregistrement en demandent un. C'est du
 * contexte de requête, comme la session — pas une règle.
 */
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/',
  useRouter: () => ({
    refresh: () => {},
    push: () => {},
    replace: () => {},
    back: () => {},
    forward: () => {},
    prefetch: () => {},
  }),
}))

/**
 * Le plancher de marqueurs d'**un** écran rendu.
 *
 * Mesuré, pas choisi : l'écran le plus pauvre de la liste — le tableau de bord
 * d'un visiteur connecté — en produit 30, shell compris, et la suite en produit
 * 331 au total. Le plancher est multiplié par le nombre d'écrans **réellement
 * rendus** : un écran devenu vide fait donc rougir sa propre ligne, et une
 * configuration qui n'en rendrait plus que deux ne peut plus franchir un total
 * figé.
 */
const markersPerScreen = (prefixed: boolean): number => (prefixed ? 20 : 19)
// Le plancher **dérive de la configuration**, il n'est pas écrit en dur : le
// sélecteur de langue du shell disparaît quand le module `i18n` est coupé, et
// chaque écran rend alors un marqueur de moins. Mesuré dans les deux états.
// Figé à 20, il faisait rougir la configuration « socle » pour une raison qui
// n'était pas un défaut ; abaissé à 19 pour tout le monde, il affaiblissait la
// configuration complète. C'est la même distinction qu'ailleurs dans ce dépôt :
// une attente dérivée est légitime, une attente relâchée ne l'est pas.

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const SCREEN_ROOT = join(REPO_ROOT, 'apps/web/app')

/**
 * Les fichiers d'écran de l'arborescence.
 *
 * `page.tsx` n'est plus le seul depuis s45 : `not-found.tsx` et
 * `global-error.tsx` sont **servis à un visiteur** exactement comme une page,
 * et ce sont eux que la revue a trouvés en train de contredire la politique de
 * sécurité du contenu tant qu'ils n'existaient pas. Les faire entrer ici, c'est
 * les faire entrer dans la garde de couverture : un écran ajouté sans être
 * rendu plus bas fait rougir.
 */
const SCREEN_FILENAMES = ['page.tsx', 'not-found.tsx', 'global-error.tsx']

const pageFilesUnder = (directory: string): readonly string[] => {
  const found: string[] = []

  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      const path = join(current, name)

      if (statSync(path).isDirectory()) {
        walk(path)
      } else if (SCREEN_FILENAMES.includes(name)) {
        found.push(relative(SCREEN_ROOT, path))
      }
    }
  }

  walk(directory)

  return found.sort()
}

/* ------------------------------------------------------------------------- *
 * Ce qui est accepté dans un rendu, et pourquoi.
 * ------------------------------------------------------------------------- */

/**
 * Les clés de prop dont la valeur n'est, par construction, jamais affichée :
 * une classe, une URL, un identifiant technique, un attribut de formulaire.
 *
 * Liste **explicite et courte**, et c'est le point : une prop inconnue portant
 * une chaîne qui n'est pas un marqueur fait rougir. Ajouter une entrée ici est
 * une décision, pas un réglage — c'est l'inverse d'une liste d'attributs
 * « affichés » qu'il faut deviner et qui laisse passer tout ce qu'elle n'a pas
 * prévu.
 */
const TECHNICAL_PROPS = new Set([
  'action',
  'accountHref',
  'align',
  'autoComplete',
  // s18 — l'URL de lecture de l'avatar, remise au menu de compte du **shell**,
  // donc présente sur chaque écran. Elle entre ici pour la même raison que
  // `accountHref` et `signOutAction` : ce sont les props du shell, pas celles
  // d'un écran. Le garde-fou de prose reste actif — `avatarUrl="Photo de
  // profil"` rougirait.
  'avatarUrl',
  'callbackURL',
  'className',
  'currentPath',
  // s36 — la destination de « personnaliser » de la bannière de consentement,
  // remise au composant du design system. Elle entre ici pour la même raison
  // qu'`accountHref` : la bannière vit dans le **shell**, donc sur chaque
  // écran, et ce n'est la prop d'aucun écran en particulier. Le garde-fou de
  // prose reste actif — `customizeHref="Personnaliser"` rougirait.
  'customizeHref',
  'destination',
  'href',
  'hrefLang',
  'htmlFor',
  'id',
  'name',
  'redirectTo',
  // Le rôle ARIA confié à un composant du design system — `Alert` le demande
  // explicitement à son appelant (« role="alert" pour un refus »). Le
  // vocabulaire est clos et technique ; le garde-fou `PROSE` refuse quand même
  // une phrase déguisée en rôle.
  // s15 — un rôle : `role="alert"` d'une alerte comme `role="owner"` d'une
  // appartenance. Ni l'un ni l'autre ne s'affiche : le libellé du rôle passe
  // par `roleLabelKey`, qui est un marqueur.
  'role',
  'side',
  'signInHref',
  'signOutAction',
  'size',
  // Le slug d'un document légal : il compose son URL et ses clés de
  // traduction, il ne s'affiche jamais. Le garde-fou de prose reste actif —
  // `slug="Confidentialité"` rougirait.
  'slug',
  'token',
  'type',
  'value',
  'variant',
])

/** Ces clés-là ne sont jamais soumises au garde-fou de prose : une liste de classes en contient. */
const OPAQUE_PROPS = new Set(['className'])

/**
 * Le garde-fou des props techniques : un nom autorisé ne blanchit pas une
 * phrase. `name="email"` passe, `name="Nom complet"` non — sans quoi la liste
 * ci-dessus deviendrait la porte de sortie qu'elle est censée fermer.
 */
const PROSE = /[\u00c0-\u00ff]|\p{L}{2,}[\u0020\u00a0]+\p{L}{2,}/u

/** Les attributs du balisage dont la valeur est lue par quelqu'un. */
const DISPLAYED_ATTRIBUTES = /\s(aria-label|aria-description|alt|placeholder|title)="([^"]*)"/g

const LETTERS_OR_DIGITS = /[\p{L}\p{N}]/u

/** Une chaîne observée dans un rendu, et l'endroit d'où elle vient. */
interface Verdict {
  readonly where: string
  readonly value: string
}

const decodeEntities = (value: string): string =>
  value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")

/** Les nœuds de texte du balisage, dans l'ordre. */
const textNodesOf = (html: string): readonly string[] =>
  html
    .split(/<[^>]*>/)
    .map((chunk) => decodeEntities(chunk).trim())
    .filter((chunk) => chunk !== '')

const displayedAttributesOf = (html: string): readonly Verdict[] =>
  [...html.matchAll(DISPLAYED_ATTRIBUTES)].map((match) => ({
    where: `attribut ${match[1] ?? ''}`,
    value: decodeEntities(match[2] ?? ''),
  }))

/**
 * Les chaînes confiées aux composants, avec le nom sous lequel elles arrivent.
 *
 * L'arbre est parcouru **avant expansion** : ce sont les props que l'écran
 * écrit, y compris à l'intérieur d'un objet ou d'un tableau, où le nom retenu
 * est celui de la propriété (`options.light` est vu sous `light`). Les éléments
 * hôtes (`div`, `p`) ne sont pas inspectés ici : leur texte et leurs attributs
 * lus sont observés sur le balisage rendu, qui est plus fidèle.
 */
const propStringsOf = (node: unknown): readonly Verdict[] => {
  const found: Verdict[] = []

  const walkValue = (value: unknown, name: string, custom: boolean): void => {
    if (typeof value === 'string') {
      if (custom) {
        found.push({ where: `prop ${name}`, value })
      }

      return
    }

    if (isValidElement(value) || Array.isArray(value)) {
      // Un élément passé en prop (`icon`, `actions`) est un sous-arbre : ce sont
      // ses propres props qui décident, pas le nom sous lequel il arrive.
      found.push(...propStringsOf(value))

      return
    }

    if (typeof value === 'object' && value !== null) {
      for (const [key, entry] of Object.entries(value)) {
        walkValue(entry, key, custom)
      }
    }
  }

  if (Array.isArray(node)) {
    for (const entry of node) {
      found.push(...propStringsOf(entry))
    }

    return found
  }

  if (!isValidElement(node)) {
    return found
  }

  const custom = typeof node.type !== 'string'
  const props = (node.props ?? {}) as Record<string, unknown>

  for (const [name, value] of Object.entries(props)) {
    // Les enfants d'un composant comptent comme le reste : un texte écrit
    // entre ses balises est du texte confié, et il peut atterrir dans une
    // surface flottante que le rendu statique ne monte pas.
    walkValue(value, name, custom)
  }

  return found
}

interface AcceptanceRules {
  readonly isMarker: (value: string) => boolean
  readonly catalogueKeys: ReadonlySet<string>
  readonly data: ReadonlySet<string>
  readonly locales: readonly string[]
  /**
   * Les props techniques propres à **cet** écran (constat F5 de la revue de
   * s15).
   *
   * s15 avait ajouté `create`, `switch` et `update` à la liste globale pour
   * trois URL de routes : trois noms très communs, désormais blanchis sur
   * **n'importe quel** écran du dépôt. Une garde qu'on desserre pour tout le
   * monde afin de laisser passer un écran n'est plus une garde. Le nom vit donc
   * là où il est écrit, et nulle part ailleurs.
   */
  readonly screenProps: ReadonlySet<string>
}

/** Ce qu'une chaîne rendue doit être pour être admise. Tout le reste est un défaut. */
const offenders = (found: readonly Verdict[], rules: AcceptanceRules): readonly string[] =>
  found
    .filter(({ where, value }) => {
      const trimmed = value.trim()

      if (trimmed === '' || !LETTERS_OR_DIGITS.test(trimmed)) {
        return false
      }

      if (rules.isMarker(trimmed)) {
        return false
      }

      // Une clé de traduction confiée à un composant client, qui la résoudra :
      // elle existe dans le catalogue, donc elle n'est pas du texte.
      if (rules.catalogueKeys.has(trimmed)) {
        return false
      }

      // Les données de la fixture : un nom, une adresse, une IP, une date
      // formatée. Elles s'affichent et ne viennent d'aucun catalogue.
      if (rules.data.has(trimmed)) {
        return false
      }

      // Un code de locale (`fr`, `en`) : le sélecteur le compare et le pose en
      // `hrefLang`, il ne l'affiche pas — c'est `i18n.locale.<code>` qui porte
      // le libellé, et celui-là est un marqueur.
      if (rules.locales.includes(trimmed)) {
        return false
      }

      const name = where.startsWith('prop ') ? where.slice('prop '.length) : ''

      if (OPAQUE_PROPS.has(name)) {
        return false
      }

      const technical = TECHNICAL_PROPS.has(name) || rules.screenProps.has(name)

      return !(technical && !PROSE.test(trimmed))
    })
    .map(({ where, value }) => `${where} : « ${value} »`)

describe('aucun texte affiché ne vient d’ailleurs que des catalogues', () => {
  it('rend chaque écran de l’application', async () => {
    const { localeRouting } = await import('../apps/web/lib/locale-routing')
    const { catalogueKeys, isMarker, pseudoRequestConfig } = await import(
      './fixtures/pseudo-locale'
    )
    const {
      ANONYMOUS,
      FIXTURE_EMAIL,
      FIXTURE_EXPIRED_INVITED_EMAIL,
      FIXTURE_INITIALS,
      FIXTURE_INVITED_EMAIL,
      FIXTURE_IP,
      FIXTURE_MEMBER_EMAIL,
      FIXTURE_NAME,
      FIXTURE_BILLING_ENDING,
      FIXTURE_BILLING_NONE,
      FIXTURE_BILLING_PAST_DUE,
      FIXTURE_BILLING_PRICE,
      FIXTURE_ORGANIZATION_NAME,
      FIXTURE_ORGANIZATION_SLUG,
      FIXTURE_PASSKEY_NAME,
      FIXTURE_SESSION_CREATED_AT,
      FIXTURE_USER_AGENT,
      SIGNED_IN,
      billingState,
      viewerState,
    } = await import('./fixtures/screen-viewer')
    const { AppShell } = await import('../apps/web/app/app-shell')

    const config = pseudoRequestConfig(defaultLocale)
    const keys = new Set(catalogueKeys(defaultLocale))
    const data = new Set([
      FIXTURE_NAME,
      FIXTURE_EMAIL,
      FIXTURE_IP,
      FIXTURE_USER_AGENT,
      FIXTURE_ORGANIZATION_NAME,
      FIXTURE_ORGANIZATION_SLUG,
      // s16 — les adresses affichées par les cartes « Membres » et
      // « Invitations », et par l'écran d'atterrissage. Ce sont des données.
      FIXTURE_MEMBER_EMAIL,
      FIXTURE_INVITED_EMAIL,
      FIXTURE_EXPIRED_INVITED_EMAIL,
      // s14 — le nom qu'une personne a donné à sa passkey. C'est une donnée :
      // elle s'affiche telle quelle et ne vient d'aucun catalogue. Le libellé
      // des passkeys **sans** nom, lui, est un marqueur — il vient du
      // catalogue, et c'est la seconde ligne de la fixture qui le fait rendre.
      FIXTURE_PASSKEY_NAME,
      // s18 — les initiales du repli d'avatar : une donnée **dérivée du nom**,
      // affichée telle quelle et venue d'aucun catalogue.
      FIXTURE_INITIALS,
      // s19 — le prix formaté par `Intl`. Il s'affiche tel quel et ne vient
      // d'aucun catalogue : c'est une donnée, comme un nom d'organisation.
      FIXTURE_BILLING_PRICE,
      // s19 — la date d'échéance, dans le style **long sans heure** de l'écran
      // de facturation. Le format complet plus bas est celui des sessions.
      new Intl.DateTimeFormat(defaultLocale, {
        dateStyle: 'long',
        timeZone: 'UTC',
      }).format(FIXTURE_SESSION_CREATED_AT),
      new Intl.DateTimeFormat(defaultLocale, {
        dateStyle: 'long',
        timeStyle: 'short',
        timeZone: 'UTC',
      }).format(FIXTURE_SESSION_CREATED_AT),
    ])

    const rules: Omit<AcceptanceRules, 'screenProps'> = {
      isMarker,
      catalogueKeys: keys,
      data,
      locales: localeRouting.locales,
    }

    const noParams = Promise.resolve({})

    /**
     * Ce qu'un écran fait dans **cette** configuration, dérivé du site public
     * et non concédé.
     *
     * Depuis s10, deux écrans peuvent légitimement refuser de rendre : la
     * racine redirige vers la connexion quand il n'y a pas de site public, et
     * une page légale répond 404 quand son slug n'est pas déclaré. Avaler
     * toute exception à `digest` réglerait le problème et en créerait un autre,
     * mesuré : une redirection **inattendue** — une racine qui redirigerait
     * toujours — passerait alors inaperçue pour les onze écrans. L'ensemble des
     * refus légitimes est prédictible ; il est donc prédit.
     */
    const { marketingSite } = await import('../apps/web/lib/marketing')
    const { organizations } = await import('../apps/web/lib/organizations')
    const { consent } = await import('../apps/web/lib/consent')
    const organizationsMounted = organizations.available
    const { billing } = await import('../apps/web/lib/billing')
    const billingMounted = billing.available
    const consentMounted = consent.available
    const LEGAL_SLUG = 'privacy'
    const publicSite = marketingSite.sections.length > 0
    const legalServed = marketingSite.legalDocuments.some(
      (document) => document.slug === LEGAL_SLUG,
    )

    const screens: readonly {
      readonly id: string
      readonly file: string
      readonly viewer: typeof SIGNED_IN
      /** Le refus attendu, tel que Next le signale — `null` quand l'écran doit rendre. */
      readonly refuses: string | null
      /**
       * Le plancher de marqueurs de **cet** écran.
       *
       * Absent, c'est celui d'un écran rendu dans le shell. `global-error.tsx`
       * rend son propre document — il remplace `app/layout.tsx`, donc il n'a ni
       * navigation, ni sélecteur de langue, ni menu de compte — et son budget de
       * texte est celui d'un écran de dernier recours, pas d'un écran applicatif.
       */
      readonly floor?: number
      /**
       * L'écran rend son propre `<html>`. Le passer dans `AppShell` produirait un
       * document imbriqué dans un autre, ce qui ne ressemble à rien de ce que le
       * serveur envoie.
       */
      readonly ownDocument?: boolean
      /** Les props techniques que **cet** écran écrit, et qu'aucun autre n'hérite. */
      readonly technicalProps?: readonly string[]
      readonly render: () => Promise<ReactNode>
    }[] = [
      {
        id: 'accueil anonyme',
        file: 'page.tsx',
        viewer: ANONYMOUS,
      refuses: publicSite ? null : 'NEXT_REDIRECT',
        // s11. Le site public porte désormais la configuration de ses
        // formulaires : une adresse de destination et une source d'inscription.
        // Ce ne sont pas des textes affichés — ils ne sortent jamais du serveur —
        // mais ils traversent l'arbre dans `site`. Déclarées **sur les écrans
        // qui rendent le site** : ailleurs, une prop de ce nom portant une
        // chaîne fait toujours rougir, et la garde de prose reste active ici
        // aussi (`contactRecipient="Écrivez-nous"` rougirait).
        technicalProps: ['contactRecipient', 'newsletterSource', 'type', 'labelKey'],
        render: async () => (await import('../apps/web/app/page')).default(),
      },
      {
        id: 'accueil connecté',
        file: 'page.tsx',
        viewer: SIGNED_IN,
        refuses: null,
        render: async () => (await import('../apps/web/app/page')).default(),
      },
      {
        // L'accueil marketing est servi par le même fichier que le tableau de
        // bord, à un visiteur anonyme : il est donc rendu par le cas
        // « accueil anonyme » ci-dessus. Ce qui suit est la seconde page
        // publique de s10.
        id: 'mentions légales',
        file: 'legal/[document]/page.tsx',
        viewer: ANONYMOUS,
      refuses: legalServed ? null : 'NEXT_HTTP_ERROR_FALLBACK;404',
        technicalProps: ['contactRecipient', 'newsletterSource'],
        render: async () =>
          (await import('../apps/web/app/legal/[document]/page')).default({
            params: Promise.resolve({ document: 'privacy' }),
          }),
      },
      {
        // s11. Le troisième écran public : il refuse quand le module est coupé,
        // exactement comme une page légale dont le slug n'est pas déclaré. Le
        // refus attendu est **dérivé** de l'état du module, jamais concédé.
        id: 'contact',
        file: 'contact/page.tsx',
        viewer: ANONYMOUS,
        refuses: publicSite ? null : 'NEXT_HTTP_ERROR_FALLBACK;404',
        // La route montée du formulaire et les types de champ : des valeurs
        // techniques que l'écran écrit, jamais du texte. La garde de prose
        // reste active — `type="Adresse email"` rougirait toujours.
        technicalProps: ['contactRecipient', 'newsletterSource', 'type', 'labelKey'],
        render: async () => (await import('../apps/web/app/contact/page')).default(),
      },
      {
        // s36 — l'écran de préférences de cookies, **public** : un visiteur
        // anonyme a le même droit qu'un compte à retirer son consentement. Il
        // refuse quand le module n'est pas monté, comme `/organizations`, et le
        // refus attendu est **dérivé** de l'état du module.
        id: 'cookies',
        file: 'cookies/page.tsx',
        viewer: ANONYMOUS,
        refuses: consentMounted ? null : 'NEXT_HTTP_ERROR_FALLBACK;404',
        render: async () => (await import('../apps/web/app/cookies/page')).default(),
      },
      {
        id: 'compte',
        file: 'account/page.tsx',
        viewer: SIGNED_IN,
        refuses: null,
        // s13. Les quatre URL des routes de second facteur, remises à la carte.
        // Déclarées **sur cet écran** et pas globalement : ailleurs, une prop
        // nommée `enableAction` portant une chaîne fait toujours rougir, et le
        // garde-fou de prose reste actif ici aussi — `enableAction="Activer"`
        // rougirait.
        technicalProps: [
          'enableAction',
          'verifyAction',
          'regenerateAction',
          'disableAction',
          // s14. Les quatre URL des routes de passkey, remises à la carte.
          'optionsAction',
          'registerAction',
          'renameAction',
          'revokeAction',
          // s18. Les trois routes du module de stockage et la liste des types
          // acceptés, remises à la carte « Photo de profil ». Déclarées **sur
          // cet écran** : ailleurs, une prop nommée `accept` portant une chaîne
          // fait toujours rougir, et le garde-fou de prose reste actif ici
          // aussi — `accept="Choisir une image"` rougirait.
          'presignAction',
          'confirmAction',
          'removeAction',
          'accept',
        ],
        render: async () => (await import('../apps/web/app/account/page')).default(),
      },
      {
        // s19. Trois rendus du même fichier : les états que l'écran distingue
        // portent chacun des textes qu'aucun autre ne rend — l'alerte de tête,
        // « accès jusqu'au … », l'essai, l'offre retirée du catalogue.
        id: 'facturation, sans abonnement',
        file: 'billing/page.tsx',
        viewer: SIGNED_IN,
        refuses: billingMounted ? null : 'NEXT_HTTP_ERROR_FALLBACK;404',
        // Les clés de libellé remises aux boutons, l'identifiant d'offre
        // qu'ils envoient, l'état d'abonnement et le retour de paiement : quatre
        // valeurs **techniques** que l'écran écrit, jamais du texte. Déclarées
        // **sur cet écran** : ailleurs, une prop nommée `state` portant une
        // chaîne fait toujours rougir, et le garde-fou de prose reste actif ici
        // aussi — `state="Abonnement actif"` rougirait.
        technicalProps: ['labelKey', 'offerId', 'state', 'checkoutOutcome'],
        render: async () => {
          billingState.value = FIXTURE_BILLING_NONE

          return (await import('../apps/web/app/billing/page')).default({
            searchParams: Promise.resolve({ checkout: 'success' }),
          })
        },
      },
      {
        id: 'facturation, paiement échoué',
        file: 'billing/page.tsx',
        viewer: SIGNED_IN,
        refuses: billingMounted ? null : 'NEXT_HTTP_ERROR_FALLBACK;404',
        technicalProps: ['labelKey', 'offerId', 'state', 'checkoutOutcome'],
        render: async () => {
          billingState.value = FIXTURE_BILLING_PAST_DUE

          return (await import('../apps/web/app/billing/page')).default({
            searchParams: Promise.resolve({ checkout: 'cancelled' }),
          })
        },
      },
      {
        id: 'facturation, abonnement résilié',
        file: 'billing/page.tsx',
        viewer: SIGNED_IN,
        refuses: billingMounted ? null : 'NEXT_HTTP_ERROR_FALLBACK;404',
        technicalProps: ['labelKey', 'offerId', 'state', 'checkoutOutcome'],
        render: async () => {
          billingState.value = FIXTURE_BILLING_ENDING

          return (await import('../apps/web/app/billing/page')).default({
            searchParams: noParams,
          })
        },
      },
      {
        // s15. L'écran refuse quand le module n'est pas monté — comme une page
        // légale dont le slug n'est pas déclaré. Le refus attendu est **dérivé**
        // de l'état du module, jamais concédé : le fichier passe donc dans les
        // deux configurations, et une redirection inattendue rougirait.
        id: 'organisations',
        file: 'organizations/page.tsx',
        viewer: SIGNED_IN,
      refuses: organizationsMounted ? null : 'NEXT_HTTP_ERROR_FALLBACK;404',
        // Les trois URL des routes du module, remises à son écran. Ce sont des
        // chemins montés, jamais du texte — et le garde-fou de prose reste
        // actif ici aussi : `create="Créer une organisation"` rougirait.
        // Déclarées **sur cet écran** : ailleurs, une prop nommée `create`
        // portant une chaîne fait toujours rougir.
        technicalProps: [
          'create',
          'switch',
          'update',
          // s16 — les quatre URL de plus, déclarées **sur cet écran** : ailleurs,
          // une prop nommée `invite` portant une chaîne fait toujours rougir.
          'invite',
          'resendInvitation',
          'revokeInvitation',
          'removeMember',
          // L'identifiant du compte de l'appelant : il départage « retirer » de
          // « quitter », il ne s'affiche jamais.
          'viewerId',
          'organizationId',
          'removeAction',
          // s17 — la route du changement de rôle, et le rôle **posé** par un
          // bouton de ligne. Ce sont un chemin monté et un identifiant de rôle,
          // jamais du texte : le garde-fou de prose reste actif, `role="Membre"`
          // rougirait toujours. Déclarées **sur cet écran**.
          'setMemberRole',
          'setRoleAction',
          'fields',
        ],
        render: async () =>
          (await import('../apps/web/app/organizations/page')).default({
            searchParams: Promise.resolve({ error: 'slug_unavailable' }),
          }),
      },
      {
        // s16 — l'écran d'atterrissage d'un lien d'invitation, pour un visiteur
        // **connecté** : c'est la branche qui rend le bouton d'acceptation.
        id: 'invitation, visiteur connecté',
        file: 'invitations/accept/page.tsx',
        viewer: SIGNED_IN,
        refuses: organizationsMounted ? null : 'NEXT_HTTP_ERROR_FALLBACK;404',
        technicalProps: ['acceptAction', 'signUpHref', 'homeHref', 'status'],
        render: async () =>
          (await import('../apps/web/app/invitations/accept/page')).default({
            searchParams: Promise.resolve({ token: 'jeton', error: 'invitation_expired' }),
          }),
      },
      {
        // Le même écran, **anonyme** : l'autre branche, celle qui propose la
        // connexion et l'inscription (critère 2). Sans elle, ses deux libellés
        // sortiraient du filet.
        id: 'invitation, visiteur anonyme',
        file: 'invitations/accept/page.tsx',
        viewer: ANONYMOUS,
        refuses: organizationsMounted ? null : 'NEXT_HTTP_ERROR_FALLBACK;404',
        technicalProps: ['acceptAction', 'signUpHref', 'homeHref', 'status'],
        render: async () =>
          (await import('../apps/web/app/invitations/accept/page')).default({
            searchParams: Promise.resolve({ token: 'jeton' }),
          }),
      },
      {
        id: 'connexion',
        file: 'sign-in/page.tsx',
        viewer: ANONYMOUS,
        refuses: null,
        // s13. La destination vers l'écran de vérification : un chemin monté,
        // jamais du texte.
        technicalProps: [
          'twoFactorRedirectTo',
          // s14. Les deux URL des routes de passkey et la destination du défi.
          'optionsAction',
          'verifyAction',
          'twoFactorDestination',
        ],
        render: async () =>
          (await import('../apps/web/app/sign-in/page')).default({
            searchParams: Promise.resolve({ verified: '1', email_changed: '1', reset: '1' }),
          }),
      },
      {
        id: 'connexion après un refus de fournisseur',
        file: 'sign-in/page.tsx',
        viewer: ANONYMOUS,
        refuses: null,
        technicalProps: [
          'twoFactorRedirectTo',
          // s14. Les deux URL des routes de passkey et la destination du défi.
          'optionsAction',
          'verifyAction',
          'twoFactorDestination',
        ],
        render: async () =>
          (await import('../apps/web/app/sign-in/page')).default({
            searchParams: Promise.resolve({ oauth: 'denied' }),
          }),
      },
      {
        // s13. Écran **public** : on y arrive après le mot de passe, quand la
        // bibliothèque a détruit la session et posé un cookie de défi. Il n'a
        // donc pas de raison de refuser, quelle que soit la configuration.
        id: 'vérification en deux étapes',
        file: 'two-factor/page.tsx',
        viewer: ANONYMOUS,
        refuses: null,
        render: async () =>
          (await import('../apps/web/app/two-factor/page')).default({
            searchParams: Promise.resolve({ next: '/account' }),
          }),
      },
      {
        id: 'retour de fournisseur',
        file: 'oauth/return/page.tsx',
        viewer: ANONYMOUS,
        refuses: null,
        render: async () =>
          (await import('../apps/web/app/oauth/return/page')).default({
            searchParams: Promise.resolve({ next: '/account' }),
          }),
      },
      {
        id: 'inscription',
        file: 'sign-up/page.tsx',
        viewer: ANONYMOUS,
        refuses: null,
        render: async () => (await import('../apps/web/app/sign-up/page')).default(),
      },
      {
        id: 'mot de passe oublié',
        file: 'forgot-password/page.tsx',
        viewer: ANONYMOUS,
        refuses: null,
        render: async () => (await import('../apps/web/app/forgot-password/page')).default(),
      },
      {
        id: 'réinitialisation avec jeton',
        file: 'reset-password/page.tsx',
        viewer: ANONYMOUS,
        refuses: null,
        render: async () =>
          (await import('../apps/web/app/reset-password/page')).default({
            searchParams: Promise.resolve({ token: 'jeton' }),
          }),
      },
      {
        id: 'réinitialisation sans jeton',
        file: 'reset-password/page.tsx',
        viewer: ANONYMOUS,
        refuses: null,
        render: async () =>
          (await import('../apps/web/app/reset-password/page')).default({
            searchParams: noParams,
          }),
      },
      {
        id: 'vérification en attente',
        file: 'verify-email/page.tsx',
        viewer: ANONYMOUS,
        refuses: null,
        render: async () =>
          (await import('../apps/web/app/verify-email/page')).default({
            searchParams: noParams,
          }),
      },
      {
        id: 'vérification expirée',
        file: 'verify-email/page.tsx',
        viewer: ANONYMOUS,
        refuses: null,
        render: async () =>
          (await import('../apps/web/app/verify-email/page')).default({
            searchParams: Promise.resolve({ error: 'expired' }),
          }),
      },
      {
        // L'écran servi sur une URL sans route. Il existe depuis s45 : le
        // composant intégré de Next qu'il remplace émettait quatre attributs
        // `style` et un `<style>` sans nonce, donc deux violations de la
        // politique livrée, sur une page qu'un visiteur atteint.
        id: 'page introuvable',
        file: 'not-found.tsx',
        viewer: ANONYMOUS,
      refuses: null,
        render: async () => (await import('../apps/web/app/not-found')).default(),
      },
      {
        // L'écran de dernier recours, qui remplace `app/layout.tsx` : son texte
        // ne vient pas de `appIntl()` mais du catalogue de secours, et c'est
        // exactement ce que le double posé plus haut surveille.
        id: 'erreur globale',
        file: 'global-error.tsx',
        viewer: ANONYMOUS,
      refuses: null,
        floor: 8,
        ownDocument: true,
        render: async () =>
          (await import('../apps/web/app/global-error')).default({ retry: () => {} }),
      },
    ]

    // La garde contre l'inertie : un écran ajouté sans être rendu ici sortirait
    // du filet sans que rien ne le dise.
    expect([...new Set(screens.map((screen) => screen.file))].sort()).toEqual(
      pageFilesUnder(SCREEN_ROOT),
    )

    const failures: string[] = []
    let markers = 0
    const { localeRouting: routing } = await import('../apps/web/lib/locale-routing')
    const MARKERS_PER_SCREEN = markersPerScreen(routing.prefixed)

    let rendered = 0
    let floors = 0

    for (const screen of screens) {
      viewerState.value = screen.viewer

      const outcome = await screen.render().then(
        (content) => ({ content, digest: null as string | null }),
        (error: unknown) => {
          const digest = (error as { digest?: unknown }).digest

          if (typeof digest !== 'string') {
            throw error
          }

          return { content: null, digest }
        },
      )

      if (screen.refuses !== null) {
        // Un refus **attendu**, et le bon : `redirect()` et `notFound()` ne se
        // valent pas, et un écran qui rendrait alors qu'on l'attend refusant
        // rougit ici aussi.
        expect(outcome.digest, `${screen.id} — refus attendu`).toContain(screen.refuses)
        continue
      }

      // Aucun refus n'est admis pour cet écran : une redirection inattendue est
      // exactement ce qu'un `catch` générique laissait passer.
      expect(outcome.digest, `${screen.id} — a refusé de rendre`).toBeNull()

      const content = outcome.content
      const before = markers

      rendered += 1
      floors += screen.floor ?? MARKERS_PER_SCREEN

      const tree = screen.ownDocument === true ? content : await AppShell({ children: content })
      const html = renderToStaticMarkup(
        createElement(NextIntlClientProvider, {
          locale: defaultLocale,
          messages: config.messages,
          // Un fuseau explicite : sans lui, `next-intl` signale un repli
          // d'environnement à `onError`, qui lève — la configuration de
          // production est la même, et c'est ce que `tests/i18n.test.ts`
          // éprouve par ailleurs.
          timeZone: 'UTC',
          onError: config.onError,
          getMessageFallback: config.getMessageFallback,
          children: tree,
        }),
      )

      const observed = [
        ...textNodesOf(html).map((value) => ({ where: 'texte', value })),
        ...displayedAttributesOf(html),
        ...propStringsOf(tree),
      ]

      markers += observed.filter(({ value }) => isMarker(value.trim())).length

      // Écran par écran : un rendu qui n'affiche plus rien ne peut plus se
      // cacher derrière le total des autres.
      expect(markers - before, `${screen.id} — marqueurs`).toBeGreaterThanOrEqual(
        screen.floor ?? MARKERS_PER_SCREEN,
      )

      failures.push(
        ...new Set(
          offenders(observed, {
            ...rules,
            screenProps: new Set(screen.technicalProps ?? []),
          }).map((offender) => `${screen.id} — ${offender}`),
        ),
      )
    }

    // Le plancher **suit les écrans réellement rendus** : figé à 60, il laissait
    // passer un facteur cinq de mou, et une configuration qui n'aurait plus rendu
    // que deux écrans l'aurait encore franchi. Il est désormais la somme des
    // planchers de chaque écran, parce que tous n'ont pas le même budget de
    // texte — celui qui rend son propre document n'a pas de shell.
    expect(rendered).toBe(screens.filter((screen) => screen.refuses === null).length)
    expect(markers).toBeGreaterThanOrEqual(floors)
    expect(failures, failures.join(' ;; ')).toEqual([])
  })
})
