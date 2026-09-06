import { readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  MODULE_ROUTE_PREFIX,
  buildRegistry,
  resolveLocale,
  singleLocaleRouting,
  type AnyModuleDefinition,
} from '@repo/core'
import { configureConsent, resetConsentService } from '@repo/module-consent'
import { localePrefixRouting } from '@repo/module-i18n'
import { createRecordingMailer } from '@repo/mailer-testing'
import { createFormatter, createTranslator } from 'next-intl'
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'

import { createAuthUseCases } from '../packages/modules/auth/src/application/auth-use-cases'
import type { AuthDependencies } from '../packages/modules/auth/src/application/ports'
import { defaultAuthPolicy } from '../packages/modules/auth/src/domain/auth-policy'
import { LOCALE_COOKIE, localeRouting } from '../apps/web/lib/locale-routing'
import { flatMessagesFor } from '../apps/web/lib/messages'
import { requestConfigFor } from '../apps/web/i18n/request-config'
import { moduleRegistry } from '../apps/web/lib/module-registry'
import { proxy } from '../apps/web/proxy'
import { availableModules, enabledModules, requiredModules } from '../config/features'
import { appLocales, defaultLocale } from '../config/i18n'
import { FIXTURE_CONSENT_SCRIPTS } from './fixtures/screen-viewer'
import { dispatchAllowingRateLimit } from './fixtures/rate-limit'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

/* ------------------------------------------------------------------------- *
 * Le cœur de la story : détecter un texte affiché qui ne vient pas des
 * catalogues.
 *
 * **Ce n'est plus ce fichier qui tient le critère 3.** Il est tenu par
 * `tests/rendered-text.test.ts`, qui rend les écrans avec un catalogue
 * pseudo-locale et refuse tout ce qui n'en vient pas : la forme de la source y
 * est hors sujet. Le balayage ci-dessous reste comme pré-contrôle, et parce
 * qu'il voit ce qu'un rendu ne voit pas — une branche non prise, une surface
 * flottante fermée. Deux revues ont mesuré qu'élargir ses mailles une fois de
 * plus n'était pas la réponse.
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
 * Ce sont les fichiers `.tsx` : ceux qui produisent du balisage — 30 dans le
 * dépôt au moment de cette mesure. Le jour où un module apportera ses écrans,
 * son dossier `presentation` est déjà dans la portée.
 *
 * Les `.ts` ne sont **pas** balayés, et ce n'est pas parce qu'ils n'affichent
 * rien : `apps/web/lib/navigation.ts` calcule des libellés. C'est parce que le
 * texte qu'ils portent est tenu ailleurs — `tests/app-shell.test.ts` rougit sur
 * un libellé de navigation écrit en dur, `assertDeclarationsAreComplete` refuse
 * une entrée non traduite, et les textes d'email sont déclarés au contrat de
 * module. Ce filet ne dit donc rien des `.ts` : c'est une limite, pas une
 * garantie.
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

/** Délimiteur jamais refermé : il n'y a pas de borne, et il ne faut pas en inventer une. */
const UNBALANCED = -1

/**
 * Bornes équilibrées : l'index du délimiteur fermant qui répond à celui ouvert
 * en `start`, ou `UNBALANCED`.
 *
 * **Rendre la fin du fichier faute de fermeture était un piège**, mesuré en
 * seconde revue de s09 : `cn('after:content-["("]')` faisait blanchir tout le
 * reste du fichier, donc le détecteur s'arrêtait de chercher en silence. Un
 * scanner qui abandonne au milieu est pire que celui qui rate une forme : il
 * rate tout ce qui suit, sans le dire. Les appelants traitent désormais ce cas
 * explicitement — aucun ne blanchit.
 *
 * Les chaînes sont ignorées **quand on équilibre des parenthèses**, et
 * seulement là : c'est le cas de `cn(` et `cva(`, dont les arguments sont
 * précisément des chaînes de classes où une parenthèse isolée est légitime. Sur
 * des accolades, l'appelant est du JSX, dont le texte porte des apostrophes
 * (« l'espace ») qu'aucun suivi de chaîne ne saurait distinguer d'un littéral.
 */
const balancedEnd = (source: string, start: number, open: string, close: string): number => {
  const skipStrings = open === '('
  let depth = 0
  let quote: string | null = null

  for (let index = start; index < source.length; index += 1) {
    const character = source[index]

    if (skipStrings && quote !== null) {
      if (character === '\\') {
        index += 1
      } else if (character === quote) {
        quote = null
      }

      continue
    }

    if (skipStrings && (character === "'" || character === '"' || character === '`')) {
      quote = character ?? null

      continue
    }

    if (character === open) {
      depth += 1
    } else if (character === close) {
      depth -= 1

      if (depth === 0) {
        return index
      }
    }
  }

  return UNBALANCED
}

