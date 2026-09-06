import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
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

/** Ce qui ne porte pas de composant de production : artefacts et fixtures suivis. */
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

    // Les fichiers suivis par git, et eux seuls. Un balayage du système de
    // fichiers voyait aussi les worktrees des voies parallèles, rangés sous
    // `.claude/worktrees/` : il jugeait alors l'arbre d'une autre branche, et
    // rougissait pour un fichier absent de celui-ci.
    const components = execFileSync('git', ['ls-files', '-z', '--', '*.tsx'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
      .split('\u0000')
      .filter((path) => path.length > 0)
      .filter((path) => !path.split('/').some((segment) => IGNORED_DIRECTORIES.has(segment)))
      .map((path) => join(REPO_ROOT, path))

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

  it('transcrit l’échelle de prose dans `packages/ui`, et pas dans un module optionnel', async () => {
    /*
     * L'échelle de prose est une **section du document** (« Échelle de prose —
     * un corps d'article long »), pas un objet du blog : trois stories rendent
     * du MDX (s29, s30, s31). Livrée en s29 dans
     * `@repo/module-blog/presentation`, elle obligeait tout second consommateur
     * à déclarer `requires: ['blog']` — donc à rendre la documentation
     * indisponible dès qu'on coupe le blog (ADR 055). Elle vit désormais là où
     * le design system vit en code.
     *
     * Les deux côtés sont **dérivés** : la mesure de ligne est lue dans la
     * ligne du document qui la décide, jamais recopiée ici. La changer dans le
     * document sans la changer dans le code fait rougir cette ligne.
     */
    const documented = /Mesure de ligne[^|]*\|[^|]*`([\w-]+)`/.exec(read('/docs/design-system.md'))

    expect(documented, 'la ligne « Mesure de ligne » du § Échelle de prose').not.toBeNull()

    const ui = (await import('@repo/ui')) as {
      readonly PROSE_CLASSNAME?: string
      readonly proseComponents?: Readonly<Record<string, unknown>>
    }

    expect(ui.PROSE_CLASSNAME).toContain(documented?.[1])
    // La table des éléments du corps : le document en décrit onze, et la
    // transcription doit les habiller. Un `h2` sans classe rendrait la prose
    // au style par défaut du navigateur, ce qu'aucune capture ne distingue
    // d'un thème sobre.
    expect(Object.keys(ui.proseComponents ?? {})).toContain('h2')
  })

  it('ne déclare « pas encore copié » aucun composant que le baril exporte', async () => {
    /*
     * **La commande qui manquait.** `packages/ui/AGENTS.md` porte la liste de ce
     * que le design system décrit et que ce package n'a pas encore copié, et
     * cette liste a été prise en défaut **deux fois** — `Pagination` livré par
     * s29 et resté « non copié », `Avatar` exporté depuis s18 et toujours
     * listé. Son propre commentaire le disait : « aucune commande ne confronte
     * ce tableau au baril, c'est précisément ce qui les laisse dériver ».
     *
     * Les deux côtés sont **dérivés** : les noms cités dans le paragraphe, et
     * les exports réels du baril. La comparaison est **par nom exact** — une
     * correspondance par sous-chaîne ferait couvrir `Table` par `DataTable`,
     * et la garantie serait une illusion.
     *
     * Ce que cette ligne ne dit pas : qu'un composant exporté figure bien dans
     * l'une des deux lignes du tableau. Ce sens-là demanderait de rattacher
     * `AccordionContent` à `Accordion`, donc exactement la correspondance par
     * sous-chaîne qu'on vient d'écarter.
     */
    const agents = read('/packages/ui/AGENTS.md')
    const start = agents.indexOf('Le reste de l')
    const end = agents.indexOf('copié**', start)

    expect(start, 'le paragraphe « le reste de l’inventaire »').toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)

    const claimed = [
      ...new Set(
        [...agents.slice(start, end).matchAll(/`(\w+)`/g)].map((match) => match[1] ?? ''),
      ),
    ]

    // Garde contre l'inertie : une extraction qui ne trouve rien passerait.
    expect(claimed.length).toBeGreaterThan(10)

    const exported = new Set(Object.keys(await import('@repo/ui')))

    expect(claimed.filter((name) => exported.has(name))).toEqual([])
  })

  it('ne déclare « absent » aucun composant que le baril exporte, et compte ce qu’il liste', async () => {
    /*
     * **La commande que la note du document réclamait.** `docs/design-system.md`
     * porte une note datée disant quels composants du tableau n'existent pas
     * dans `packages/ui` ; elle-même écrivait « tant qu'aucun test ne le fait,
     * ce paragraphe est de la documentation, pas une règle ». Elle a été prise
     * en défaut le jour de son écriture : `Table` y figurait alors que s37b2
     * l'avait livré et que le baril l'exporte (constat 3 de la revue de s46).
     *
     * Deux côtés dérivés, comme pour `packages/ui/AGENTS.md` juste au-dessus :
     * les noms cités dans la note, et les exports réels du baril. Le **nombre**
     * écrit dans la note est confronté à la liste qu'elle donne — un compte
     * tapé à la main vieillit à côté de sa propre liste.
     *
     * Ce que cette ligne **ne** dit **pas** : qu'un composant du tableau absent
     * du baril figure bien dans la note. Ce sens-là rougirait sur
     * `NotificationCenter`, `PricingTable` et `Stepper`, qui vivent dans des
     * modules et non dans `packages/ui`.
     */
    const document = read('/docs/design-system.md')
    const start = document.indexOf('**Absents de')

    expect(start, 'la note « Absents de `packages/ui/src` »').toBeGreaterThan(0)

    const segment = document.slice(start, document.indexOf('.', document.indexOf(':', start)))
    const claimed = [...new Set([...segment.matchAll(/`(\w+)`/g)].map((match) => match[1] ?? ''))]
    const written = Number(/—\s*(\d+)\*\*/.exec(segment)?.[1] ?? Number.NaN)

    // Garde contre l'inertie : une extraction qui ne trouve rien passerait.
    expect(claimed.length).toBeGreaterThan(5)
    expect(written, segment).toBe(claimed.length)

    const exported = new Set(Object.keys(await import('@repo/ui')))

    expect(claimed.filter((name) => exported.has(name))).toEqual([])
  })

  it('n’a pas de fichier de configuration JavaScript (Tailwind v4, ADR 010)', () => {
    // Un `tailwind.config.js` déposé à côté serait lu par Tailwind v4 s'il
    // était référencé, et surtout : il ferait croire au prochain agent que la
    // configuration est en JavaScript. La configuration est en CSS.
    expect(() => read('/tailwind.config.js')).toThrow()
    expect(() => read('/packages/ui/tailwind.config.js')).toThrow()
    expect(() => read('/apps/web/tailwind.config.js')).toThrow()
  })

  /**
   * **Les pages qu'une pagination rend** — la seule règle de calcul du design
   * system, donc la seule chose de `packages/ui` qui s'éprouve hors d'un
   * navigateur (revue de s37b2, constat F4).
   *
   * `Pagination` a été écrit pour le blog (s29), qui compte ses pages sur une
   * main : il rendait **une ancre par page**, sans borne. Les listes de
   * plateforme de s37b2 paginent un domaine qui en autorise 10 000 — donc
   * 10 000 ancres dans une seule `<nav>`, sur un écran qu'un superadmin ouvre
   * pour chercher un compte.
   *
   * **Ni classe, ni balisage** : `packages/ui/AGENTS.md` refuse le test de rendu
   * par composant, et à juste titre. Ce qui est mesuré est une **fonction
   * pure** — quelles pages, dans quel ordre ; ce que le composant en fait se
   * regarde dans un navigateur.
   *
   * **Ici plutôt que dans `packages/ui/src`**, où la règle du dépôt le mettrait
   * : ce paquet n'a aucun fichier de test, et en ouvrir un a fait dépasser son
   * délai à un cas d'un **autre** fichier (`tests/rgpd-screens.test.ts`, un
   * import à froid de la coquille applicative sous 5 s), mesuré trois fois de
   * suite et vert dès que le fichier disparaît. Le coût d'une suite est
   * dominé par le **fichier**, pas par le cas ; celui-ci rejoint donc le fichier
   * qui tient déjà `packages/ui` contre son document.
   */
  describe('la fenêtre de pagination', () => {
    it('rend toutes les pages tant qu’elles tiennent dans la fenêtre', async () => {
      const { PAGINATION_WINDOW, paginationWindow } = await import('@repo/ui')

      // La borne exacte : le blog ne change pas de rendu tant qu'il reste
      // dessous.
      expect(paginationWindow(1, 1)).toEqual([1])
      expect(paginationWindow(2, 3)).toEqual([1, 2, 3])
      expect(paginationWindow(4, PAGINATION_WINDOW)).toEqual(
        Array.from({ length: PAGINATION_WINDOW }, (_unused, index) => index + 1),
      )
    })

    it('borne le nombre d’ancres, quelle que soit la taille du domaine', async () => {
      const { PAGINATION_WINDOW, paginationWindow } = await import('@repo/ui')

      // 10 000 pages, c'est ce que le domaine du back-office autorise.
      expect(paginationWindow(5_000, 10_000)).toHaveLength(PAGINATION_WINDOW)
      expect(paginationWindow(1, 10_000)).toHaveLength(PAGINATION_WINDOW)
      expect(paginationWindow(10_000, 10_000)).toHaveLength(PAGINATION_WINDOW)
    })

    it('centre la fenêtre sur la page courante, et la contient toujours', async () => {
      const { PAGINATION_WINDOW, paginationWindow } = await import('@repo/ui')
      const middle = paginationWindow(5_000, 10_000)

      expect(middle).toContain(5_000)
      expect(middle[0]).toBe(5_000 - (PAGINATION_WINDOW - 1) / 2)
      expect(middle.at(-1)).toBe(5_000 + (PAGINATION_WINDOW - 1) / 2)
    })

    it('colle aux bords plutôt que de sortir du domaine', async () => {
      const { paginationWindow } = await import('@repo/ui')

      // Aux extrémités, la fenêtre glisse : elle ne propose jamais une page 0
      // ni une page au-delà de la dernière, et elle garde sa taille.
      expect(paginationWindow(1, 10_000)[0]).toBe(1)
      expect(paginationWindow(2, 10_000)[0]).toBe(1)
      expect(paginationWindow(10_000, 10_000).at(-1)).toBe(10_000)
      expect(paginationWindow(9_999, 10_000).at(-1)).toBe(10_000)
    })

    it('rend une suite contiguë et croissante, sans doublon', async () => {
      const { paginationWindow } = await import('@repo/ui')

      for (const page of [1, 2, 7, 4_999, 5_000, 9_998, 10_000]) {
        const pages = paginationWindow(page, 10_000)

        expect(pages).toEqual(
          Array.from({ length: pages.length }, (_unused, index) => (pages[0] ?? 0) + index),
        )
      }
    })
  })
})
