import { describe, expect, it } from 'vitest'

import { deliveredContrastInput } from '../scripts/contrast-sources'
import {
  type ComponentSource,
  composite,
  CONTRAST_MODES,
  CONTRAST_THRESHOLDS,
  type ContrastMeasurement,
  type ContrastPair,
  contrastNotes,
  contrastRatio,
  contrastReport,
  measureContrast,
  MINIMUM_PAIRED_SOURCES,
  MINIMUM_SURFACES,
  MINIMUM_SWEPT_FILES,
  MINIMUM_TINTED_PAIRS,
  parseColor,
  sweptComponentNames,
  thresholdOf,
  toHex,
} from '../scripts/contrast-rules'

/**
 * **Le calcul de contraste, éprouvé avant d'être cru** (s49).
 *
 * C'est le risque numéro un de cette story : une conversion OKLCH → sRGB fausse
 * rendrait `pnpm test:contrast` **verte sur des couleurs illisibles**, et le
 * dépôt gagnerait une garde qui ne garde rien. Les cas ci-dessous posent donc
 * des paires **indépendantes de ce dépôt** — noir sur blanc, la paire limite de
 * référence WCAG, les primaires sRGB en OKLCH — dont les valeurs sont publiées
 * ailleurs que dans ce fichier.
 *
 * Ce qui est balayé ici : la conversion, la composition d'une couleur à alpha,
 * le rapport de contraste. Ce qui ne l'est pas : le rendu réel du navigateur —
 * c'est la vérification visuelle de la story qui le dit.
 */

/** Une paire d'essai : le verdict s'éprouve sans dépendre d'une dérivation. */
const pairFixture = (
  overrides: Partial<ContrastPair> & Pick<ContrastPair, 'variant' | 'kind' | 'ratio'>,
): ContrastPair => ({
  source: 'essai',
  mode: 'clair',
  foregroundToken: `--${overrides.variant}-foreground`,
  backgroundToken: `--${overrides.variant}`,
  backgroundAlpha: 1,
  surfaceToken: '--card',
  threshold: thresholdOf(overrides.kind),
  ...overrides,
})

describe('la conversion des couleurs, sur des références extérieures au dépôt', () => {
  it.each([
    // Les primaires sRGB exprimées en OKLCH — valeurs publiées, reproductibles
    // par n'importe quel convertisseur. Elles éprouvent la chroma et la teinte,
    // que l'axe achromatique ne touche pas.
    ['oklch(0.62796 0.25768 29.234)', '#ff0000'],
    ['oklch(0.86644 0.29483 142.4953)', '#00ff00'],
    ['oklch(0.45201 0.31321 264.052)', '#0000ff'],
    ['oklch(1 0 0)', '#ffffff'],
    ['oklch(0 0 0)', '#000000'],
    // **Le demi-ton achromatique, et il n'est pas décoratif.** Les cinq cas
    // ci-dessus sont tous à un **coin du gamut** (0 ou 1 sur chaque canal), là
    // où la fonction de transfert sRGB est l'identité : supprimer l'encodage
    // gamma les laisse tous verts — mesuré en revue de s49. Celui-ci est au
    // milieu, donc il traverse l'encodage : `oklch(0.5 0 0)` a pour luminance
    // linéaire L³ = 0,125, que l'encodage porte à 1,055 × 0,125^(1/2,4) − 0,055
    // ≈ 0,3886, soit 99 sur 255 — `#636363`, ce que rend n'importe quel
    // convertisseur. Sans encodage, il rendrait `#202020`.
    ['oklch(0.5 0 0)', '#636363'],
  ])('rend %s en %s', (oklch, hex) => {
    const [r, g, b] = parseColor(oklch).rgb
    const [er, eg, eb] = parseColor(hex).rgb

    expect(r).toBeCloseTo(er, 2)
    expect(g).toBeCloseTo(eg, 2)
    expect(b).toBeCloseTo(eb, 2)
    expect(toHex(parseColor(oklch).rgb)).toBe(hex)
  })

  it('lit l’alpha d’un token, en pourcentage comme en fraction', () => {
    expect(parseColor('oklch(1 0 0 / 10%)').alpha).toBeCloseTo(0.1, 6)
    expect(parseColor('oklch(1 0 0 / 0.15)').alpha).toBeCloseTo(0.15, 6)
    expect(parseColor('oklch(1 0 0)').alpha).toBe(1)
  })

  it('refuse une couleur qu’elle ne sait pas lire, plutôt que de rendre du noir', () => {
    // Une couleur illisible rendue en noir ferait passer n'importe quelle paire
    // sur fond clair : c'est un faux vert, pas une valeur par défaut.
    expect(() => parseColor('var(--warning)')).toThrow(/var\(--warning\)/)
  })
})

