import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  composite,
  CONTRAST_MODES,
  CONTRAST_THRESHOLD,
  contrastPairs,
  type ContrastPair,
  contrastReport,
  contrastRatio,
  MINIMUM_ALERT_VARIANTS,
  parseColor,
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

describe('les paires sont dérivées de l’`Alert`, jamais recopiées', () => {
  /** Une source d'`Alert` d'essai : la dérivation s'éprouve sur une forme. */
  const alertSourceOf = (variants: Readonly<Record<string, string>>): string =>
    [
      "const alertVariants = cva('rounded-lg border px-4 py-3 text-sm', {",
      '  variants: {',
      '    variant: {',
      ...Object.entries(variants).map(([name, classes]) => `      ${name}: '${classes}',`),
      '    },',
      '  },',
      "  defaultVariants: { variant: 'default' },",
      '})',
    ].join('\n')

  /**
   * Une feuille de style d'essai, **à la forme du vrai fichier**.
   *
   * La ligne `@custom-variant` n'est pas du décor : `packages/ui/src/styles.css`
   * la porte avant ses blocs, et c'est là que tombe une recherche littérale de
   * `.dark`. Une forme d'essai qui ne l'aurait pas laisserait passer une
   * extraction dés-ancrée — le mode sombre serait alors mesuré avec les jetons
   * du mode clair, sans que rien ne le dise.
   */
  const stylesheetOf = (root: string, dark: string): string =>
    [
      '@custom-variant dark (&:where(.dark, .dark *));',
      '',
      ':root {',
      root,
      '}',
      '',
      '.dark {',
      dark,
      '}',
    ].join('\n')

  /** Quatre variantes : le plancher est un contrôle à part, éprouvé plus bas. */
  const QUATRE = {
    alpha: 'border-alpha/50 bg-alpha/10 text-alpha',
    beta: 'border-beta/50 bg-beta/10 text-beta',
    gamma: 'border-gamma/50 bg-gamma/10 text-gamma',
    delta: 'border-delta/50 bg-delta/10 text-delta',
  }

  const TOKENS = [
    '  --card: oklch(1 0 0);',
    '  --alpha: oklch(0.5 0 0);',
    '  --beta: oklch(0.5 0 0);',
    '  --gamma: oklch(0.5 0 0);',
    '  --delta: oklch(0.5 0 0);',
  ].join('\n')

  it('fait apparaître une cinquième variante ajoutée à la source', () => {
    // C'est la garde qui distingue une dérivation d'une table recopiée : une
    // table resterait identique quand l'`Alert` en gagne une.
    const pairs = contrastPairs({
      alert: alertSourceOf({
        ...QUATRE,
        chartreuse: 'border-chartreuse/50 bg-chartreuse/10 text-chartreuse',
      }),
      stylesheet: stylesheetOf(
        [TOKENS, '  --chartreuse: oklch(0.5 0 0);'].join('\n'),
        '  --card: oklch(0.2 0 0);',
      ),
    })

    expect([...new Set(pairs.map((pair) => pair.variant))]).toContain('chartreuse')
  })

  it('mesure chaque variante dans les deux modes', () => {
    const pairs = contrastPairs({
      alert: alertSourceOf(QUATRE),
      stylesheet: stylesheetOf(TOKENS, '  --card: oklch(0.2 0 0);'),
    })

    expect(pairs.map((pair) => pair.mode)).toEqual(
      expect.arrayContaining(CONTRAST_MODES.map((mode) => mode.label)),
    )
    expect(pairs).toHaveLength(Object.keys(QUATRE).length * CONTRAST_MODES.length)
  })

  it('suit la valeur du jeton — changer le jeton change le rapport mesuré', () => {
    // La preuve que rien n'est recopié : la même source d'`Alert`, deux feuilles
    // de style, deux mesures.
    const measure = (alpha: string): number => {
      const pair = contrastPairs({
        alert: alertSourceOf(QUATRE),
        stylesheet: stylesheetOf(
          TOKENS.replace('--alpha: oklch(0.5 0 0);', `--alpha: ${alpha};`),
          '  --card: oklch(0.2 0 0);',
        ),
      }).find((candidate) => candidate.variant === 'alpha' && candidate.mode === 'clair')

      if (pair === undefined) {
        throw new Error('La paire « alpha » en mode clair n’a pas été dérivée.')
      }

      return pair.ratio
    }

    expect(measure('oklch(0.9 0 0)')).toBeLessThan(measure('oklch(0.3 0 0)'))
  })

  it('hérite du mode clair les jetons que le mode sombre ne redéclare pas', () => {
    // `.dark` n'est pas un thème complet : c'est une surcharge. Un jeton qu'il
    // ne redéclare pas garde sa valeur de `:root`, comme en cascade CSS.
    const pairs = contrastPairs({
      alert: alertSourceOf(QUATRE),
      stylesheet: stylesheetOf(TOKENS, '  --alpha: oklch(0.9 0 0);'),
    })

    const beta = pairs.filter((pair) => pair.variant === 'beta')

    expect(beta.map((pair) => pair.ratio)).toEqual([beta[0]?.ratio, beta[0]?.ratio])
  })

  it('lit le bloc `.dark` lui-même, pas le premier `.dark` rencontré', () => {
    // **Le défaut que la story dit avoir corrigé, et que rien ne faisait
    // rougir** (revue de s49, M1). Dés-ancrer la recherche du bloc laissait
    // 36 tests sur 36 au vert, pendant que chaque ligne « sombre » de la
    // commande devenait une copie de sa ligne « clair » : la recherche tombait
    // sur `@custom-variant dark (&:where(.dark, .dark *))`, et l'accolade
    // suivante est celle de `:root`.
    //
    // Ici `.dark` redéclare la surface, donc les deux modes **doivent** donner
    // deux mesures. Une extraction qui remonte `:root` les rend égales.
    const pairs = contrastPairs({
      alert: alertSourceOf(QUATRE),
      stylesheet: stylesheetOf(TOKENS, '  --card: oklch(0.2 0 0);'),
    })

    const ratioOf = (mode: string): number => {
      const pair = pairs.find(
        (candidate) => candidate.variant === 'alpha' && candidate.mode === mode,
      )

      if (pair === undefined) {
        throw new Error(`La paire « alpha » en mode ${mode} n’a pas été dérivée.`)
      }

      return pair.ratio
    }

    expect(ratioOf('sombre')).not.toBeCloseTo(ratioOf('clair'), 3)
  })

  it('refuse une variante dont elle ne sait pas lire le fond ou le texte', () => {
    // Laisser tomber une variante illisible serait un balayage vide déguisé :
    // la commande resterait verte en mesurant une variante de moins.
    expect(() =>
      contrastPairs({
        alert: alertSourceOf({ ...QUATRE, epsilon: 'border-epsilon/50 bg-epsilon/10' }),
        stylesheet: stylesheetOf(TOKENS, '  --card: oklch(0.2 0 0);'),
      }),
    ).toThrow(/epsilon/)
  })

  it('refuse un jeton que la feuille de style ne déclare pas', () => {
    expect(() =>
      contrastPairs({
        alert: alertSourceOf(QUATRE),
        stylesheet: stylesheetOf(TOKENS.replace('  --delta: oklch(0.5 0 0);', ''), ''),
      }),
    ).toThrow(/--delta/)
  })
})

