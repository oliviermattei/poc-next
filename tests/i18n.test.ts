import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildRegistry,
  resolveLocale,
  singleLocaleRouting,
  type AnyModuleDefinition,
} from '@repo/core'
import { localePrefixRouting } from '@repo/module-i18n'
import { createRecordingMailer } from '@repo/mailer-testing'
import { describe, expect, it } from 'vitest'

import { createAuthUseCases } from '../packages/modules/auth/src/application/auth-use-cases'
import type { AuthDependencies } from '../packages/modules/auth/src/application/ports'
import { defaultAuthPolicy } from '../packages/modules/auth/src/domain/auth-policy'
import { flatMessagesFor } from '../apps/web/lib/messages'
import { availableModules, enabledModules, requiredModules } from '../config/features'
import { appLocales, defaultLocale } from '../config/i18n'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

/* ------------------------------------------------------------------------- *
 * Le cœur de la story : détecter un texte affiché qui ne vient pas des
 * catalogues.
 *
 * Ce n'est **pas** un inventaire des fichiers de traduction. Un inventaire
 * compare une liste à sa propre copie : il rougit sur toute addition légitime
 * et ne voit aucun défaut. C'est l'écueil exact de `tests/env-example.test.ts`
 * en s06, qui confrontait des noms de clés sans jamais lire les valeurs, si
 * bien qu'une valeur cassant un clone neuf est passée au vert.
 *
 * Ce qui est mesuré ici, en deux moitiés qui ne se remplacent pas :
 *
 * 1. **l'absence** — aucune prose ne subsiste dans la surface de rendu ; tout
 *    texte affiché passe donc par une clé ;
 * 2. **la présence** — chaque clé citée par cette surface existe dans chacune
 *    des locales livrées.
 *
 * L'une sans l'autre ne prouve rien : la première laisserait passer une clé
 * inventée, la seconde une phrase écrite en dur à côté d'une clé correcte.
 * ------------------------------------------------------------------------- */

/**
 * La **surface de rendu** balayée, et rien d'autre.
 *
 * Ce sont les fichiers `.tsx` : ceux qui produisent du balisage. Un `.ts`
 * n'affiche rien — ses chaînes sont des messages de journal, des raisons
 * d'erreur JSON ou des textes d'email déclarés au contrat, et chacun a sa
 * propre garde. Le jour où un module apportera ses écrans, son dossier
 * `presentation` est déjà dans la portée.
 */
const RENDER_ROOTS = ['apps/web/app', 'packages/ui/src', 'packages/modules'] as const

const tsxFilesUnder = (directory: string): readonly string[] => {
  const found: string[] = []

  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      if (name === 'node_modules' || name === '.turbo') {
        continue
      }

      const path = join(current, name)

      if (statSync(path).isDirectory()) {
        walk(path)
      } else if (path.endsWith('.tsx')) {
        found.push(path)
      }
    }
  }

  walk(join(REPO_ROOT, directory))

  return found
}

const RENDER_FILES = RENDER_ROOTS.flatMap(tsxFilesUnder)

/**
 * Blanchit le contenu délimité qui suit un marqueur, parenthèses ou accolades
 * équilibrées comprises.
 *
 * Deux contextes seulement sont blanchis, et ils sont nommés : les arguments de
 * `cva(` et la valeur de `className=`. Ce sont les deux endroits où une chaîne
 * de classes Tailwind ressemble à une phrase (« border-border bg-card text-… »).
 * Ce ne sont pas des endroits où du texte de produit peut se cacher : une copie
 * écrite dans un `className` ne s'afficherait pas.
 */
const blankDelimited = (source: string, marker: string, open: string, close: string): string => {
  let out = source

  for (;;) {
    const start = out.indexOf(marker)

    if (start === -1) {
      return out
    }

    let depth = 0
    let index = start + marker.length - 1

    for (; index < out.length; index += 1) {
      if (out[index] === open) {
        depth += 1
      } else if (out[index] === close) {
        depth -= 1

        if (depth === 0) {
          break
        }
      }
    }

    out = `${out.slice(0, start)}${' '.repeat(index - start + 1)}${out.slice(index + 1)}`
  }
}