describe('le rapport de contraste, sur les paires connues de WCAG', () => {
  const ratio = (foreground: string, background: string): number =>
    contrastRatio(parseColor(foreground).rgb, parseColor(background).rgb)

  it('donne 21 : 1 entre le noir et le blanc', () => {
    expect(ratio('#000000', '#ffffff')).toBeCloseTo(21, 5)
  })

  it('donne 1 : 1 entre une couleur et elle-même', () => {
    expect(ratio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
    expect(ratio('oklch(0.79 0.16 86)', 'oklch(0.79 0.16 86)')).toBeCloseTo(1, 5)
  })

  it('classe la paire limite de référence, #767676 sur blanc, juste au-dessus de 4,5 : 1', () => {
    // La couleur la plus claire qui passe encore AA sur blanc : elle est citée
    // partout, et un calcul faux la manque des deux côtés.
    expect(ratio('#767676', '#ffffff')).toBeCloseTo(4.54, 2)
    expect(ratio('#777777', '#ffffff')).toBeLessThan(4.5)
  })

  it('donne 6 : 1 entre le demi-ton achromatique d’OKLCH et le blanc', () => {
    // La seule référence de ce fichier qui exerce **à la fois** la conversion
    // OKLCH et la fonction de transfert sRGB, et elle se dérive à la main :
    // l'axe achromatique d'OKLab pose Y = L³, donc `oklch(0.5 0 0)` a pour
    // luminance relative 0,125, et (1 + 0,05) / (0,125 + 0,05) = 6 exactement.
    // Les paires WCAG ci-dessus sont en hexadécimal — elles ne traversent
    // jamais le convertisseur —, et noir sur blanc reste 21 : 1 même sans
    // encodage gamma. Celle-ci non : sans encodage elle vaut ≈ 16,3 : 1.
    expect(ratio('oklch(0.5 0 0)', '#ffffff')).toBeCloseTo(6, 4)
  })

  it('est symétrique — le rapport ne dépend pas de l’ordre', () => {
    expect(ratio('#767676', '#ffffff')).toBeCloseTo(ratio('#ffffff', '#767676'), 10)
  })
})

describe('la composition d’une couleur à alpha sur un fond', () => {
  it('compose du noir à 50 % sur blanc en un gris exactement médian', () => {
    // Vérifiable à la main : CSS compose dans l'espace sRGB **encodé**, donc
    // 0 × 0,5 + 1 × 0,5 = 0,5 sur chaque canal. Le résultat n'est pas la
    // moyenne des luminances — la confondre avec elle donnerait 0,73.
    const composed = composite(parseColor('oklch(0 0 0 / 50%)'), parseColor('#ffffff'))

    expect(composed.rgb[0]).toBeCloseTo(0.5, 10)
    expect(composed.rgb[1]).toBeCloseTo(0.5, 10)
    expect(composed.rgb[2]).toBeCloseTo(0.5, 10)
    expect(composed.alpha).toBe(1)

    // Et le contraste de ce gris médian sur blanc, calculable à la main depuis
    // la luminance relative de 0,5 : ((0,5 + 0,055) / 1,055)^2,4 ≈ 0,2140.
    expect(contrastRatio(composed.rgb, parseColor('#ffffff').rgb)).toBeCloseTo(3.98, 2)
  })

  it('laisse le fond intact quand la couleur est transparente', () => {
    expect(composite(parseColor('oklch(0 0 0 / 0%)'), parseColor('#ffffff')).rgb).toEqual(
      parseColor('#ffffff').rgb,
    )
  })

  it('laisse la couleur intacte quand elle est opaque', () => {
    expect(composite(parseColor('#123456'), parseColor('#ffffff')).rgb).toEqual(
      parseColor('#123456').rgb,
    )
  })
})

describe('deux seuils, parce que deux espèces', () => {
  /**
   * **Le cœur du critère 3 de s57.** Un texte demande 4,5 : 1 ; un indicateur
   * non textuel — l'anneau de focus — demande 3 : 1. Un seuil unique serait
   * faux dans les deux sens : trop sévère pour l'anneau, ou trop laxiste pour
   * le texte si on le baissait.
   */
  it('donne 4,5 : 1 au texte et 3 : 1 à un indicateur non textuel', () => {
    expect(thresholdOf('texte')).toBe(4.5)
    expect(thresholdOf('indicateur')).toBe(3)
    expect(CONTRAST_THRESHOLDS.texte).toBe(4.5)
    expect(CONTRAST_THRESHOLDS.indicateur).toBe(3)
  })

  it('retient en échec un texte à 3,2 : 1 et laisse passer un indicateur au même rapport', () => {
    // La mesure qui bite : le même rapport, deux verdicts, parce que les deux
    // paires ne sont pas de la même espèce.
    const report = contrastReport([
      pairFixture({ variant: 'texte-faible', kind: 'texte', ratio: 3.2 }),
      pairFixture({ variant: 'anneau', kind: 'indicateur', ratio: 3.2 }),
    ])

    expect(report.failures.map((pair) => pair.variant)).toEqual(['texte-faible'])
  })

  it('retient en échec un indicateur sous 3 : 1', () => {
    const report = contrastReport([
      pairFixture({ variant: 'anneau', kind: 'indicateur', ratio: 2.59 }),
    ])

    expect(report.failures).toHaveLength(1)
    expect(report.lines.join('\n')).toContain('anneau')
  })

  it('imprime le seuil de chaque paire, jamais un seuil unique', () => {
    const lines = contrastReport([
      pairFixture({ variant: 'texte-ok', kind: 'texte', ratio: 21 }),
      pairFixture({ variant: 'anneau', kind: 'indicateur', ratio: 21 }),
    ]).lines

    expect(lines[0]).toContain('4,50')
    expect(lines[1]).toContain('3,00')
  })
})

const componentOf = (
  name: string,
  base: string,
  variants: Readonly<Record<string, string>> = {},
): ComponentSource => ({
  name,
  source: [
    `const styles = cva('${base}', {`,
    '  variants: {',
    '    variant: {',
    ...Object.entries(variants).map(([key, classes]) => `      ${key}: '${classes}',`),
    '    },',
    '  },',
    '})',
  ].join('\n'),
})

/**
 * Une feuille de style d'essai **à la forme du vrai fichier** : le
 * `@custom-variant` piégeux d'abord — une recherche littérale de `.dark`
 * tombe dessus et remonte `:root` —, puis les deux blocs, puis le
 * `@theme inline` qui décide de ce qui est une couleur.
 */
const stylesheetOf = (input: {
  readonly root: readonly string[]
  readonly dark?: readonly string[]
  readonly colours: readonly string[]
}): string =>
  [
    '@custom-variant dark (&:where(.dark, .dark *));',
    '',
    ':root {',
    ...input.root.map((line) => `  ${line}`),
    '}',
    '',
    '.dark {',
    ...(input.dark ?? []).map((line) => `  ${line}`),
    '}',
    '',
    '@theme inline {',
    ...input.colours.map((name) => `  --color-${name}: var(--${name});`),
    '}',
  ].join('\n')

const SEMANTICS = ['danger', 'succes', 'attention', 'info']

const TINTED = Object.fromEntries(
  SEMANTICS.map((name) => [name, `border-${name}/50 bg-${name}/10 text-${name}-doux`]),
)

const TOKENS = [
  '--background: oklch(1 0 0);',
  '--foreground: oklch(0.145 0 0);',
  '--card: oklch(1 0 0);',
  '--card-foreground: oklch(0.145 0 0);',
  '--popover: oklch(1 0 0);',
  '--popover-foreground: oklch(0.145 0 0);',
  '--primary: oklch(0.205 0 0);',
  '--primary-foreground: oklch(0.985 0 0);',
  '--ring: oklch(0.5 0 0);',
  ...SEMANTICS.flatMap((name) => [
    `--${name}: oklch(0.55 0 0);`,
    `--${name}-doux: oklch(0.4 0 0);`,
  ]),
]

const COLOURS = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'ring',
  ...SEMANTICS.flatMap((name) => [name, `${name}-doux`]),
]