describe('le plancher anti-balayage-vide', () => {
  const stylesheet = [':root {', '  --card: oklch(1 0 0);', '}', '', '.dark {', '}'].join('\n')

  it('refuse une source d’`Alert` sans la moindre variante', () => {
    // Le défaut exact trouvé en s26 puis en s48 : une extraction qui cesse de
    // correspondre rend la commande verte en ne vérifiant rien.
    expect(() =>
      contrastPairs({
        alert: "const alertVariants = cva('rounded-lg border', { variant: {} })",
        stylesheet,
      }),
    ).toThrow(/aucune variante|variante/i)
  })

  it('refuse une extraction qui rend moins de variantes que les sémantiques', () => {
    expect(() =>
      contrastPairs({
        alert: [
          "const alertVariants = cva('base', {",
          '  variants: {',
          '    variant: {',
          "      alpha: 'bg-alpha/10 text-alpha',",
          "      beta: 'bg-alpha/10 text-alpha',",
          "      gamma: 'bg-alpha/10 text-alpha',",
          '    },',
          '  },',
          '})',
        ].join('\n'),
        stylesheet: [
          ':root {',
          '  --card: oklch(1 0 0);',
          '  --alpha: oklch(0.5 0 0);',
          '}',
          '',
          '.dark {',
          '}',
        ].join('\n'),
      }),
    ).toThrow(new RegExp(String(MINIMUM_ALERT_VARIANTS)))
  })
})