/**
 * Une chaîne « de prose » : un caractère accentué, ou deux mots d'au moins deux
 * lettres séparés par une espace.
 *
 * Volontairement large. Un faux positif se corrige en passant la chaîne par le
 * catalogue — c'est-à-dire en faisant ce que la règle demande. Un faux négatif,
 * lui, serait un texte en dur que personne ne voit.
 */
const PROSE = /[À-ÿ]|(?:\p{L}{2,}[\u0020\u00a0]+\p{L}{2,})/u

/** Les directives de module ne sont pas du texte affiché. */
const DIRECTIVE = /^use (client|server)$/

const neutralise = (source: string): string => {
  let out = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"])\/\/[^\n]*/g, '$1')

  out = blankDelimited(out, 'cva(', '(', ')')
  out = blankDelimited(out, 'className={', '{', '}')

  return out.replace(/className="[^"]*"/g, 'className=""')
}

/** Les littéraux et les nœuds de texte JSX d'un fichier, commentaires exclus. */
const displayedStringsOf = (source: string): readonly string[] => {
  const code = neutralise(source)
  const literals = [...code.matchAll(/(['"])((?:(?!\1)[^\\\n]|\\.)*)\1/g)].map(
    (match) => match[2] ?? '',
  )
  // Un nœud de texte JSX : entre un `>` fermant et un `<` ouvrant, sans
  // accolade ni ponctuation de code — ce qui écarte les paramètres de type
  // (`Promise<Response>`) sans écarter « Se connecter ».
  const jsxText = [...code.matchAll(/>([^<>{}();=]+)</g)].map((match) => (match[1] ?? '').trim())

  return [...new Set([...literals, ...jsxText])]
}

/** Ce qui ressemble à une clé de traduction : `module.chemin.de.clé`. */
const KEY_PATTERN = /^[a-z][a-zA-Z0-9-]*(?:\.[a-zA-Z0-9]+)+$/

/**
 * Le catalogue de référence : l'application **plus tous les modules du dépôt**,
 * activés ou non.
 *
 * Pas le catalogue de l'application telle qu'elle est configurée aujourd'hui,
 * et la nuance décide de la valeur du fichier : une clé du module `i18n`
 * (`i18n.switcher.label`) disparaît légitimement quand ce module est coupé. Un
 * test qui n'est vrai que dans l'état courant de `config/features.ts` ne prouve
 * rien sur la modularité, et obligerait la recette de s26 — qui exécute cette
 * suite sous plusieurs configurations — à porter une liste d'exceptions.
 *
 * Ce qui est donc prouvé ici : toute clé citée par un écran est **livrée par
 * quelqu'un**, dans **chaque** locale du projet. Qu'elle soit présente à
 * l'exécution est tenu ailleurs, et par construction : un module ne cite que
 * ses propres clés, `assertDeclarationsAreComplete` refuse une entrée de
 * navigation non traduite, `localeOptions` ne demande rien quand une seule
 * langue est servie, et `e2e/i18n.spec.ts` sert les écrans dans les deux états.
 */
const everyModuleRegistry = buildRegistry({
  available: [...availableModules],
  enabled: availableModules.map((module) => module.id),
  locales: [...appLocales],
})

const CATALOGS = Object.fromEntries(
  appLocales.map((locale) => [locale, flatMessagesFor(locale, everyModuleRegistry)]),
) as Record<string, Readonly<Record<string, string>>>

describe('aucune chaîne visible n’est écrite en dur', () => {
  it('balaie réellement la surface de rendu, faute de quoi ce fichier ne vérifie rien', () => {
    // La garde contre l'inertie : une extraction qui ne trouve aucun fichier
    // rendrait tout ce qui suit vert sur du vide.
    expect(RENDER_FILES.length).toBeGreaterThan(20)
    expect(RENDER_FILES.some((file) => file.endsWith('app/page.tsx'))).toBe(true)
    expect(RENDER_FILES.some((file) => file.endsWith('account/page.tsx'))).toBe(true)
  })

  it('détecte une phrase écrite dans un composant, pas seulement dans un fichier réel', () => {
    // La preuve que le détecteur mord — le même geste que la revue fera :
    // planter une chaîne en dur et regarder rougir. Trois formes, parce que
    // trois formes existent à l'écran.
    const planted = [
      'export const A = () => <h1>Se connecter maintenant</h1>',
      'export const B = () => <button aria-label="Fermer le panneau" />',
      "const message = 'Votre compte a été supprimé'",
    ]

    for (const source of planted) {
      expect(
        displayedStringsOf(source).filter((value) => PROSE.test(value) && !DIRECTIVE.test(value)),
        source,
      ).not.toEqual([])
    }
  })

  it('ne confond pas les classes Tailwind ni le code avec du texte', () => {
    // Le pendant du cas précédent : un détecteur qui rougit sur tout serait
    // désarmé au premier `className`.
    const source = [
      'const styles = cva("inline-flex items-center gap-2 rounded-md border border-input")',
      'export const C = () => <div className="flex flex-wrap items-center gap-3" />',
      'const f = (): Promise<Response> => fetch(url)',
    ].join('\n')

    expect(
      displayedStringsOf(source).filter((value) => PROSE.test(value) && !DIRECTIVE.test(value)),
    ).toEqual([])
  })

  it('ne laisse aucun texte en dur dans les écrans et les composants livrés', () => {
    const offenders = RENDER_FILES.flatMap((file) => {
      const suspects = displayedStringsOf(readFileSync(file, 'utf8')).filter(
        (value) => PROSE.test(value) && !DIRECTIVE.test(value),
      )

      return suspects.map((value) => `${file.slice(REPO_ROOT.length)} : « ${value} »`)
    })

    expect(offenders).toEqual([])
  })

  it('cite des clés qui existent toutes, dans chacune des locales livrées', () => {
    const used = [
      ...new Set(
        RENDER_FILES.flatMap((file) =>
          displayedStringsOf(readFileSync(file, 'utf8')).filter((value) =>
            KEY_PATTERN.test(value),
          ),
        ),
      ),
    ].filter((key) => !key.startsWith('next-') && !key.includes('/'))

    // Sans cette garde, « toutes les clés existent » serait vrai sur zéro clé —
    // c'est-à-dire sur un écran entièrement écrit en dur.
    expect(used.length).toBeGreaterThan(40)

    for (const locale of appLocales) {
      const missing = used.filter((key) => CATALOGS[locale]?.[key] === undefined)

      expect(missing, `locale ${locale}`).toEqual([])
    }
  })

  it('livre aussi les clés que seul le code compose', () => {
    // `t(`i18n.locale.${candidate}`)` est la seule clé dynamique du dépôt :
    // aucune extraction statique ne la voit, donc elle est nommée ici.
    for (const locale of appLocales) {
      for (const named of appLocales) {
        expect(CATALOGS[locale]?.[`i18n.locale.${named}`], `${locale} → ${named}`).toBeDefined()
      }
    }
  })
})

/* ------------------------------------------------------------------------- *
 * Complétude des catalogues — le balayage porte sur **l'annuaire complet**,
 * pas sur les modules activés : le critère dit « quel que soit le module et sa
 * date d'ajout ».
 * ------------------------------------------------------------------------- */

describe('les catalogues sont complets dans toutes les locales du projet', () => {
  it('balaie tous les modules du dépôt, activés ou non', () => {
    expect(availableModules.length).toBeGreaterThan(enabledModules.length)
  })

  it.each(availableModules.map((module) => [module.id, module] as const))(
    'le module « %s » livre les mêmes clés dans chaque locale',
    (_id, module: AnyModuleDefinition) => {
      const reference = appLocales[0]

      for (const locale of appLocales) {
        expect(Object.keys(module.messages[locale] ?? {}).sort()).toEqual(
          Object.keys(module.messages[reference] ?? {}).sort(),
        )
      }
    },
  )

  it.each(availableModules.map((module) => [module.id, module] as const))(
    'le module « %s » livre chaque template d’email dans chaque locale',
    (_id, module: AnyModuleDefinition) => {
      for (const template of module.emails) {
        for (const locale of appLocales) {
          expect(template.locales[locale], `${template.id} / ${locale}`).toBeDefined()
        }
      }
    },
  )

  it('livre le catalogue de l’application dans les mêmes clés d’une locale à l’autre', () => {
    const reference = flatMessagesFor(defaultLocale, everyModuleRegistry)

    expect(Object.keys(reference).length).toBeGreaterThan(40)

    for (const locale of appLocales) {
      expect(Object.keys(flatMessagesFor(locale, everyModuleRegistry)).sort(), locale).toEqual(
        Object.keys(reference).sort(),
      )
    }
  })

  it('refuse une clé manquante plutôt que de la remplacer par elle-même', () => {
    // Le repli sur la clé est ce que le critère interdit : `i18n/request.ts`
    // fait lever `onError` **et** `getMessageFallback`. La règle est éprouvée
    // ici sur la seule chose qu'un test de nœud peut observer sans navigateur —
    // qu'aucune des deux ne se contente de journaliser.
    const source = readFileSync(join(REPO_ROOT, 'apps/web/i18n/request.ts'), 'utf8')

    expect(source).toMatch(/onError:[\s\S]*?throw/)
    expect(source).toMatch(/getMessageFallback:[\s\S]*?throw/)
  })
})

/* ------------------------------------------------------------------------- *
 * Ce que le registre fait des catalogues : la moitié qui n'existait pas.
 * ------------------------------------------------------------------------- */

const registryOf = (enabled: readonly string[]) =>
  buildRegistry({
    available: [...availableModules],
    enabled,
    locales: [...appLocales],
  })

describe('chaque module apporte ses traductions', () => {
  it('les fait entrer dans le catalogue servi, préfixées par leur module', () => {
    const registry = registryOf(['auth', 'i18n'])

    expect(registry.messages.fr?.['auth.navigation.account']).toBe('Mon compte')
    expect(registry.messages.en?.['auth.navigation.account']).toBe('My account')
    expect(registry.messages.fr?.['i18n.switcher.label']).toBe('Langue')
  })

  it('retire les clés d’un module désactivé sans casser le chargement des autres', () => {
    const withI18n = registryOf(['auth', 'i18n'])
    const withoutI18n = registryOf(['auth'])

    // Sans cette garde, le cas serait vert sur deux catalogues identiques.
    expect(Object.keys(withI18n.messages.fr ?? {}).length).toBeGreaterThan(
      Object.keys(withoutI18n.messages.fr ?? {}).length,
    )

    for (const key of Object.keys(withoutI18n.messages.fr ?? {})) {
      expect(key.startsWith('i18n.')).toBe(false)
    }

    // Et ce qui reste est intact : retirer un module ne dégrade pas le
    // catalogue des autres.
    expect(withoutI18n.messages.fr?.['auth.navigation.account']).toBe('Mon compte')
    expect(withoutI18n.messages.en?.['auth.navigation.account']).toBe('My account')
  })
})

/* ------------------------------------------------------------------------- *
 * Les deux états de configuration, sur la même fonction de résolution.
 * ------------------------------------------------------------------------- */

const prefixed = localePrefixRouting({ locales: [...appLocales], defaultLocale })
const single = singleLocaleRouting(defaultLocale)

const aRequest = (pathname: string, cookieLocale: string | null = null, acceptLanguage = 'fr') => ({
  pathname,
  cookieLocale,
  acceptLanguage,
})

describe('module i18n activé', () => {
  it('préfixe les URL par la locale', () => {
    expect(prefixed.publicPath('/account', 'en')).toBe('/en/account')
    expect(prefixed.publicPath('/', 'fr')).toBe('/fr')
  })

  it('redirige une URL sans préfixe vers sa forme canonique', () => {
    expect(prefixed.canonicalPath(aRequest('/account'))).toBe('/fr/account')
    expect(prefixed.canonicalPath(aRequest('/account', 'en'))).toBe('/en/account')
  })

  it('ne redirige pas une URL déjà préfixée, et lui rend son chemin interne', () => {
    expect(prefixed.canonicalPath(aRequest('/en/account'))).toBeNull()
    expect(prefixed.internalPath('/en/account')).toBe('/account')
  })

  it('fait gagner l’URL sur le cookie : un lien partagé s’ouvre dans sa langue', () => {
    expect(prefixed.resolve(aRequest('/en/account', 'fr'))).toBe('en')
  })

  it('retombe sur la langue du navigateur, puis sur celle du site', () => {
    expect(prefixed.resolve(aRequest('/account', null, 'en-GB,en;q=0.9'))).toBe('en')
    expect(prefixed.resolve(aRequest('/account', null, 'de-DE,de;q=0.9'))).toBe('fr')
  })

  it('ne préfixe pas deux fois un chemin déjà public', () => {
    // Mesuré au navigateur : la destination de retour d'un écran protégé fait
    // un aller-retour par la chaîne de requête, et un second passage produisait
    // `/fr/fr/account` — une URL que rien ne sert. L'idempotence ferme la classe
    // entière, pas seulement l'appelant fautif.
    expect(prefixed.publicPath('/fr/account', 'fr')).toBe('/fr/account')
    expect(prefixed.publicPath(prefixed.publicPath('/account', 'en'), 'en')).toBe('/en/account')
    // Et changer de langue reste possible sur un chemin déjà public.
    expect(prefixed.publicPath('/fr/account', 'en')).toBe('/en/account')
  })

  it('ne sert pas une locale que le projet ne livre pas, d’où qu’elle vienne', () => {
    expect(prefixed.resolve(aRequest('/account', 'de'))).toBe('fr')
    expect(prefixed.internalPath('/de/account')).toBe('/de/account')
  })
})

describe('module i18n non activé', () => {
  it('sert les routes sans préfixe de locale', () => {
    expect(single.publicPath('/account', 'en')).toBe('/account')
    expect(single.internalPath('/account')).toBe('/account')
  })

  it('n’effectue aucune redirection de locale, quelle que soit la demande', () => {
    expect(single.canonicalPath(aRequest('/account'))).toBeNull()
    expect(single.canonicalPath(aRequest('/account', 'en', 'en-GB,en;q=0.9'))).toBeNull()
    expect(single.canonicalPath(aRequest('/en/account'))).toBeNull()
  })

  it('utilise la langue par défaut configurée, cookie et navigateur compris', () => {
    expect(single.resolve(aRequest('/account', 'en', 'en-GB,en;q=0.9'))).toBe(defaultLocale)
  })

  it('n’a qu’une langue à proposer, donc aucun sélecteur à afficher', () => {
    // Le shell affiche le sélecteur quand `locales.length > 1` : la condition
    // porte sur une donnée, jamais sur l'identifiant d'un module.
    expect(single.locales).toEqual([defaultLocale])
    expect(prefixed.locales.length).toBeGreaterThan(1)
  })

  it('répond à la même URL interne que le module activé, sans variante', () => {
    // Le critère qui décide de la forme de toutes les routes du dépôt : le
    // chemin qui atteint le fichier de route est le même dans les deux états.
    for (const path of ['/', '/account', '/sign-in', '/api/modules/auth/sign-in/email']) {
      expect(single.internalPath(path)).toBe(path)
      expect(prefixed.internalPath(prefixed.publicPath(path, 'en'))).toBe(path)
    }
  })
})

describe('la configuration du dépôt', () => {
  it('monte le registre avec les locales du projet, dans l’état livré', () => {
    expect(() =>
      buildRegistry({
        available: [...availableModules],
        enabled: [...enabledModules],
        required: [...requiredModules],
        locales: [...appLocales],
      }),
    ).not.toThrow()
  })
})

/* ------------------------------------------------------------------------- *
 * Les emails : la langue du destinataire, et la règle unique du destinataire
 * sans compte.
 * ------------------------------------------------------------------------- */

const emailLocaleFor = (knownLocale: string | null | undefined): string =>
  resolveLocale({ locales: [...appLocales], defaultLocale, candidate: knownLocale })

const authUseCasesWith = (mailer: ReturnType<typeof createRecordingMailer>) =>
  createAuthUseCases({
    users: {
      findByEmail: () => Promise.resolve(null),
      findById: () => Promise.resolve(null),
      markEmailVerified: () => Promise.resolve(false),
      changeEmail: () => Promise.resolve(false),
      changeName: () => Promise.resolve(false),
      deleteById: () => Promise.resolve(false),
    },
    sessions: {
      countForUser: () => Promise.resolve(0),
      listForUser: () => Promise.resolve([]),
      revokeAllForUser: () => Promise.resolve(0),
      revokeForUser: () => Promise.resolve(false),
    },
    tokens: {
      create: () => Promise.resolve(),
      consume: () => Promise.resolve(null),
      invalidateSiblings: () => Promise.resolve(0),
    },
    tokenFactory: {
      generate: () => 'jeton',
      digest: () => Promise.resolve('empreinte'),
    },
    mailer,
    log: () => {},
    policy: defaultAuthPolicy,
    appUrl: 'https://example.test',
    emailLocaleFor,
    now: () => new Date('2026-01-01T00:00:00Z'),
  } satisfies AuthDependencies)

describe('les emails transactionnels partent dans la langue du destinataire', () => {
  it('utilise la langue connue du destinataire, sur les quatre envois du module', async () => {
    const mailer = createRecordingMailer()
    const useCases = authUseCasesWith(mailer)

    await useCases.sendVerificationEmail({ to: 'a@example.test', knownLocale: 'en' })
    await useCases.sendMagicLinkEmail({
      to: 'a@example.test',
      url: 'https://example.test/x',
      siblingIdentifier: 'i',
      siblingValue: 'v',
      knownLocale: 'en',
    })
    await useCases.sendPasswordResetEmail({
      to: 'a@example.test',
      token: 't',
      userId: 'u',
      knownLocale: 'en',
    })
    await useCases.requestEmailChange({
      userId: 'u',
      newEmail: 'b@example.test',
      knownLocale: 'en',
    })

    expect(mailer.sent).toHaveLength(4)
    expect(mailer.sent.map((sent) => sent.locale)).toEqual(['en', 'en', 'en', 'en'])
  })

  it('envoie dans la locale par défaut du site au destinataire sans compte', async () => {
    // Invitation, guest checkout, liste d'attente : rien n'est connu du
    // destinataire. La règle est **la même fonction**, appelée avec `null` —
    // pas une seconde branche.
    const mailer = createRecordingMailer()
    const useCases = authUseCasesWith(mailer)

    await useCases.sendVerificationEmail({ to: 'inconnu@example.test', knownLocale: null })
    await useCases.sendVerificationEmail({ to: 'inconnu@example.test' })

    expect(mailer.sent.map((sent) => sent.locale)).toEqual([defaultLocale, defaultLocale])
  })

  it('refuse une langue que le projet ne livre pas, plutôt que d’envoyer dans le vide', async () => {
    const mailer = createRecordingMailer()

    await authUseCasesWith(mailer).sendVerificationEmail({
      to: 'a@example.test',
      knownLocale: 'de',
    })

    expect(mailer.sent[0]?.locale).toBe(defaultLocale)
  })

  it('demande un template que le module livre réellement dans cette langue', async () => {
    // Le lien entre l'envoi et le contrat : la locale demandée doit exister
    // dans le template, sans quoi le rendu lève au moment de l'envoi réel.
    const mailer = createRecordingMailer()

    await authUseCasesWith(mailer).sendVerificationEmail({
      to: 'a@example.test',
      knownLocale: 'en',
    })

    const sent = mailer.sent[0]
    const [moduleId = '', templateId = ''] = (sent?.template ?? '').split('.')
    const template = availableModules
      .find((module) => module.id === moduleId)
      ?.emails.find((candidate) => candidate.id === templateId)

    expect(template).toBeDefined()
    expect(Object.keys(template?.locales ?? {})).toContain(sent?.locale)
  })
})
