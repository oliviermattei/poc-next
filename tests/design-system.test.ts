import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * **`docs/design-system.md` fait autorité, et voici la commande qui le vérifie.**
 *
 * s08 est la première story d'interface : quinze écrans hériteront de ces
 * tokens. Un token inventé ici devient la norme du produit, et le design system
 * cesse de faire autorité dès la première divergence — sans que rien ne
 * rougisse, puisqu'une couleur écrite à la main s'affiche parfaitement.
 *
 * Ce fichier n'est pas un inventaire figé contre sa propre copie : les deux
 * artefacts ont des auteurs différents et des rôles opposés. Le document est la
 * décision, la feuille de style en est la transcription. C'est la même forme de
 * garde que `tests/env-example.test.ts`, qui confronte `.env.example` au schéma
 * plutôt qu'à lui-même.
 *
 * Ce qui est balayé : le nom **et** la valeur de chaque variable des blocs
 * `:root` et `.dark`, dans les deux sens (aucune manquante, aucune en trop), et
 * l'exposition de chaque couleur à Tailwind. Ce qui ne l'est pas : ce qu'un
 * composant en fait — un composant qui écrirait `bg-zinc-800` passerait ce
 * fichier, et c'est la revue de design qui l'attrape.
 */

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** Ce qui ne porte pas de composant de production : dépendances, artefacts, fixtures. */
const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.next',
  '.turbo',
  'test-results',
  'playwright-report',
  'fixtures',
])

const read = (path: string): string => readFileSync(`${REPO_ROOT}${path}`, 'utf8')

/** Les déclarations `--nom: valeur;` d'un bloc, dans l'ordre du fichier. */
const declarationsOf = (source: string, selector: string): Map<string, string> => {
  const start = source.indexOf(`${selector} {`)

  if (start === -1) {
    throw new Error(`Bloc « ${selector} » introuvable.`)
  }

  const block = source.slice(start, source.indexOf('\n}', start))

  return new Map(
    [...block.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)].map((match) => [
      match[1] ?? '',
      (match[2] ?? '').trim(),
    ]),
  )
}

/** Le bloc CSS du design system : c'est lui, la décision. */
const designSystemCss = (): string => {
  const document = read('/docs/design-system.md')
  const start = document.indexOf('```css')

  return document.slice(start, document.indexOf('```', start + 6))
}

const STYLESHEET = read('/packages/ui/src/styles.css')