describe('l’`Alert` livrée tient le seuil AA, dans les deux modes', () => {
  // Le contrôle sur les fichiers **du dépôt**, et non sur une forme d'essai :
  // une dérivation verte sur du synthétique et aveugle sur le vrai fichier
  // serait le pire des résultats. C'est aussi ce que la mutation de la story
  // fait rougir — remonter `--warning-subtle-foreground` à sa valeur d'avant.
  const pairs = contrastPairs({
    alert: readFileSync(
      fileURLToPath(new URL('../packages/ui/src/components/alert.tsx', import.meta.url)),
      'utf8',
    ),
    stylesheet: readFileSync(
      fileURLToPath(new URL('../packages/ui/src/styles.css', import.meta.url)),
      'utf8',
    ),
  })

  it('dérive au moins les quatre sémantiques, dans les deux modes', () => {
    expect(new Set(pairs.map((pair) => pair.variant)).size).toBeGreaterThanOrEqual(
      MINIMUM_ALERT_VARIANTS,
    )
    expect(new Set(pairs.map((pair) => pair.mode))).toEqual(
      new Set(CONTRAST_MODES.map((mode) => mode.label)),
    )
  })

  it('mesure le mode sombre sur les jetons de `.dark`, pas sur ceux de `:root`', () => {
    // La même garde que sur la forme d'essai, mais **sur le vrai fichier** :
    // c'est lui qui porte le `@custom-variant` piégeux, et c'est lui que la
    // commande lit. Les quatre sémantiques changent de valeur en sombre, donc
    // au moins une variante doit changer de rapport ; si aucune ne change,
    // c'est que le bloc lu n'est pas `.dark`.
    const byVariant = new Map<string, Map<string, number>>()

    for (const pair of pairs) {
      const modes = byVariant.get(pair.variant) ?? new Map<string, number>()

      modes.set(pair.mode, pair.ratio)
      byVariant.set(pair.variant, modes)
    }

    const differing = [...byVariant.entries()].filter(
      ([, modes]) => new Set([...modes.values()].map((ratio) => ratio.toFixed(6))).size > 1,
    )

    expect(differing.map(([variant]) => variant)).not.toHaveLength(0)
  })

  it.each(pairs.map((pair) => [`${pair.variant} — ${pair.mode}`, pair] as const))(
    '%s atteint 4,5 : 1',
    (_label, pair) => {
      expect(pair.ratio).toBeGreaterThanOrEqual(CONTRAST_THRESHOLD)
    },
  )
})

describe('le verdict de la commande', () => {
  const pairOf = (variant: string, ratio: number): ContrastPair => ({
    variant,
    mode: 'clair',
    foregroundToken: `--${variant}-subtle-foreground`,
    backgroundToken: `--${variant}`,
    backgroundAlpha: 0.1,
    surfaceToken: '--card',
    ratio,
  })

  it('retient en échec la paire qui passe sous le seuil, et elle seule', () => {
    const report = contrastReport([
      pairOf('alpha', CONTRAST_THRESHOLD),
      pairOf('beta', CONTRAST_THRESHOLD - 0.01),
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