/**
 * **Un arbre d'essai qui franchit les planchers, comme le vrai le fait.**
 *
 * Les noms de fichier sont ceux du dépôt là où la dérivation les regarde —
 * `alert.tsx` est la seule source teintée dont la surface est déclarée — et les
 * jetons sont inventés, pour que ces cas ne dépendent d'aucune valeur livrée.
 */
const DELIVERED_LIKE = {
  components: [
    componentOf('card.tsx', 'rounded-xl border bg-card py-6 text-card-foreground'),
    componentOf('sheet.tsx', 'fixed inset-y-0 flex bg-background text-foreground'),
    componentOf('dropdown-menu.tsx', 'z-50 rounded-md bg-popover p-1 text-popover-foreground'),
    componentOf('alert.tsx', 'rounded-lg border px-4 py-3 text-sm', TINTED),
    componentOf(
      'button.tsx',
      'inline-flex h-10 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
      { default: 'bg-primary text-primary-foreground hover:bg-primary/90' },
    ),
  ] as readonly ComponentSource[],

  /** La même feuille, un jeton changé : c'est ainsi qu'on prouve la dérivation. */
  stylesheetWith: (
    overrides: Readonly<Record<string, string>>,
    extra: Readonly<Record<string, string>> = {},
  ): string =>
    stylesheetOf({
      root: [
        ...TOKENS.map((line) => {
          const token = line.slice(0, line.indexOf(':'))
          const override = overrides[token]

          return override === undefined ? line : `${token}: ${override};`
        }),
        ...Object.entries(extra).map(([token, value]) => `${token}: ${value};`),
      ],
      colours: [...COLOURS, ...Object.keys(extra).map((token) => token.slice(2))],
    }),
}