describe('les tokens de `packages/ui` sont ceux du design system', () => {
  it.each([':root', '.dark'])('%s — même noms, mêmes valeurs', (selector) => {
    const expected = declarationsOf(designSystemCss(), selector)
    const actual = declarationsOf(STYLESHEET, selector)

    // Une garde contre l'inertie : une extraction qui ne trouve rien rendrait
    // l'égalité vraie sur deux ensembles vides.
    expect(expected.size).toBeGreaterThan(20)
    expect(Object.fromEntries(actual)).toEqual(Object.fromEntries(expected))
  })

  it('expose chaque couleur à Tailwind, sans quoi elle n’a aucun utilitaire', () => {
    // Un token déclaré mais absent de `@theme` ne produit ni `bg-…` ni
    // `text-…` : il existe dans la feuille de style et nulle part dans les
    // composants. La règle « utiliser les tokens sémantiques » serait alors
    // intenable, et c'est `bg-zinc-800` qui reviendrait.
    const theme = declarationsOf(STYLESHEET, '@theme inline')
    const colors = [...declarationsOf(designSystemCss(), ':root').keys()].filter(
      (name) => name !== '--radius',
    )

    expect(colors.length).toBeGreaterThan(20)

    for (const token of colors) {
      expect(theme.get(`--color-${token.slice(2)}`), token).toBe(`var(${token})`)
    }
  })

  it('dérive le rayon comme le design system le fixe', () => {
    const theme = declarationsOf(STYLESHEET, '@theme inline')

    expect(Object.fromEntries([...theme].filter(([name]) => name.startsWith('--radius')))).toEqual({
      '--radius-sm': 'calc(var(--radius) - 4px)',
      '--radius-md': 'calc(var(--radius) - 2px)',
      '--radius-lg': 'var(--radius)',
      '--radius-xl': 'calc(var(--radius) + 4px)',
    })
  })

  it('pilote le thème sombre par la classe, jamais par la seule préférence système', () => {
    // Le commutateur doit pouvoir **contredire** le système. Sans cette
    // variante, `dark:` suit `prefers-color-scheme` et le choix de
    // l'utilisateur reste sans effet sur tout ce que Tailwind génère.
    expect(STYLESHEET).toContain('@custom-variant dark (&:where(.dark, .dark *));')
  })

  it('balaie tout fichier qui porte des composants — sinon leurs classes n’existent pas', () => {
    /*
     * Tailwind v4 tourne ici en `source(none)` : rien n'est détecté
     * automatiquement, chaque source est déclarée. Une classe employée dans un
     * fichier qu'aucune source ne couvre ne produit aucune règle, et **rien
     * n'échoue** — mesuré en s10, à l'œil : la grille des fonctionnalités
     * restait sur une colonne à 1280 px et les liens du pied de page se
     * touchaient, parce que le dossier de présentation des modules n'était
     * couvert par aucune source.
     *
     * Les deux côtés sont **dérivés** : les fichiers `.tsx` du dépôt, et les
     * motifs réellement déclarés dans les deux feuilles. Le prochain package à
     * composants fait rougir cette ligne au lieu d'être livré sans style.
     *
     * Deux formes de source, et Tailwind les traite différemment — mesuré :
     * un chemin sans motif ni extension est un **dossier**, balayé en entier ;
     * un chemin contenant un `*` est un **motif de fichiers**, et
     * `.../presentation` (sans `/**\/*.tsx`) ne matche alors aucun fichier.
     */
    const sourcePatterns = (file: string): readonly string[] => {
      const directory = join(REPO_ROOT, file, '..')

      return [...read(`/${file}`).matchAll(/@source\s+'([^']+)'/g)].map((match) =>
        resolve(directory, match[1] ?? ''),
      )
    }

    const escape = (value: string): string => value.replace(/[.+?^${}()|[\]\\]/g, '\\$&')

    const toRegExp = (pattern: string): RegExp => {
      if (!pattern.includes('*')) {
        // Un dossier : tout ce qu'il contient est balayé.
        return new RegExp(`^${escape(pattern)}/`)
      }

      const body = escape(pattern)
        .replaceAll('**/', '\u0000')
        .replaceAll('**', '\u0001')
        .replaceAll('*', '[^/]*')
        .replaceAll('\u0000', '(?:[^/]*/)*')
        .replaceAll('\u0001', '.*')

      return new RegExp(`^${body}$`)
    }

    const patterns = [
      ...sourcePatterns('packages/ui/src/styles.css'),
      ...sourcePatterns('apps/web/app/globals.css'),
    ].map(toRegExp)

    const components: string[] = []

    const walk = (current: string): void => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const path = join(current, entry.name)

        if (entry.isDirectory()) {
          if (!IGNORED_DIRECTORIES.has(entry.name)) {
            walk(path)
          }
        } else if (entry.name.endsWith('.tsx')) {
          components.push(path)
        }
      }
    }

    walk(REPO_ROOT)

    // Garde contre l'inertie : un balayage qui ne trouve rien rendrait la
    // boucle suivante vraie sur zéro fichier.
    expect(components.length).toBeGreaterThan(15)

    for (const file of components) {
      expect(
        patterns.some((pattern) => pattern.test(file)),
        `${file.slice(REPO_ROOT.length)} n’est couvert par aucun @source`,
      ).toBe(true)
    }
  })

  it('n’a pas de fichier de configuration JavaScript (Tailwind v4, ADR 010)', () => {
    // Un `tailwind.config.js` déposé à côté serait lu par Tailwind v4 s'il
    // était référencé, et surtout : il ferait croire au prochain agent que la
    // configuration est en JavaScript. La configuration est en CSS.
    expect(() => read('/tailwind.config.js')).toThrow()
    expect(() => read('/packages/ui/tailwind.config.js')).toThrow()
    expect(() => read('/apps/web/tailwind.config.js')).toThrow()
  })
})
