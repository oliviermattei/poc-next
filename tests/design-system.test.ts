import { readFileSync } from 'node:fs'
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

  it('n’a pas de fichier de configuration JavaScript (Tailwind v4, ADR 010)', () => {
    // Un `tailwind.config.js` déposé à côté serait lu par Tailwind v4 s'il
    // était référencé, et surtout : il ferait croire au prochain agent que la
    // configuration est en JavaScript. La configuration est en CSS.
    expect(() => read('/tailwind.config.js')).toThrow()
    expect(() => read('/packages/ui/tailwind.config.js')).toThrow()
    expect(() => read('/apps/web/tailwind.config.js')).toThrow()
  })
})
