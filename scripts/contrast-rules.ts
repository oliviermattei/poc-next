/**
 * **Les règles du contrôle de contraste** (s49), isolées de la commande qui les
 * exécute — même forme que `scripts/socle-rules.ts` face à `scripts/socle.ts`,
 * et pour la même raison : une règle enfermée dans un script n'est éprouvable
 * qu'en lançant le script, donc en pratique jamais.
 *
 * ## Ce que ce fichier calcule, et pourquoi il doit être éprouvé avant d'être cru
 *
 * Une conversion OKLCH → sRGB fausse rendrait `pnpm test:contrast` **verte sur
 * des couleurs illisibles** : le dépôt gagnerait une garde qui ne garde rien,
 * ce qui est pire que pas de garde du tout. `tests/contrast.test.ts` pose donc
 * des paires **extérieures au dépôt** — les primaires sRGB exprimées en OKLCH,
 * noir sur blanc à 21 : 1, `#767676` sur blanc à la limite de 4,5 : 1 — avant
 * que quoi que ce soit ne mesure un jeton d'ici.
 *
 * ## Ce qu'il ne calcule pas
 *
 * Le rendu réel du navigateur. Le fond effectif d'une `Alert` est **supposé**
 * être la carte (`--card`) : c'est la vérification visuelle de la story qui le
 * confirme, pas ce fichier.
 */

/** Un canal sRGB **encodé** (gamma), dans [0, 1] — pas une valeur linéaire. */
export type Rgb = readonly [number, number, number]

/** Une couleur lue dans une source : sRGB encodé, plus son alpha. */
export type Color = {
  readonly rgb: Rgb
  readonly alpha: number
}

export class ContrastRuleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContrastRuleError'
  }
}

const fail = (message: string): never => {
  throw new ContrastRuleError(message)
}

const quote = (value: string): string => `« ${value} »`

const clamp = (value: number): number => Math.min(1, Math.max(0, value))

/**
 * OKLab → sRGB linéaire, puis encodage gamma.
 *
 * Les coefficients sont ceux de la spécification d'OKLab (Björn Ottosson), et
 * ils ne sont pas paramétrables : les recopier ailleurs serait la façon la plus
 * simple de faire diverger deux calculs qui doivent être le même.
 */
const oklchToRgb = (l: number, c: number, hDegrees: number): Rgb => {
  const h = (hDegrees * Math.PI) / 180
  const a = c * Math.cos(h)
  const b = c * Math.sin(h)

  const lCube = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const mCube = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const sCube = (l - 0.0894841775 * a - 1.291485548 * b) ** 3

  const linear: readonly number[] = [
    4.0767416621 * lCube - 3.3077115913 * mCube + 0.2309699292 * sCube,
    -1.2684380046 * lCube + 2.6097574011 * mCube - 0.3413193965 * sCube,
    -0.0041960863 * lCube - 0.7034186147 * mCube + 1.707614701 * sCube,
  ]

  const encode = (value: number): number =>
    clamp(value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055)

  return [encode(linear[0] ?? 0), encode(linear[1] ?? 0), encode(linear[2] ?? 0)]
}

/** `10%` ou `0.15` — les deux formes que CSS accepte pour un alpha. */
const parseAlpha = (raw: string, source: string): number => {
  const trimmed = raw.trim()
  const value = trimmed.endsWith('%')
    ? Number(trimmed.slice(0, -1)) / 100
    : Number.parseFloat(trimmed)

  if (!Number.isFinite(value)) {
    fail(`Alpha illisible dans ${quote(source)}.`)
  }

  return clamp(value)
}

const OKLCH =
  /^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+%?)\s*)?\)$/i

const HEX = /^#([\da-f]{6})$/i

/**
 * Lit une couleur, ou **refuse**.
 *
 * Le refus n'est pas de la rigueur gratuite : une couleur illisible rendue en
 * noir passerait n'importe quelle paire sur fond clair, et la commande serait
 * verte pour la seule raison qu'elle n'a rien compris. Une valeur non reconnue
 * est nommée.
 *
 * **Deux formes seulement — `oklch(…)` et `#rrggbb` —, et `var(…)` n'en est
 * pas une. C'est une contrainte sur la feuille de style.** Un jeton déclaré
 * `--warning-subtle-foreground: var(--warning);` ferait refuser la commande :
 * c'est pourquoi les jetons `-subtle-foreground` du bloc `.dark` sont des
 * **copies littérales** de la valeur du jeton sémantique, et non un renvoi
 * vers lui. Le refus est franc — la commande sort non-zéro en citant la
 * valeur —, mais la copie, elle, est silencieuse : changer `--warning` dans
 * `.dark` sans toucher sa copie ferait diverger deux valeurs que l'ADR 056
 * décrit comme identiques, et rien ne le dirait. Suivre `var(…)` supposerait
 * de résoudre la cascade dans le bon bloc, ce que ce fichier ne fait pas.
 */