/** Le même arbre, augmenté de ce qu'un cas veut y ajouter. */
const delivered = (
  extra: readonly ComponentSource[] = [],
): { components: readonly ComponentSource[]; stylesheet: string } => ({
  components: [...DELIVERED_LIKE.components, ...extra],
  stylesheet: DELIVERED_LIKE.stylesheetWith({}),
})


describe('les paires sont dérivées des fichiers livrés, jamais recopiées', () => {
  /**
   * **Ce que s57 change ici.** s49 dérivait les variantes d'un seul fichier,
   * l'`Alert`, et composait tout au-dessus d'une surface **constante**. Les
   * cas ci-dessous éprouvent la dérivation élargie : plusieurs composants, la
   * surface portée par la paire, et l'anneau de focus qu'aucun composant ne
   * « rend » mais que plusieurs portent — combien, la commande l'imprime ; le
   * recopier ici serait un nombre écrit à côté du code qui le dérive.
   */

  const ratioOf = (
    pairs: readonly ContrastPair[],
    source: string,
    variant: string,
    mode = 'clair',
  ): number => {
    const pair = pairs.find(
      (candidate) =>
        candidate.source === source && candidate.variant === variant && candidate.mode === mode,
    )

    if (pair === undefined) {
      throw new Error(`La paire « ${source}/${variant} » en mode ${mode} n’a pas été dérivée.`)
    }

    return pair.ratio
  }

  it('cesse de ne mesurer que l’`Alert` : chaque composant qui peint une paire y entre', () => {
    // Le critère 3 pris au mot. Une dérivation qui ne trouverait que l'`Alert`
    // laisserait `Badge` et `Button` — donc le défaut que la story corrige —
    // hors de toute mesure.
    const sources = new Set(measureContrast(delivered()).pairs.map((pair) => pair.source))

    expect(sources).toContain('alert.tsx')
    expect(sources).toContain('button.tsx')
    expect(sources).toContain('card.tsx')
  })

  it('fait entrer un composant ajouté demain, sans qu’on y pense', () => {
    const pairs = measureContrast(
      delivered([
        componentOf('badge.tsx', 'inline-flex rounded-md text-xs', {
          danger: 'bg-danger text-primary-foreground',
        }),
      ]),
    ).pairs

    expect(pairs.some((pair) => pair.source === 'badge.tsx' && pair.variant === 'danger')).toBe(true)
  })

  it('ne lit pas `text-sm` comme une couleur : la feuille de style dit ce qui en est une', () => {
    // Le piège nommé en s49 : le premier `text-…` d'une chaîne pouvait être
    // `text-sm`, et le contrôle résolvait alors le jeton `--sm`. Ici c'est
    // `@theme inline` qui décide, donc une taille n'est jamais une couleur.
    const pairs = measureContrast(
      delivered([
        componentOf('note.tsx', 'text-sm text-left bg-card text-card-foreground'),
      ]),
    ).pairs

    const pair = pairs.find((candidate) => candidate.source === 'note.tsx')

    expect(pair?.foregroundToken).toBe('--card-foreground')
    expect(pair?.backgroundToken).toBe('--card')
  })

  it('ne mesure pas un état conditionnel : `hover:bg-…` n’est pas la couleur au repos', () => {
    // `button.tsx` porte `hover:bg-primary/90`. Le mesurer ferait rougir la
    // commande sur une couleur que personne ne voit sans sa souris.
    const measurement = measureContrast(delivered())

    expect(
      measurement.pairs.some((pair) => pair.backgroundAlpha === 0.9),
    ).toBe(false)
    expect(measurement.stateful.join(' ')).toContain('hover:bg-primary/90')
  })

  it('suit la valeur du jeton — changer le jeton change le rapport mesuré', () => {
    const measure = (primary: string): number =>
      ratioOf(
        measureContrast({
          components: delivered().components,
          stylesheet: stylesheetOf({
            root: TOKENS.map((line) =>
              line.startsWith('--primary:') ? `--primary: ${primary};` : line,
            ),
            colours: COLOURS,
          }),
        }).pairs,
        'button.tsx',
        'default',
      )

    expect(measure('oklch(0.6 0 0)')).toBeLessThan(measure('oklch(0.205 0 0)'))
  })

  it('mesure chaque paire dans les deux modes, et lit le bloc `.dark` lui-même', () => {
    const pairs = measureContrast({
      components: delivered().components,
      stylesheet: stylesheetOf({
        root: TOKENS,
        dark: ['--card: oklch(0.2 0 0);', '--card-foreground: oklch(0.985 0 0);'],
        colours: COLOURS,
      }),
    }).pairs

    expect(new Set(pairs.map((pair) => pair.mode))).toEqual(
      new Set(CONTRAST_MODES.map((mode) => mode.label)),
    )
    expect(ratioOf(pairs, 'card.tsx', 'base', 'sombre')).not.toBeCloseTo(
      ratioOf(pairs, 'card.tsx', 'base', 'clair'),
      3,
    )
  })

  it('refuse un jeton que la feuille de style ne déclare pas', () => {
    expect(() =>
      measureContrast({
        components: delivered().components,
        stylesheet: stylesheetOf({
          root: TOKENS.filter((line) => !line.startsWith('--popover-foreground:')),
          colours: COLOURS,
        }),
      }),
    ).toThrow(/--popover-foreground/)
  })

  it('refuse deux fonds de couleur dans la même chaîne plutôt que d’en choisir un', () => {
    // `exec` rendait la **première** correspondance : un choix silencieux. Une
    // chaîne ambiguë est désormais nommée.
    expect(() =>
      measureContrast(
        delivered([componentOf('flou.tsx', 'bg-card bg-popover text-card-foreground')]),
      ),
    ).toThrow(/flou\.tsx/)
  })
})