/**
 * Blanchit le contenu délimité qui suit un marqueur, parenthèses ou accolades
 * équilibrées comprises.
 *
 * Trois contextes seulement sont blanchis, et ils sont nommés : les arguments
 * de `cva(`, ceux de `cn(` et la valeur de `className=`. Ce sont les endroits
 * où une chaîne de classes Tailwind ressemble à une phrase (« border-border
 * bg-card text-… »). Ce ne sont pas des endroits où du texte de produit peut se
 * cacher : une copie écrite dans un `className` ne s'afficherait pas.
 *
 * Le corollaire est une règle sur le code de production : une liste de classes
 * s'écrit dans `className=`, `cn(` ou `cva(`. Écrite ailleurs — un gabarit posé
 * dans une variable —, elle sort de ces trois contextes et le détecteur la
 * prendra pour un fragment de phrase. C'est le faux positif connu, et il se
 * corrige en remettant les classes là où elles vont.
 *
 * Un délimiteur jamais refermé ne blanchit **rien** : le passage est laissé tel
 * quel et la recherche reprend après lui. Le pire qui puisse alors arriver est
 * une liste de classes signalée à tort — bruyant, donc réparable. Blanchir
 * jusqu'à la fin du fichier, comme le faisait la version précédente, éteignait
 * le détecteur sur tout ce qui suivait, en silence.
 */
const blankDelimited = (source: string, marker: string, open: string, close: string): string => {
  let out = source
  let from = 0

  for (;;) {
    const start = out.indexOf(marker, from)

    if (start === -1) {
      return out
    }

    const index = balancedEnd(out, start + marker.length - 1, open, close)

    if (index === UNBALANCED) {
      from = start + marker.length

      continue
    }

    // Le blanchiment conserve la longueur : les index restent valides.
    out = `${out.slice(0, start)}${' '.repeat(index - start + 1)}${out.slice(index + 1)}`
    from = index + 1
  }
}

const neutralise = (source: string): string => {
  let out = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"])\/\/[^\n]*/g, '$1')

  out = blankDelimited(out, 'cva(', '(', ')')
  out = blankDelimited(out, 'cn(', '(', ')')
  out = blankDelimited(out, 'className={', '{', '}')

  return out.replace(/className="[^"]*"/g, 'className=""')
}

/* ------------------------------------------------------------------------- *
 * L'extraction, en quatre familles.
 *
 * La revue de s09 a mesuré que la première version n'extrayait que les
 * littéraux entre apostrophes ou guillemets et les nœuds de texte JSX sans
 * accolade : un littéral gabarit (`` `Bonjour ${nom}` ``) et une phrase
 * concaténée passaient au vert. C'est le mode d'échec n°4 du catalogue de
 * `docs/STATE.md` — « garde textuelle contournée par un accent grave ».
 * ------------------------------------------------------------------------- */

/** Un littéral entre apostrophes ou guillemets. */
const QUOTED = /(['"])((?:(?!\1)[^\\\n]|\\.)*)\1/g
/** Un littéral gabarit, accent grave compris — l'oubli mesuré en revue. */
const TEMPLATE = /`((?:[^`\\]|\\.)*)`/g

/** Les morceaux statiques d'un gabarit : ce qui reste hors des `${…}`. */
const staticSegmentsOf = (raw: string): readonly string[] => raw.split(/\$\{[^`]*?\}/g)

const literalsIn = (code: string): readonly string[] => {
  const found: string[] = []

  for (const match of code.matchAll(QUOTED)) {
    found.push(match[2] ?? '')
  }

  for (const match of code.matchAll(TEMPLATE)) {
    found.push(...staticSegmentsOf(match[1] ?? ''))
  }

  return found
}

/**
 * Les attributs dont la valeur est **lue par quelqu'un** : le nom accessible
 * d'un contrôle, une infobulle, un texte de remplacement, un libellé passé en
 * prop. Le suffixe plutôt que le nom exact, sans quoi `openLabel=` échapperait
 * à `label=`.
 */