export function parseColor(value: string): Color {
  const source = value.trim()

  const oklch = OKLCH.exec(source)

  if (oklch !== null) {
    const lightnessRaw = oklch[1] ?? ''
    const lightness = lightnessRaw.endsWith('%')
      ? Number(lightnessRaw.slice(0, -1)) / 100
      : Number(lightnessRaw)

    return {
      rgb: oklchToRgb(lightness, Number(oklch[2]), Number(oklch[3])),
      alpha: oklch[4] === undefined ? 1 : parseAlpha(oklch[4], source),
    }
  }

  const hex = HEX.exec(source)

  if (hex !== null) {
    const digits = hex[1] ?? ''
    const channel = (index: number): number =>
      Number.parseInt(digits.slice(index * 2, index * 2 + 2), 16) / 255

    return { rgb: [channel(0), channel(1), channel(2)], alpha: 1 }
  }

  return fail(
    `Couleur illisible : ${quote(source)}. Le contrôle ne devine pas une couleur — il refuse, ` +
      'plutôt que de rendre du noir et de valider une paire qu’il n’a pas mesurée.',
  )
}

/** Le canal en hexadécimal, tel qu'un navigateur le quantifie. */
export function toHex(rgb: Rgb): string {
  return `#${rgb
    .map((channel) =>
      Math.round(clamp(channel) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}

/**
 * Compose une couleur à alpha sur un fond **opaque**.
 *
 * Dans l'espace sRGB **encodé**, parce que c'est là que CSS compose : un
 * `bg-warning/10` mélange les octets, pas les luminances. Composer en linéaire
 * donnerait un fond notablement plus sombre et un rapport de contraste faux.
 */
export function composite(foreground: Color, background: Color): Color {
  const mix = (index: 0 | 1 | 2): number =>
    foreground.rgb[index] * foreground.alpha + background.rgb[index] * (1 - foreground.alpha)

  return { rgb: [mix(0), mix(1), mix(2)], alpha: 1 }
}

/** Luminance relative WCAG 2.x — la seule que le seuil de 4,5 : 1 accompagne. */
export function relativeLuminance(rgb: Rgb): number {
  const linearise = (channel: number): number =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4

  return (
    0.2126 * linearise(rgb[0]) + 0.7152 * linearise(rgb[1]) + 0.0722 * linearise(rgb[2])
  )
}

/** Le rapport WCAG, symétrique : l'ordre des deux couleurs ne le change pas. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const first = relativeLuminance(a)
  const second = relativeLuminance(b)

  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

/**
 * **Le seuil, et le seul qui s'applique ici.**
 *
 * WCAG AA vaut 4,5 : 1 pour le texte normal et 3 : 1 pour le grand texte.
 * `alertVariants` rend du `text-sm` (0,875 rem / 400) : le seuil « grand
 * texte » ne s'applique à aucune de ses paires.
 */
export const CONTRAST_THRESHOLD = 4.5

/**
 * **Le plancher anti-balayage-vide.**
 *
 * Le design system porte quatre sémantiques. Une extraction qui en rend moins
 * n'a pas trouvé l'`Alert` : c'est le défaut trouvé deux fois dans ce dépôt
 * (s26, s48) — une correspondance qui cesse de correspondre rend la commande
 * verte en ne vérifiant rien. Le plancher porte sur les **variantes**, donc sur
 * huit paires au moins : posé sur les paires, il serait franchi par deux
 * variantes seulement.
 */
export const MINIMUM_ALERT_VARIANTS = 4

/**
 * **Le fond sur lequel la teinte est composée — une hypothèse, pas une mesure.**
 *
 * Une `Alert` ne connaît pas sa surface : elle pose `bg-<sem>/10`, et c'est ce
 * qu'il y a dessous qui décide du reste. La carte est retenue parce que c'est
 * là que les écrans de s28 posent leur refus. En clair `--card` et
 * `--background` sont identiques, donc le chiffre ne bouge pas ; en sombre ils
 * diffèrent, et la carte est le **cas le plus défavorable** des deux (mesuré :
 * les quatre rapports y sont plus bas que sur la page). C'est la vérification
 * navigateur de la story qui confirme l'hypothèse, pas ce fichier.
 */
export const SURFACE_TOKEN = '--card'

export type ContrastMode = {
  readonly label: string
  readonly selector: string
}

/**
 * Les deux thèmes du design system, et leurs sélecteurs.
 *
 * `.dark` est une **surcharge**, pas un thème complet : un jeton qu'il ne
 * redéclare pas garde sa valeur de `:root`, comme la cascade CSS le veut.
 */
export const CONTRAST_MODES: readonly ContrastMode[] = [
  { label: 'clair', selector: ':root' },
  { label: 'sombre', selector: '.dark' },
]

export type ContrastPair = {
  readonly variant: string
  readonly mode: string
  readonly foregroundToken: string
  readonly backgroundToken: string
  readonly backgroundAlpha: number
  readonly surfaceToken: string
  readonly ratio: number
}

/** Ce qu'une variante d'`Alert` déclare pour son texte et pour son fond. */
export type AlertVariant = {
  readonly name: string
  readonly foregroundToken: string
  readonly backgroundToken: string
  readonly backgroundAlpha: number
}

/**
 * **Le fond et le texte d'une variante — la PREMIÈRE correspondance, et c'est
 * une contrainte sur la façon d'écrire l'`Alert`.**
 *
 * `exec` rend la première occurrence : dans la chaîne de classes d'une variante,
 * le premier `bg-…` et le premier `text-…` gagnent. Écrire
 * `'text-sm bg-warning/10 text-warning-subtle-foreground'` ferait donc résoudre
 * le jeton `--sm`. Rien dans `alert.tsx` ne le dit — d'où cette ligne-ci.
 *
 * La contrainte tient parce que `text-sm` vit dans la **base** de `cva`, hors
 * des chaînes de variantes, et elle **échoue fermé** : `--sm` n'est déclaré
 * nulle part, donc `contrastPairs` refuse en nommant le jeton au lieu de
 * mesurer une couleur inventée. Le jour où une variante gagne un utilitaire de
 * taille ou d'espacement avant sa couleur, c'est la commande qui le dira.
 */
const BACKGROUND = /\bbg-([a-z][a-z\d-]*)(?:\/(\d+))?/
const FOREGROUND = /\btext-([a-z][a-z\d-]*)/

/**
 * Le bloc `{ … }` qui suit `marker`, accolades appariées.
 *
 * `marker` est une **expression régulière**, et pour les sélecteurs CSS elle est
 * ancrée en début de ligne. Mesuré sur ce dépôt : une recherche littérale de
 * `.dark ` tombe d'abord sur `@custom-variant dark (&:where(.dark, .dark *))`,
 * et remonte alors le bloc `:root` — le mode sombre était mesuré avec les
 * jetons du mode clair, sans que rien ne le dise.
 */
const blockAfter = (source: string, marker: RegExp): string | undefined => {
  const marked = marker.exec(source)

  if (marked === null) {
    return undefined
  }

  const open = source.indexOf('{', marked.index)

  if (open === -1) {
    return undefined
  }

  let depth = 0

  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') {
      depth += 1
    } else if (source[index] === '}') {
      depth -= 1

      if (depth === 0) {
        return source.slice(open + 1, index)
      }
    }
  }

  return undefined
}

/**
 * **Les variantes de l'`Alert`, lues dans son code source.**
 *
 * Jamais une table recopiée : une table resterait verte après un changement de
 * jeton ou l'ajout d'une variante, ce qui est exactement ce qu'`AGENTS.md`
 * refuse — la commande promettrait « les paires de l'`Alert` » en mesurant
 * celles d'hier.
 *
 * Une variante dont le fond ou le texte est illisible est **refusée**, jamais
 * ignorée : une variante silencieusement laissée de côté est un balayage vide
 * déguisé, avec le vert en prime.
 */
export function alertVariants(source: string): readonly AlertVariant[] {
  const block = blockAfter(source, /\bvariant\s*:/)

  if (block === undefined) {
    return fail(
      'Aucun bloc `variant:` trouvé dans la source de l’`Alert` : l’extraction ne correspond plus ' +
        'au composant. Une commande qui ne trouve rien passerait sans mesurer la moindre paire.',
    )
  }

  const variants = [...block.matchAll(/([A-Za-z][\w$]*)\s*:\s*'([^']*)'/g)].map((match) => {
    const name = match[1] ?? ''
    const classes = match[2] ?? ''

    const background = BACKGROUND.exec(classes)
    const foreground = FOREGROUND.exec(classes)

    if (background === null || foreground === null) {
      return fail(
        `La variante ${quote(name)} de l’\`Alert\` ne déclare pas à la fois un fond (\`bg-…\`) et un ` +
          `texte (\`text-…\`) : ${quote(classes)}. Le contrôle refuse plutôt que de mesurer une ` +
          'variante de moins que ce qu’il annonce.',
      )
    }

    return {
      name,
      foregroundToken: `--${foreground[1] ?? ''}`,
      backgroundToken: `--${background[1] ?? ''}`,
      backgroundAlpha: background[2] === undefined ? 1 : Number(background[2]) / 100,
    }
  })

  if (variants.length < MINIMUM_ALERT_VARIANTS) {
    fail(
      `L’extraction n’a dérivé que ${variants.length} variante(s) de l’\`Alert\`, moins que les ` +
        `${MINIMUM_ALERT_VARIANTS} sémantiques du design system. Une correspondance qui cesse de ` +
        'correspondre rend la commande verte en ne vérifiant rien — le défaut trouvé en s26 puis ' +
        'en s48.',
    )
  }

  return variants
}