describe('la surface cesse d’être supposée', () => {
  /**
   * **Le piège que s57 retire du fichier.** `SURFACE_TOKEN` valait `--card`
   * pour tout, et l'anneau de focus n'est jamais peint sur une carte. Une
   * paire porte désormais la surface sur laquelle elle est réellement peinte,
   * et une source teintée qui n'en déclare aucune est **refusée**.
   */

  it('compose une teinte au-dessus de la surface déclarée, pas d’une surface supposée', () => {
    // Deux feuilles qui ne diffèrent **que** par la surface : si la paire
    // teintée ne la portait pas, les deux mesures seraient identiques.
    const measure = (card: string): number => {
      const pairs = measureContrast({
        components: DELIVERED_LIKE.components,
        stylesheet: DELIVERED_LIKE.stylesheetWith({ '--card': card }),
      }).pairs

      const pair = pairs.find(
        (candidate) => candidate.source === 'alert.tsx' && candidate.variant === 'danger',
      )

      if (pair === undefined) {
        throw new Error('La paire teintée n’a pas été dérivée.')
      }

      expect(pair.surfaceToken).toBe('--card')

      return pair.ratio
    }

    expect(measure('oklch(1 0 0)')).not.toBeCloseTo(measure('oklch(0.2 0 0)'), 3)
  })

  it('laisse une paire opaque indifférente à la surface : il n’y a rien dessous qui compte', () => {
    const measure = (card: string): number => {
      const pairs = measureContrast({
        components: DELIVERED_LIKE.components,
        stylesheet: DELIVERED_LIKE.stylesheetWith({ '--card': card }),
      }).pairs

      return (
        pairs.find(
          (candidate) => candidate.source === 'button.tsx' && candidate.variant === 'default',
        )?.ratio ?? Number.NaN
      )
    }

    expect(measure('oklch(1 0 0)')).toBeCloseTo(measure('oklch(0.2 0 0)'), 10)
  })

  it('refuse une source teintée dont la surface n’est déclarée nulle part', () => {
    // Le point de la story : le jour où un composant teinté arrive, la commande
    // **force la décision** au lieu d'hériter du silence de `--card`.
    expect(() =>
      measureContrast({
        components: [
          ...DELIVERED_LIKE.components,
          {
            name: 'toast.tsx',
            source: "const styles = cva('rounded-md', { variants: { variant: { danger: 'bg-danger/10 text-danger-doux' } } })",
          },
        ],
        stylesheet: DELIVERED_LIKE.stylesheetWith({}),
      }),
    ).toThrow(/toast\.tsx/)
  })

  it('nomme un fond teinté sans texte au repos, au lieu de le laisser filer en silence', () => {
    // **La portée exacte du refus ci-dessus**, et elle est plus étroite que la
    // phrase qu'on serait tenté d'écrire : il n'y a de paire — donc de surface
    // à connaître — que si la même chaîne peint aussi du texte. Un voile
    // (`bg-foreground/50` dans `sheet.tsx` et `command.tsx`) n'a pas de texte à
    // lui : le refuser demanderait de lui déclarer une surface qui ne servirait
    // à rien, et le taire ferait croire que toute source teintée est vue. Il
    // est donc **compté et nommé**, comme les textes qui héritent de leur
    // surface et comme les couleurs d'état.
    const measurement = measureContrast(
      delivered([componentOf('voile.tsx', 'fixed inset-0 z-50 bg-foreground/50')]),
    )

    expect(measurement.tintedWithoutText.join(' ')).toContain('voile.tsx')
    expect(contrastNotes(measurement).join('\n')).toContain('voile.tsx')
  })

  it('dérive les surfaces des classes de base, jamais des remplissages d’une variante', () => {
    // Un `bg-primary` **dans** un bloc `variants:` est un remplissage de bouton,
    // pas une surface : exiger 3 : 1 de l'anneau contre lui serait impossible,
    // et il n'est de toute façon jamais peint sous l'anneau.
    const measurement = measureContrast({
      components: DELIVERED_LIKE.components,
      stylesheet: DELIVERED_LIKE.stylesheetWith({}),
    })

    expect(measurement.surfaces).toEqual(
      expect.arrayContaining(['--background', '--card', '--popover']),
    )
    expect(measurement.surfaces).not.toContain('--primary')
  })

  it('écarte une surface non opaque : elle demanderait elle-même une surface', () => {
    const measurement = measureContrast({
      components: [
        ...DELIVERED_LIKE.components,
        { name: 'separator.tsx', source: "const styles = cva('shrink-0 bg-voile')" },
      ],
      stylesheet: DELIVERED_LIKE.stylesheetWith({}, { '--voile': 'oklch(1 0 0 / 10%)' }),
    })

    expect(measurement.surfaces).not.toContain('--voile')
  })
})