const DISPLAY_ATTRIBUTE =
  /[\s{]([A-Za-z-]*(?:label|title|description|placeholder|alt|caption|heading|tooltip|message))=/gi

const displayedInAttributes = (code: string): readonly string[] => {
  const found: string[] = []

  for (const match of code.matchAll(DISPLAY_ATTRIBUTE)) {
    const start = (match.index ?? 0) + match[0].length
    const first = code[start]

    if (first === '"' || first === "'") {
      const end = code.indexOf(first, start + 1)

      if (end !== -1) {
        found.push(code.slice(start + 1, end))
      }
    } else if (first === '{') {
      const end = balancedEnd(code, start, '{', '}')

      // Accolade jamais refermée : on lit jusqu'à la fin plutôt que de rien
      // lire — l'extraction ne blanchit rien, elle ne peut donc pas éteindre
      // ce qui suit.
      found.push(...literalsIn(code.slice(start + 1, end === UNBALANCED ? undefined : end)))
    }
  }

  return found
}

/** Une valeur d'attribut, pour la retirer d'une région d'enfants JSX. */
const ATTRIBUTE = /[A-Za-z-]+=(?:"[^"]*"|'[^']*'|\{)/g

const blankAttributes = (region: string): string => {
  let out = region
  let from = 0

  for (;;) {
    ATTRIBUTE.lastIndex = from

    const match = ATTRIBUTE.exec(out)

    if (match === null) {
      return out
    }

    const start = match.index
    const last = start + match[0].length - 1
    const end = out[last] === '{' ? balancedEnd(out, last, '{', '}') : last

    if (end === UNBALANCED) {
      from = last + 1

      continue
    }

    out = `${out.slice(0, start)}${' '.repeat(end - start + 1)}${out.slice(end + 1)}`
    from = end + 1
  }
}

/**
 * Les enfants d'un élément JSX : une accolade ouverte juste après un `>`, et
 * refermée juste avant une balise.
 *
 * `[^=]>` écarte le corps d'une fonction fléchée (`=> {`), et l'exigence d'une
 * balise derrière écarte le corps d'une fonction dont le type de retour est
 * générique (`): Promise<void> {`) — les deux faux positifs mesurés sur le
 * dépôt. Les valeurs d'attribut portées par un enfant JSX sont blanchies : elles
 * relèvent de la famille précédente, qui sait lesquelles sont affichées.
 */
const displayedInChildren = (code: string): readonly string[] => {
  const found: string[] = []

  for (const match of code.matchAll(/[^=]>\s*\{/g)) {
    const start = code.indexOf('{', match.index ?? 0)

    if (start === -1) {
      continue
    }

    const end = balancedEnd(code, start, '{', '}')

    if (end === UNBALANCED || !/^\s*</.test(code.slice(end + 1))) {
      continue
    }

    found.push(...literalsIn(blankAttributes(code.slice(start + 1, end))))
  }

  return found
}

/** Ni accolade ni ponctuation de code : ce qui écarte `Promise<Response>`. */
const CODE_FREE = '[^<>{}();=|&$#@\\\\/*+\\[\\]`]'

/**
 * Le texte écrit directement dans le balisage — y compris **collé à une
 * expression**, que l'ancienne version rejetait en bloc dès qu'une accolade
 * apparaissait : `<p>Bonjour {nom}, bienvenue</p>` ne laissait rien voir.
 */
const displayedAsText = (code: string): readonly string[] => {
  const found: string[] = []

  for (const match of code.matchAll(new RegExp(`>(${CODE_FREE}+)<`, 'g'))) {
    found.push(match[1] ?? '')
  }

  for (const match of code.matchAll(new RegExp(`>(${CODE_FREE}*)\\{`, 'g'))) {
    found.push(match[1] ?? '')
  }

  for (const match of code.matchAll(new RegExp(`\\}(${CODE_FREE}*)</`, 'g'))) {
    found.push(match[1] ?? '')
  }

  return found
}

/* ------------------------------------------------------------------------- *
 * Le jugement, en deux niveaux — parce que le contexte décide de ce qu'un mot
 * unique veut dire.
 * ------------------------------------------------------------------------- */

/**
 * De la prose, où qu'elle soit : un caractère accentué, deux mots séparés par
 * une espace, ou **un fragment** — un mot bordé d'une espace, ce qu'un morceau
 * de phrase concaténé porte toujours et qu'un identifiant ne porte jamais.
 *
 * Le fragment est ce qui manquait : `'Bonjour ' + nom` n'a ni accent ni deux
 * mots, et passait.
 */
const PROSE = /[À-ÿ]|(?:\p{L}{2,}[\u0020\u00a0]+\p{L}{2,})/u
const WORD = /\p{L}{2,}/u
const FRAGMENT = /^\s|\s$/

const isProse = (value: string): boolean =>
  PROSE.test(value) || (WORD.test(value) && FRAGMENT.test(value))

/** Un identifiant à bosse : `ComponentProps`, `VariantProps`. Pas un mot. */
const IDENTIFIER = /^[\s,.:;]*[A-Za-z_$][A-Za-z0-9_$]*\s*$/
const CAMEL_HUMP = /\p{Ll}\p{Lu}/u
/** Un morceau d'URL ou de requête : `?reset=1`. */
const URLISH = /[=&]|^\s*[?#/]/

/**
 * Dans une position **affichée** — nœud de texte, enfant, attribut lu —, un
 * seul mot suffit : « Fermer » est du texte, et c'en était un dans
 * `packages/ui/src/components/sheet.tsx` jusqu'à cette revue.
 */
const isDisplayedProse = (value: string): boolean =>
  isProse(value) ||
  (WORD.test(value) && !URLISH.test(value) && !(IDENTIFIER.test(value) && CAMEL_HUMP.test(value)))

/** Les directives de module ne sont pas du texte affiché. */
const DIRECTIVE = /^use (client|server)$/

/** Toutes les chaînes qu'un fichier écrit, quelle que soit leur forme. */
const displayedStringsOf = (source: string): readonly string[] => {
  const code = neutralise(source)

  return [
    ...new Set([
      ...literalsIn(code),
      ...displayedInAttributes(code),
      ...displayedInChildren(code),
      ...displayedAsText(code).map((value) => value.trim()),
    ]),
  ]
}

/** Ce qui ressemble à une clé de traduction : `module.chemin.de.clé`. */
const KEY_PATTERN = /^[a-z][a-zA-Z0-9-]*(?:\.[a-zA-Z0-9]+)+$/

/** Le texte affiché qu'un fichier écrit en dur, dans toutes les formes balayées. */
const hardcodedIn = (source: string): readonly string[] => {
  const code = neutralise(source)
  const suspects = [
    ...literalsIn(code).filter(isProse),
    ...displayedInAttributes(code).filter(isDisplayedProse),
    ...displayedInChildren(code).filter(isDisplayedProse),
    ...displayedAsText(code).filter(isDisplayedProse),
  ]

  return [...new Set(suspects)].filter(
    (value) => !DIRECTIVE.test(value.trim()) && !KEY_PATTERN.test(value.trim()),
  )
}

/**
 * Les formes essayées **contre** ce filet, une à une, et qu'il doit voir.
 *
 * Ce n'est pas un inventaire des formes qui existent : c'est la liste de celles
 * qui ont été plantées et mesurées.
 *
 * **Ce balayage n'est plus ce qui tient le critère 3.** Il reste ici comme
 * pré-contrôle rapide, et parce qu'il voit ce qu'un rendu ne voit pas : le
 * texte écrit dans une branche non prise et dans une surface flottante fermée —
 * c'est ainsi que le « Fermer » de `packages/ui/src/components/sheet.tsx` a été
 * trouvé. Ce qui lui échappe, la seconde revue de s09 l'a mesuré (chapitre
 * « C1 — le filet élargi », `docs/reviews/s09-i18n.md`) : un mot unique sans
 * accent rangé dans un conteneur non affiché — variable, littéral d'objet,
 * tableau —, et la concaténation de fragments d'un seul mot sans espace
 * mitoyenne. C'est exactement pour cela que `tests/rendered-text.test.ts` prend
 * le problème par l'autre bout : il rend les écrans avec un catalogue
 * pseudo-locale et refuse tout ce qui n'en vient pas, quelle que soit la forme
 * de la source.
 */
const PLANTED: readonly (readonly [string, string])[] = [
  ['une phrase dans un nœud JSX', 'export const A = () => <h1>Se connecter maintenant</h1>'],
  ['un attribut accessible', 'export const B = () => <button aria-label="Fermer le panneau" />'],
  ['un littéral simple', "const message = 'Votre compte a été supprimé'"],
  [
    'un littéral gabarit interpolé',
    'export const C = () => <h2>{`Bienvenue sur votre espace ${account.name}`}</h2>',
  ],
  [
    'une phrase concaténée dans un attribut',
    "export const D = () => <p title={'Bonjour ' + account.name} />",
  ],
  [
    'un texte JSX coupé par une expression',
    'export const E = () => <p>Bonjour {name}, bienvenue</p>',
  ],
  ['un seul mot dans un nœud JSX', 'export const F = () => <h1>Bonjour</h1>'],
  ['un seul mot en placeholder', 'export const G = () => <input placeholder="Rechercher" />'],
  ['un seul mot dans une prop de libellé', 'export const H = () => <Nav openLabel="Ouvrir" />'],
  ['un seul mot dans une prop de description', 'export const I = () => <Card description="Compte" />'],
  ['un gabarit assemblé dans une fonction', 'const greet = (name: string) => `Bonjour ${name}`'],
  ['un fragment poussé dans un tableau', "const parts = ['Bonjour ', name].join('')"],
  ['un littéral rendu tel quel entre accolades', "export const J = () => <h2>{'Bienvenue'}</h2>"],
  [
    'un mot choisi par un ternaire entre accolades',
    "export const K = () => <p>{ok ? 'Actif' : 'Inactif'}</p>",
  ],
  [
    'un texte passé à une fonction dans les enfants',
    'export const L = () => <p>{format(\'Bonjour\')}</p>',
  ],
  [
    'un composant serveur',
    'export default async function Page() { return <h1>Bonjour</h1> }',
  ],
  [
    'une phrase située après un `cn(` dont un argument porte une parenthèse',
    'const c = cn(\'after:content-["("]\')\nexport const R = () => <h1>Se connecter maintenant</h1>',
  ],
  [
    'une phrase située après un `className={` que le comptage ne referme pas',
    'export const S = () => <div className={`before:content-["{"]`} />\n' +
      'export const T = () => <h1>Se connecter maintenant</h1>',
  ],
]

/**
 * Ce que le détecteur ne doit **pas** prendre pour du texte.
 *
 * Chaque ligne est un faux positif réellement rencontré en élargissant les
 * mailles ci-dessus, sur les 30 fichiers `.tsx` du dépôt : un paramètre de type
 * générique, une destructuration suivie d'une annotation, une valeur d'attribut
 * technique portée par un enfant JSX, un fragment d'URL.
 */
const NOT_TEXT: readonly (readonly [string, string])[] = [
  [
    'une liste de classes',
    'const styles = cva("inline-flex items-center gap-2 rounded-md border border-input")',
  ],
  [
    'un className',
    'export const M = () => <div className="flex flex-wrap items-center gap-3" />',
  ],
  ['un appel à cn', "const cls = cn('flex items-center', extra)"],
  [
    'une classe Tailwind portant une parenthèse',
    'const cls = cn(\'flex items-center after:content-["("]\')',
  ],
  ['un paramètre de type', 'const f = (): Promise<Response> => fetch(url)'],
  [
    'une extension de type générique',
    "export interface P extends ComponentProps<'button'>, VariantProps<typeof v> {}",
  ],
  [
    'une destructuration annotée',
    "function A({ className, ...props }: ComponentProps<'div'>) { return <div /> }",
  ],
  [
    'une clé de traduction',
    "export const N = () => <p aria-label={t('app.account.title')}>{t('app.name')}</p>",
  ],
  ['une directive de module', "'use client'"],
  ['un chemin construit', 'const href = `/${locale}/account`'],
  ['un attribut d’import', "import fr from '../messages/fr.json' with { type: 'json' }"],
  ['des enfants passés en prop', 'export const O = () => <div>{children}</div>'],
  [
    'un corps de fonction au type générique',
    'const f = <T,>(x: T) => { const kind = "json"; return kind }',
  ],
  ['une chaîne de requête', "const to = `${path('/sign-in')}?reset=1`"],
  [
    'un attribut technique dans un enfant JSX',
    "export const Q = () => <p>{ok ? <Badge variant='secondary' /> : null}</p>",
  ],
]

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

  it.each(PLANTED)('détecte %s', (_form, source) => {
    // La preuve que le détecteur mord — le même geste que la revue fera :
    // planter une chaîne en dur et regarder rougir. Les formes énumérées sont
    // celles qui ont été essayées **contre** ce filet, une à une ; ce n'est pas
    // la liste de celles qui existent.
    expect(hardcodedIn(source), source).not.toEqual([])
  })

  it.each(NOT_TEXT)('ne prend pas %s pour du texte', (_form, source) => {
    // Le pendant du cas précédent : un détecteur qui rougit sur tout serait
    // désarmé au premier `className`, et son échec serait de se faire élargir
    // les mailles jusqu'à ne plus rien voir.
    expect(hardcodedIn(source), source).toEqual([])
  })

  it('ne laisse aucun texte en dur dans les écrans et les composants livrés', () => {
    const offenders = RENDER_FILES.flatMap((file) =>
      hardcodedIn(readFileSync(file, 'utf8')).map(
        (value) => `${file.slice(REPO_ROOT.length)} : « ${value} »`,
      ),
    )

    expect(offenders, offenders.join(' ;; ')).toEqual([])
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

})

/* ------------------------------------------------------------------------- *
 * Le critère 9, éprouvé sur le comportement et non sur le texte du fichier.
 *
 * La revue de s09 a mesuré qu'une expression régulière sur la source
 * (`/onError:[\s\S]*?throw/`) restait verte sur les deux neutralisations : le
 * `[\s\S]*?` non gourmand se satisfaisait du `throw` du gestionnaire suivant.
 * La configuration est donc passée au vrai traducteur de `next-intl`, avec un
 * catalogue amputé — ce qu'un test de nœud sait faire.
 * ------------------------------------------------------------------------- */

describe('une clé manquante est refusée, jamais remplacée par elle-même', () => {
  const config = requestConfigFor(defaultLocale)

  // `createTranslator` déduit les clés admises de la **forme** du catalogue.
  // Le nôtre est assemblé à l'exécution — application plus modules activés —,
  // donc il n'a rien à déduire et refuse toute clé. Le type est posé à la main :
  // ce qui est éprouvé ici est un comportement d'exécution, pas une inférence.
  type Translate = (key: string) => string

  const translatorFor = (
    messages: Record<string, unknown>,
    onError = config.onError,
    getMessageFallback = config.getMessageFallback,
  ): Translate =>
    createTranslator({
      locale: defaultLocale,
      messages,
      onError,
      getMessageFallback,
    }) as unknown as Translate

  it('rend la traduction quand la clé existe', () => {
    // Sans ce cas, « tout lève » serait une configuration parfaitement verte et
    // parfaitement inutilisable.
    expect(translatorFor(config.messages as Record<string, unknown>)('app.name')).toBe(
      'Application',
    )
  })

  it('lève plutôt que de rendre le chemin de la clé', () => {
    const t = translatorFor({ app: {} })

    // Le repli de `next-intl` rendrait « app.manquante » à l'écran, et aucun
    // test ne verrait la différence avec une traduction.
    expect(() => t('app.manquante')).toThrowError(/app\.manquante/)
  })

  it('lève aussi quand le message existe mais ne peut pas être formaté', () => {
    const t = translatorFor({ app: { bonjour: 'Bonjour {name}' } })

    expect(() => t('app.bonjour')).toThrowError()
  })

  it('ne tait pas une erreur qui n’a aucun repli de message', () => {
    // Ce que `onError` tient **seul** : les erreurs que `use-intl` signale sans
    // jamais demander de repli — ici, un formatage de date sans fuseau
    // configuré. `getMessageFallback` n'est pas appelé sur ce chemin, donc ce
    // cas est le seul à distinguer un `onError` qui lève d'un `onError` qui
    // journalise.
    const format = createFormatter({ locale: defaultLocale, onError: config.onError })

    expect(() => format.dateTime(new Date('2026-01-01T00:00:00Z'))).toThrowError()
  })

  it('refuse encore si le premier verrou venait à être desserré', () => {
    // Le second verrou, éprouvé là où il est observable : `onError` levant en
    // premier, `getMessageFallback` n'est jamais atteint en production. C'est
    // une défense en profondeur, et celle-ci en est une vraie — pas un
    // commentaire.
    const t = translatorFor({ app: {} }, () => {})

    expect(() => t('app.manquante')).toThrowError(/app\.manquante/)
  })

  it('vaut aussi pour l’écran qui n’a plus de contexte de requête', async () => {
    // `app/global-error.tsx` remplace `app/layout.tsx` : ni provider, ni locale
    // résolue, donc il lit le catalogue de l'application directement
    // (`lib/fallback-text.ts`). Sans ce cas, ce chemin-là serait le seul du dépôt
    // où une clé absente se replierait silencieusement sur elle-même.
    const { fallbackLocale, fallbackText } = await import('../apps/web/lib/fallback-text')

    expect(fallbackLocale).toBe(defaultLocale)
    expect(fallbackText('app.name')).toBe('Application')
    expect(() => fallbackText('app.manquante')).toThrowError(/app\.manquante/)
  })

  it('n’expose la sonde de clé manquante que sur un drapeau explicite', async () => {
    // Le câblage — « cette configuration est-elle encore branchée ? » — est
    // prouvé par `e2e/i18n.spec.ts`, sur le serveur réel : c'est le seul endroit
    // où toute la chaîne existe. Ce qui se prouve ici est l'autre moitié : la
    // sonde qui rend cette preuve possible **n'existe pas** sans son drapeau,
    // donc elle n'expose rien en production.
    const { GET } = await import('../apps/web/app/api/i18n-probe/route')
    const before = process.env.I18N_MISSING_KEY_PROBE
    const database = process.env.DATABASE_URL

    process.env.DATABASE_URL ??= 'postgres://postgres:postgres@localhost:5432/app'
    delete process.env.I18N_MISSING_KEY_PROBE

    try {
      expect((await GET()).status).toBe(404)
    } finally {
      if (before !== undefined) {
        process.env.I18N_MISSING_KEY_PROBE = before
      }

      if (database === undefined) {
        delete process.env.DATABASE_URL
      }
    }
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

/* ------------------------------------------------------------------------- *
 * Le cookie de langue : premier cookie hors session du dépôt, donc celui qui
 * fixe le précédent.
 * ------------------------------------------------------------------------- */

/**
 * Les en-têtes `Set-Cookie` que **les routes de module** laissent partir.
 *
 * Le balayage part du registre de l'application : chaque route déclarée reçoit
 * une requête de même site, minimale et sans session. Ce qui est ainsi observé,
 * ce sont les réponses qu'une route rend **sans configuration ni session** —
 * les autres refusent avant d'écrire quoi que ce soit (401) ou réclament leur
 * configuration, et ne posent alors aucun cookie. C'est donc un balayage large,
 * pas une preuve d'exhaustivité : un cookie posé derrière une session ne
 * passerait pas ici.
 */
const moduleRouteSetCookies = async (): Promise<readonly string[]> => {
  // Le module `consent` est le seul, à ce jour, dont une route publique pose un
  // cookie : il lui faut sa liste de scripts pour répondre autre chose qu'une
  // erreur de configuration.
  configureConsent({ scripts: FIXTURE_CONSENT_SCRIPTS })

  try {
    const collected: string[] = []

    for (const route of moduleRegistry.routes) {
      const response = await dispatchAllowingRateLimit(
        moduleRegistry,
        new Request(`https://example.test${MODULE_ROUTE_PREFIX}${route.path}`, {
          method: route.method,
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            origin: 'https://example.test',
            referer: 'https://example.test/',
          },
          // Un corps **plausible**, pas un corps par route : celui d'un refus
          // de consentement, la seule soumission qui pose aujourd'hui un
          // cookie. Le jour où il cesse d'être valide, la garde contre le vide
          // ci-dessous rougit — le balayage ne peut pas devenir muet en
          // silence.
          body:
            route.method === 'GET' ? undefined : new URLSearchParams({ decision: 'refuse-all' }),
        }),
      ).catch(() => null)

      collected.push(...(response?.headers.getSetCookie() ?? []))
    }

    return collected
  } finally {
    resetConsentService()
  }
}

/** Les en-têtes `Set-Cookie` que le proxy laisse réellement partir. */
const setCookiesFor = (pathname: string): readonly string[] =>
  proxy(
    new NextRequest(new URL(`https://example.test${pathname}`), {
      headers: { 'accept-language': 'fr' },
    }),
  ).headers.getSetCookie()

describe('aucun cookie ne part sans les attributs du socle', () => {
  it('pose le choix de langue en HttpOnly, Secure et SameSite', () => {
    // `docs/security.md` §1 ne pose aucune condition : « HttpOnly, Secure,
    // SameSite=Lax au minimum », et nomme la commande qui doit le tenir — un
    // test sur l'en-tête `Set-Cookie`. Il n'existait pour aucun cookie hors
    // session. Rien côté client ne lit `app_locale` : le sélecteur est une
    // liste de liens, et c'est le proxy qui écrit, côté serveur.
    const cookies = setCookiesFor('/en/account')

    // La garde contre le vide : dans l'état où le projet sert plusieurs
    // langues, suivre une URL préfixée **doit** poser le choix, sans quoi tout
    // ce qui suit serait vrai sur zéro cookie. Une seule langue servie, aucun
    // cookie n'est posé et il n'y a rien à contrôler.
    if (localeRouting.locales.length > 1) {
      expect(cookies.some((cookie) => cookie.startsWith(`${LOCALE_COOKIE}=`))).toBe(true)
    }

    for (const cookie of cookies) {
      expect(cookie, cookie).toMatch(/;\s*HttpOnly/i)
      expect(cookie, cookie).toMatch(/;\s*Secure/i)
      expect(cookie, cookie).toMatch(/;\s*SameSite=/i)
    }
  })

  it('construit ce `NextRequest` avec le même `next` que le proxy consomme', () => {
    // Le cas ci-dessus traverse une frontière de paquet : la requête est
    // construite depuis la racine, le proxy vit dans `apps/web`. Deux copies de
    // `next` dans le magasin — pnpm en installe une par ensemble de pairs — et
    // ce test deviendrait faux le jour où Next ajouterait un `instanceof`.
    // Aujourd'hui les deux résolutions désignent le même fichier ; la ligne
    // suivante est ce qui le dira si cela change.
    const resolveFrom = (workspace: string): string =>
      createRequire(join(REPO_ROOT, workspace, 'package.json')).resolve('next/server')

    expect(resolveFrom('apps/web')).toBe(resolveFrom('.'))
  })

  it('voit aussi les cookies posés par les routes de module', async () => {
    // Le filet portait le nom du contrôle de socle et ne balayait que le proxy :
    // retirer `HttpOnly` de `consentSetCookie` ne faisait rougir que le test du
    // module (revue de s36, constat C6). Il balaie maintenant **le registre**,
    // et non une liste de chemins écrite à la main : une route ajoutée demain
    // entre dans le balayage sans que personne y pense.
    const cookies = await moduleRouteSetCookies()

    // La garde contre le vide : sans une route qui pose réellement un cookie,
    // tout ce qui suit serait vrai sur zéro en-tête.
    expect(cookies.length).toBeGreaterThan(0)

    for (const cookie of cookies) {
      expect(cookie, cookie).toMatch(/;\s*HttpOnly/i)
      expect(cookie, cookie).toMatch(/;\s*Secure/i)
      expect(cookie, cookie).toMatch(/;\s*SameSite=/i)
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
      findByIds: () => Promise.resolve([]),
      // s37b2 : aucune liste d'administration n'est rendue par cette suite.
      search: () => Promise.resolve({ accounts: [], total: 0 }),
      summaryOf: () => Promise.resolve(null),
      markEmailVerified: () => Promise.resolve(false),
      changeEmail: () => Promise.resolve(false),
      changeName: () => Promise.resolve(false),
      deleteById: () => Promise.resolve(false),
      // s37a : la doublure refuse **fermé** — un compte qu'elle ne connaît pas
      // est banni. Aucun cas de ce fichier n'ouvre de session ; ce qui compte
      // est qu'elle ne dise pas « non banni » par défaut.
      isBanned: () => Promise.resolve(true),
      setBanned: () => Promise.resolve(false),
    },
    sessions: {
      countForUser: () => Promise.resolve(0),
      listForUser: () => Promise.resolve([]),
      revokeAllForUser: () => Promise.resolve([]),
      revokeBorrowsBy: () => Promise.resolve([]),
      revokeForUser: () => Promise.resolve(false),
      // s37b1 : ce fichier mesure des langues d'email, aucune session n'y est
      // ouverte. La doublure refuse **fermé**, comme `isBanned` au-dessus.
      create: () => Promise.resolve(false),
      findById: () => Promise.resolve(null),
      deleteById: () => Promise.resolve(false),
      deleteExpiredImpersonations: () => Promise.resolve([]),
    },
    accounts: {
      listForUser: () => Promise.resolve([]),
      unlinkForUser: () => Promise.resolve('not_found' as const),
    },
    passkeys: {
      listForUser: () => Promise.resolve([]),
      countForUser: () => Promise.resolve(0),
      renameForUser: () => Promise.resolve(false),
      revokeForUser: () => Promise.resolve('not_found' as const),
    },
    tokens: {
      create: () => Promise.resolve(),
      consume: () => Promise.resolve(null),
      invalidateSiblings: () => Promise.resolve(0),
      deleteNaming: () => Promise.resolve(0),
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
    // s34 : ce fichier mesure la **langue** des emails, pas la suppression. Les
    // trois dépendances sont fournies dans leur forme fermée — la purge échoue,
    // aucune organisation ne bloque, aucune file n'existe.
    purgeScope: () =>
      Promise.resolve({ ok: false, purged: [], failed: 'auth', message: 'hors sujet ici' }),
    soleOwnerships: () => Promise.resolve([]),
    releaseOrganizations: () => Promise.resolve([]),
    jobs: {
      emit: () =>
        Promise.resolve({
          ok: false,
          error: { code: 'unknown_job', message: 'aucune file dans cette suite' },
        }),
    },
    // s39 : le port d'analytique est une dépendance du module comme le mailer.
    // Cette suite mesure la **langue des emails** : elle ne mesure rien de
    // l'analytique, et le port inerte le dit plutôt que de faire semblant.
    analytics: {
      track: () =>
        Promise.resolve({
          ok: false,
          error: { code: 'not_configured', message: 'aucune mesure dans cette suite' },
        }),
      page: () =>
        Promise.resolve({
          ok: false,
          error: { code: 'not_configured', message: 'aucune mesure dans cette suite' },
        }),
    },
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