/** Les déclarations `--nom: valeur;` d'un bloc de la feuille de style. */
const declarationsOf = (stylesheet: string, selector: string): ReadonlyMap<string, string> => {
  const block = blockAfter(
    stylesheet,
    new RegExp(`^\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`, 'm'),
  )

  if (block === undefined) {
    return fail(`Bloc ${quote(selector)} introuvable dans la feuille de style.`)
  }

  return new Map(
    [...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((match) => [
      match[1] ?? '',
      (match[2] ?? '').trim(),
    ]),
  )
}

/**
 * **Les paires mesurées : une par variante et par mode.**
 *
 * Tout est dérivé — les variantes du composant, les valeurs de la feuille de
 * style —, donc changer un jeton change la mesure, et ajouter une variante en
 * ajoute une.
 */
export function contrastPairs(input: {
  readonly alert: string
  readonly stylesheet: string
}): readonly ContrastPair[] {
  const variants = alertVariants(input.alert)
  const root = declarationsOf(input.stylesheet, ':root')

  return CONTRAST_MODES.flatMap((mode) => {
    const overrides =
      mode.selector === ':root' ? new Map<string, string>() : declarationsOf(input.stylesheet, mode.selector)

    const resolve = (token: string): Color => {
      const declared = overrides.get(token) ?? root.get(token)

      if (declared === undefined) {
        return fail(
          `Le jeton ${quote(token)}, employé par l’\`Alert\`, n’est déclaré ni dans ${quote(mode.selector)} ` +
            'ni dans `:root`. Le contrôle refuse plutôt que de mesurer une couleur qu’il a inventée.',
        )
      }

      return parseColor(declared)
    }

    const surface = resolve(SURFACE_TOKEN)

    return variants.map((variant) => {
      const tint = resolve(variant.backgroundToken)
      const background = composite(
        { rgb: tint.rgb, alpha: tint.alpha * variant.backgroundAlpha },
        surface,
      )
      const foreground = composite(resolve(variant.foregroundToken), background)

      return {
        variant: variant.name,
        mode: mode.label,
        foregroundToken: variant.foregroundToken,
        backgroundToken: variant.backgroundToken,
        backgroundAlpha: variant.backgroundAlpha,
        surfaceToken: SURFACE_TOKEN,
        ratio: contrastRatio(foreground.rgb, background.rgb),
      }
    })
  })
}

export type ContrastReport = {
  /** Une ligne par paire : variante, mode, rapport mesuré, seuil, verdict. */
  readonly lines: readonly string[]
  /** Les paires sous le seuil. Non vide ⇒ la commande sort non-zéro. */
  readonly failures: readonly ContrastPair[]
}

const ratioLabel = (ratio: number): string => `${ratio.toFixed(2).replace('.', ',')} : 1`

/**
 * **Le verdict, séparé de son impression.**
 *
 * La commande ne décide de rien : elle imprime ce que cette fonction rend et
 * sort non-zéro si `failures` n'est pas vide. Chaque ligne **nomme sa
 * variante** — un « échec » anonyme obligerait à recalculer à la main pour
 * savoir laquelle des paires a cédé.
 */
export function contrastReport(pairs: readonly ContrastPair[]): ContrastReport {
  const lines = pairs.map((pair) => {
    const verdict = pair.ratio >= CONTRAST_THRESHOLD ? 'OK' : 'ÉCHEC'

    return [
      pair.variant.padEnd(12),
      pair.mode.padEnd(7),
      `${pair.foregroundToken} sur ${pair.backgroundToken}/${Math.round(
        pair.backgroundAlpha * 100,
      )} au-dessus de ${pair.surfaceToken}`.padEnd(64),
      ratioLabel(pair.ratio).padStart(11),
      `seuil ${ratioLabel(CONTRAST_THRESHOLD)}`,
      verdict,
    ].join('  ')
  })

  return { lines, failures: pairs.filter((pair) => pair.ratio < CONTRAST_THRESHOLD) }
}