describe('l’anneau de focus, mesuré comme un indicateur non textuel', () => {
  it('mesure `--ring` contre chaque surface dérivée, dans les deux modes', () => {
    const measurement = measureContrast({
      components: DELIVERED_LIKE.components,
      stylesheet: DELIVERED_LIKE.stylesheetWith({}),
    })

    const ring = measurement.pairs.filter((pair) => pair.foregroundToken === '--ring')

    expect(ring.length).toBe(measurement.surfaces.length * CONTRAST_MODES.length)
    expect(new Set(ring.map((pair) => pair.kind))).toEqual(new Set(['indicateur']))
    expect(new Set(ring.map((pair) => pair.backgroundToken))).toEqual(
      new Set(measurement.surfaces),
    )
  })

  it('nomme les composants qui portent l’anneau, et refuse quand aucun ne le porte', () => {
    // Mesurer un jeton que plus personne ne rend serait une commande verte sur
    // du vide. Les composants sont **dérivés** de leur classe, jamais listés.
    const measurement = measureContrast({
      components: DELIVERED_LIKE.components,
      stylesheet: DELIVERED_LIKE.stylesheetWith({}),
    })

    expect(measurement.ringComponents).toContain('button.tsx')

    expect(() =>
      measureContrast({
        components: DELIVERED_LIKE.components.map((component) => ({
          name: component.name,
          source: component.source.replace(/focus-visible:ring-ring/g, ''),
        })),
        stylesheet: DELIVERED_LIKE.stylesheetWith({}),
      }),
    ).toThrow(/anneau/i)
  })
})

describe('les planchers anti-balayage-vide', () => {
  it('refuse un dossier qui ne rend presque plus de fichiers, et garde ceux qu’il rend', () => {
    // Le plancher de la **lecture**, et non de la dérivation : un dossier
    // déplacé, renommé ou vidé rendrait la commande verte en ne lisant rien.
    // Il est éprouvé sur une liste de noms passée en argument — s57 l'avait
    // enfermé dans le lecteur de disque, où aucun cas ne pouvait l'atteindre :
    // le neutraliser ne faisait alors rougir personne.
    expect(() =>
      sweptComponentNames(['alert.tsx', 'button.tsx', 'card.tsx'], 'essai/composants'),
    ).toThrow(new RegExp(`essai/composants[^]*fichier\\(s\\)[^]*${MINIMUM_SWEPT_FILES}`))

    const names = Array.from({ length: MINIMUM_SWEPT_FILES }, (_value, index) => `c${index}.tsx`)

    expect(
      sweptComponentNames([...names, 'index.ts', 'styles.css'].reverse(), 'essai/composants'),
    ).toEqual(names)
  })

  it('refuse une dérivation qui ne trouve plus les quatre sémantiques teintées', () => {
    expect(() =>
      measureContrast({
        components: DELIVERED_LIKE.components.map((component) =>
          component.name === 'alert.tsx'
            ? {
                name: component.name,
                source: component.source.replace(/^\s+(succes|attention|info):.*$/gm, ''),
              }
            : component,
        ),
        stylesheet: DELIVERED_LIKE.stylesheetWith({}),
      }),
    ).toThrow(new RegExp(String(MINIMUM_TINTED_PAIRS)))
  })

  it('refuse une dérivation qui retombe sur un seul fichier — le défaut que s57 corrige', () => {
    // L'assertion nomme **le plancher qui doit céder**, pas seulement son
    // chiffre : trois planchers portent le nombre 3, et un message pris pour un
    // autre est une couverture accidentelle — mesuré en s57, le cas des
    // surfaces ci-dessous passait sur le message des fichiers.
    expect(() =>
      measureContrast({
        // Les panneaux gardent leur fond — donc leurs surfaces —, mais perdent
        // leur texte : il ne reste que deux fichiers porteurs d'une paire.
        components: DELIVERED_LIKE.components.map((component) => ({
          name: component.name,
          source: component.source.replace(/\btext-[a-z][a-z\d-]*-foreground\b/g, ''),
        })),
        stylesheet: DELIVERED_LIKE.stylesheetWith({}),
      }),
    ).toThrow(new RegExp(`fichier\\(s\\) portent une paire[^]*${MINIMUM_PAIRED_SOURCES}`))
  })

  it('refuse une dérivation qui ne trouve plus de surface', () => {
    // Les mêmes composants, mais chacun peint son fond **dans une variante** :
    // les paires restent, les surfaces disparaissent. Sans cette forme, le
    // refus viendrait du plancher des fichiers et le plancher des surfaces
    // pourrait être désarmé sans que rien ne rougisse.
    expect(() =>
      measureContrast({
        components: DELIVERED_LIKE.components.map((component) => ({
          name: component.name,
          source: component.source.replace(
            /^const styles = cva\('([^']*)'/m,
            (_whole, base: string) =>
              `const styles = cva('${base.replace(/\bbg-[a-z][a-z\d-]*\b/g, '')}', { variants: { surface: { pose: '${
                /\bbg-[a-z][a-z\d-]*\b/.exec(base)?.[0] ?? ''
              }' } } })\nconst autre = cva('`,
          ),
        })),
        stylesheet: DELIVERED_LIKE.stylesheetWith({}),
      }),
    ).toThrow(new RegExp(`surface\\(s\\)[^]*${MINIMUM_SURFACES}`))
  })
})

/**
 * **La mesure des fichiers livrés, calculée une fois — et son refus est un cas
 * nommé, pas un effondrement.**
 *
 * `it.each` a besoin des paires au moment de la **collecte** : une dérivation
 * qui refuse ferait échouer le fichier entier avant qu'aucun cas n'existe, et
 * le run rougirait sans jamais dire lequel. Mesuré en s57 en neutralisant
 * l'autorité de `@theme inline` : la suite tombait à quinze cas — ceux d'un
 * autre fichier — sans qu'un seul cas de celui-ci ne rougisse. Le refus est
 * donc capturé ici, et il devient une assertion.
 */
const DELIVERED = ((): {
  readonly measurement: ContrastMeasurement | undefined
  readonly refusal: string | undefined
} => {
  try {
    return { measurement: measureContrast(deliveredContrastInput()), refusal: undefined }
  } catch (error) {
    return { measurement: undefined, refusal: error instanceof Error ? error.message : `${error}` }
  }
})()

const DELIVERED_PAIRS = DELIVERED.measurement?.pairs ?? []

describe('les jetons livrés tiennent leur seuil, dans les deux modes', () => {
  // Le contrôle sur les fichiers **du dépôt** : une dérivation verte sur du
  // synthétique et aveugle sur les vrais fichiers serait le pire résultat.

  it('dérive les fichiers livrés sans refuser de conclure', () => {
    expect(DELIVERED.refusal).toBeUndefined()
  })

  it('balaie plusieurs composants, pas seulement l’`Alert`', () => {
    expect(new Set(DELIVERED_PAIRS.map((pair) => pair.source)).size).toBeGreaterThan(2)
    expect(new Set(DELIVERED_PAIRS.map((pair) => pair.mode))).toEqual(
      new Set(CONTRAST_MODES.map((mode) => mode.label)),
    )
  })

  it('mesure les deux espèces : du texte et un indicateur non textuel', () => {
    expect(new Set(DELIVERED_PAIRS.map((pair) => pair.kind))).toEqual(
      new Set(['texte', 'indicateur']),
    )
  })

  it.each(
    DELIVERED_PAIRS.map(
      (pair) => [`${pair.source}/${pair.variant} — ${pair.mode} (${pair.kind})`, pair] as const,
    ),
  )('%s atteint son seuil', (_label, pair) => {
    expect(pair.ratio).toBeGreaterThanOrEqual(pair.threshold)
  })
})

describe('ce que la commande ne mesure pas, écrit dans sa propre sortie', () => {
  const notes =
    DELIVERED.measurement === undefined ? [] : contrastNotes(DELIVERED.measurement)

  it('nomme les textes qui héritent de leur surface, plutôt que de les taire', () => {
    // Le trou le plus large de la mesure : un `text-muted-foreground` sans
    // `bg-…` dans la même chaîne dépend de ce qu'il y a dessous, que ce fichier
    // ne connaît pas. Le taire ferait croire à une couverture qu'il n'a pas.
    expect(notes.join('\n')).toContain('--muted-foreground')
  })

  it('nomme les états conditionnels qu’elle laisse dehors', () => {
    expect(notes.join('\n')).toContain('hover:')
  })

  it('dit qu’elle ne mesure ni les bordures, ni le rendu du navigateur', () => {
    const written = notes.join('\n')

    expect(written).toContain('border-')
    expect(written).toMatch(/navigateur/i)
  })

  it('ne rend jamais une sortie vide : une commande muette suggérerait tout mesurer', () => {
    expect(notes.length).toBeGreaterThan(3)
  })
})

describe('le verdict de la commande', () => {
  const pairOf = (variant: string, ratio: number): ContrastPair =>
    pairFixture({ variant, kind: 'texte', ratio })

  it('retient en échec la paire qui passe sous le seuil, et elle seule', () => {
    const report = contrastReport([
      pairOf('alpha', CONTRAST_THRESHOLDS.texte),
      pairOf('beta', CONTRAST_THRESHOLDS.texte - 0.01),
      pairOf('gamma', 21),
    ])

    expect(report.failures.map((pair) => pair.variant)).toEqual(['beta'])
  })

  it('nomme la variante en échec dans ce qu’elle imprime', () => {
    // C'est ce que la mutation de la story attend : remonter un jeton à sa
    // valeur d'avant doit faire rougir la commande **en nommant** la variante.
    // Un « échec » sans nom obligerait à recalculer à la main pour savoir où.
    const report = contrastReport([pairOf('warning', 1.83)])

    expect(report.lines.join('\n')).toContain('warning')
    expect(report.failures).toHaveLength(1)
  })

  it('imprime une ligne par paire, mesurée et pas recopiée', () => {
    const pairs = [pairOf('alpha', 21), pairOf('beta', 3)]

    expect(contrastReport(pairs).lines).toHaveLength(pairs.length)
  })
})
