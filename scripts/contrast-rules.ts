/**
 * **Les règles du contrôle de contraste** (s49, élargies par s57), isolées de la
 * commande qui les exécute — même forme que `scripts/socle-rules.ts` face à
 * `scripts/socle.ts`, et pour la même raison : une règle enfermée dans un script
 * n'est éprouvable qu'en lançant le script, donc en pratique jamais.
 *
 * **Ce fichier ne lit rien du disque**, et c'est ce qui le rend éprouvable sur
 * des formes d'essai : la lecture vit dans `scripts/contrast-sources.ts`, seule
 * et partagée par la commande et la suite.
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
 * Le rendu réel du navigateur. Le fond effectif d'une `Alert` est **déclaré**
 * — plus supposé pour tout le monde, depuis s57 — et c'est la mesure peinte de
 * `e2e/alert-contrast.spec.ts` qui le confirme, pas ce fichier ; celle de
 * `e2e/focus-contrast.spec.ts` fait la même chose pour l'anneau de focus.
 *
 * Ce qu'il ne calcule pas non plus, et que sa propre sortie nomme : un texte
 * dont la surface est celle de son écran, une couleur d'état, une bordure, un
 * fichier hors du dossier balayé.
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
 * **Deux espèces de paires, donc deux seuils** (s57).
 *
 * WCAG AA demande 4,5 : 1 à du **texte** normal et 3 : 1 à un **élément non
 * textuel** — bordure d'état, indicateur de focus, contour d'un contrôle
 * (SC 1.4.11). Un seuil unique serait faux dans les deux sens : appliqué à
 * l'anneau de focus il est trop sévère, et baissé pour lui il rendrait
 * illisible le texte qu'il gardait.
 *
 * Le troisième seuil de la norme — 3 : 1 pour le **grand texte** — n'est pas
 * ici, et c'est délibéré : aucune paire dérivée par ce fichier ne connaît sa
 * taille de rendu. `Alert` rend du `text-sm`, `Badge` du `text-xs`, tous deux
 * sous le seuil de « grand texte ». Un jour où un composant rendrait du 24 px,
 * ce fichier le mesurerait trop sévèrement — ce qui est le bon sens de
 * l'erreur.
 */
export const CONTRAST_THRESHOLDS = {
  texte: 4.5,
  indicateur: 3,
} as const

/** L'espèce d'une paire : ce qu'elle est décide de son seuil. */
export type ContrastKind = keyof typeof CONTRAST_THRESHOLDS

export function thresholdOf(kind: ContrastKind): number {
  return CONTRAST_THRESHOLDS[kind]
}

/**
 * **Les planchers anti-balayage-vide** — la généralisation de ce que s49
 * appelait `MINIMUM_ALERT_VARIANTS`.
 *
 * Une correspondance qui cesse de correspondre rend la commande verte en ne
 * vérifiant rien : le défaut trouvé en s26, puis en s48. Chacun garde une
 * dérivation distincte, et aucun n'affirme ce qui existe — ce sont des bornes
 * basses, franchies aujourd'hui avec de la marge, dont le seul rôle est de
 * refuser un **effondrement**. Leur nombre n'est écrit nulle part : il se lit
 * ici, et chacun est éprouvé par son propre message dans
 * `tests/contrast.test.ts` — deux planchers qui portent la même valeur se
 * couvriraient l'un l'autre par accident (mesuré en s57).
 */

/** Les quatre sémantiques du design system, teintées sur une surface. */
export const MINIMUM_TINTED_PAIRS = 4

/**
 * Le nombre de **fichiers** distincts qui portent au moins une paire.
 *
 * C'est le plancher propre à s57 : la commande d'avant ne mesurait qu'un
 * fichier, et une dérivation qui y retomberait aurait perdu le critère 3 sans
 * que rien ne rougisse.
 */
export const MINIMUM_PAIRED_SOURCES = 3

/** Les surfaces neutres sur lesquelles un anneau de focus peut tomber. */
export const MINIMUM_SURFACES = 3

/**
 * Le plancher de ce que le balayage **lit** — les autres gardent ce qu'il
 * **dérive**. Un dossier déplacé, renommé ou vidé rendrait la commande verte en
 * ne lisant presque rien.
 */
export const MINIMUM_SWEPT_FILES = 8

/**
 * **Les fichiers de composant d'un dossier, triés — ou un refus.**
 *
 * La liste des noms est un **argument**, et ce n'est pas une commodité : en
 * s57, ce plancher vivait à l'intérieur du lecteur de disque, qui n'expose
 * aucun point d'injection. Le neutraliser ne faisait alors rougir aucun cas —
 * une garde que rien ne pouvait démontrer, exactement ce que `AGENTS.md`
 * appelle une mutation verte. Ici il se prouve sur une liste posée par le test.
 */
export function sweptComponentNames(names: readonly string[], where: string): readonly string[] {
  const files = names.filter((name) => name.endsWith('.tsx')).sort()

  if (files.length < MINIMUM_SWEPT_FILES) {
    fail(
      `Le balayage de ${quote(where)} n’a trouvé que ${files.length} fichier(s) de composant, ` +
        `moins que les ${MINIMUM_SWEPT_FILES} attendus. Un dossier déplacé, renommé ou vidé ` +
        'rendrait la commande verte en ne lisant presque rien.',
    )
  }

  return files
}

/**
 * **La surface d'une source teintée, déclarée — et refusée quand elle ne l'est
 * pas.**
 *
 * Un fond `bg-<sem>/10` ne se suffit pas : ce qu'il y a **dessous** décide du
 * reste. s49 le supposait pour tout le monde (`SURFACE_TOKEN = '--card'`), y
 * compris pour des paires qui ne sont jamais peintes sur une carte. Ici la
 * déclaration est explicite et **locale à la source** : l'`Alert` garde
 * `--card` parce que c'est là que les écrans la posent — ce que s49 a arbitré
 * et que `e2e/alert-contrast.spec.ts` mesure dans un navigateur —, et le jour
 * où un second composant teinté arrive, la commande **refuse** en le nommant
 * plutôt que de lui prêter la carte.
 *
 * Mesuré : les quatre variantes teintées de l'`Alert` tiennent 4,84 à 4,88 : 1
 * sur `--card` en mode clair et cèdent à 4,46 sur `--muted`. La surface n'est
 * donc pas un détail de présentation, c'est ce qui décide du verdict.
 */
export const DECLARED_TINT_SURFACES: ReadonlyMap<string, string> = new Map([
  ['alert.tsx', '--card'],
])

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
  /** D'où la paire vient : le fichier de composant, ou l'anneau de focus. */
  readonly source: string
  readonly variant: string
  readonly mode: string
  readonly kind: ContrastKind
  readonly foregroundToken: string
  readonly backgroundToken: string
  readonly backgroundAlpha: number
  /** La surface **sous** le fond, quand ce fond est teinté. Jamais supposée. */
  readonly surfaceToken: string
  /** Le seuil de cette paire, porté par elle : il découle de son espèce. */
  readonly threshold: number
  readonly ratio: number
}

/** Ce qu'une variante d'`Alert` déclare pour son texte et pour son fond. */
/** Un fichier de composant, tel que la commande le lit sur le disque. */
export type ComponentSource = {
  /** Son nom de fichier — c'est lui qui nomme une paire dans la sortie. */
  readonly name: string
  readonly source: string
}

/**
 * **Ce que la dérivation a trouvé, et ce qu'elle a laissé dehors.**
 *
 * Les deux voyagent ensemble : une mesure qui ne rendrait que ses paires
 * laisserait croire qu'elle a tout regardé, ce que le dépôt s'est déjà fait
 * reprocher. `contrastNotes` met le second champ en toutes lettres dans la
 * sortie de la commande.
 */
export type ContrastMeasurement = {
  readonly pairs: readonly ContrastPair[]
  /** Les fichiers balayés, dans l'ordre où ils ont été lus. */
  readonly components: readonly string[]
  /** Les surfaces dérivées : les fonds opaques peints hors d'une variante. */
  readonly surfaces: readonly string[]
  /** Les fichiers qui portent `focus-visible:ring-ring`. */
  readonly ringComponents: readonly string[]
  /** `fichier : --jeton` — du texte dont la surface est inconnue d'ici. */
  readonly inherited: readonly string[]
  /** `fichier : hover:bg-…` — les couleurs d'état, jamais mesurées. */
  readonly stateful: readonly string[]
  /**
   * `fichier : --jeton/50` — un fond teinté qui ne peint aucun texte au repos.
   *
   * Il n'y a pas de paire à mesurer, donc pas de surface à connaître, donc rien
   * à refuser : le refus d'une source teintée sans surface déclarée ne se
   * déclenche que **là où une paire existe**. Sans cette liste, ces fonds
   * passeraient en silence et la règle écrite serait plus large que le code —
   * le constat m4 de la revue de s57.
   */
  readonly tintedWithoutText: readonly string[]
}

/**
 * **Une couleur au repos, et rien d'autre.**
 *
 * Un utilitaire préfixé (`hover:`, `focus-visible:`, `aria-invalid:`, `dark:`)
 * décrit un **état**, pas ce qu'un visiteur voit en arrivant. Le mesurer ferait
 * rougir la commande sur une couleur que personne ne voit sans sa souris — et
 * l'ignorer en silence laisserait croire qu'elle est mesurée : elle est donc
 * comptée et nommée dans la sortie.
 */
const UTILITY = /^(bg|text)-([a-z][a-z\d-]*)(?:\/(\d+))?$/

const STATEFUL_UTILITY = /(?:^|:)(?:bg|text)-[a-z][a-z\d-]*(?:\/\d+)?$/

/** La classe par laquelle un composant demande l'anneau de focus du système. */
const RING_UTILITY = 'focus-visible:ring-ring'

/** Le jeton de l'anneau, et le seul indicateur non textuel que ce fichier mesure. */
const RING_TOKEN = '--ring'

/**
 * Le bloc `{ … }` qui suit `marker`, accolades appariées.
 *
 * `marker` est une **expression régulière**, et pour les sélecteurs CSS elle est
 * ancrée en début de ligne. Mesuré sur ce dépôt : une recherche littérale de
 * `.dark ` tombe d'abord sur `@custom-variant dark (&:where(.dark, .dark *))`,
 * et remonte alors le bloc `:root` — le mode sombre était mesuré avec les
 * jetons du mode clair, sans que rien ne le dise.
 */
const blockBounds = (
  source: string,
  marker: RegExp,
  from = 0,
): readonly [number, number] | undefined => {
  marker.lastIndex = 0

  const marked = marker.global
    ? ((): RegExpExecArray | null => {
        marker.lastIndex = from

        return marker.exec(source)
      })()
    : marker.exec(source.slice(from))

  if (marked === null) {
    return undefined
  }

  const index = marker.global ? marked.index : marked.index + from
  const open = source.indexOf('{', index)

  if (open === -1) {
    return undefined
  }

  let depth = 0

  for (let cursor = open; cursor < source.length; cursor += 1) {
    if (source[cursor] === '{') {
      depth += 1
    } else if (source[cursor] === '}') {
      depth -= 1

      if (depth === 0) {
        return [open + 1, cursor]
      }
    }
  }

  return undefined
}

const blockAfter = (source: string, marker: RegExp): string | undefined => {
  const bounds = blockBounds(source, marker)

  return bounds === undefined ? undefined : source.slice(bounds[0], bounds[1])
}

/**
 * **Ce que `@theme inline` expose à Tailwind — la seule autorité sur ce qui est
 * une couleur.**
 *
 * `text-sm` et `text-card-foreground` ont la même forme ; seule la feuille de
 * style les distingue. s49 prenait la **première** correspondance et pouvait
 * donc résoudre le jeton `--sm`, ce qu'un commentaire du composant devait
 * empêcher. Ici la question est posée au fichier qui y répond : une classe
 * nomme une couleur si et seulement si `--color-<nom>` est déclaré, c'est-à-dire
 * si et seulement si Tailwind en produit un utilitaire de couleur.
 */
export function colourNames(stylesheet: string): ReadonlySet<string> {
  const block = blockAfter(stylesheet, /^\s*@theme\s+inline\s*\{/m)

  if (block === undefined) {
    return fail(
      'Aucun bloc `@theme inline` dans la feuille de style : le contrôle ne saurait plus dire ' +
        'quelle classe nomme une couleur, et prendrait `text-sm` pour un jeton.',
    )
  }

  return new Set([...block.matchAll(/--color-([\w-]+)\s*:/g)].map((match) => match[1] ?? ''))
}

type ClassString = {
  /** Le nom de la variante, ou `base` pour les classes hors variante. */
  readonly label: string
  readonly classes: string
  /** Vrai quand la chaîne vit dans un bloc `variants:` de `cva`. */
  readonly inVariants: boolean
}

/**
 * **Les chaînes de classes d'un composant, et où elles vivent.**
 *
 * La distinction base / variante n'est pas cosmétique : elle sépare une
 * **surface** d'un **remplissage**. `card.tsx` peint `bg-card` dans ses classes
 * de base — c'est un panneau, quelque chose se pose dessus ; `button.tsx` peint
 * `bg-primary` dans une variante — c'est le bouton lui-même. La raison n'est
 * pas arithmétique : l'anneau est un `box-shadow` posé **hors** de la boîte, il
 * tombe sur ce qu'il y a derrière l'élément et jamais sur son propre fond.
 * Exiger 3 : 1 contre un remplissage mesurerait une composition qui n'est
 * peinte nulle part.
 *
 * **Aucun rapport chiffré n'est écrit ici, et c'est délibéré.** s57 en portait
 * un — « 1,84 : 1 quelle que soit la valeur choisie » —, calculé **avant** le
 * correctif de `--ring` et laissé à côté de lui : il ne décrivait déjà plus le
 * jeton livré du commit qui l'entourait, et sa généralisation était fausse par
 * dessus le marché. L'argument structurel ci-dessus se suffit ; les rapports
 * réellement mesurés sont dans la sortie de la commande, et ce que le
 * navigateur peint dans `e2e/focus-contrast.spec.ts`.
 */
const classStringsOf = (source: string): readonly ClassString[] => {
  const spans: (readonly [number, number])[] = []

  for (const marker of source.matchAll(/\bvariants\s*:/g)) {
    const bounds = blockBounds(source, /\bvariants\s*:/g, marker.index)

    if (bounds !== undefined) {
      spans.push(bounds)
    }
  }

  const inVariants = (index: number): boolean =>
    spans.some(([open, close]) => index > open && index < close)

  return [...source.matchAll(/'([^'\n]*)'|"([^"\n]*)"/g)].map((match) => {
    const classes = match[1] ?? match[2] ?? ''
    const key = /([A-Za-z][\w$]*)\s*:\s*$/.exec(source.slice(0, match.index))

    return {
      label: inVariants(match.index) ? (key?.[1] ?? 'base') : 'base',
      classes,
      inVariants: inVariants(match.index),
    }
  })
}

type PaintedClasses = {
  readonly background: { readonly token: string; readonly alpha: number } | undefined
  readonly foreground: string | undefined
  readonly stateful: readonly string[]
}

/**
 * Ce qu'une chaîne de classes peint **au repos**, ou un refus quand elle en
 * peint deux : choisir la première en silence est exactement ce que s49 faisait
 * et ce que son propre commentaire décrivait comme une contrainte d'écriture.
 */
const paintedBy = (
  entry: ClassString,
  colours: ReadonlySet<string>,
  file: string,
): PaintedClasses => {
  const classes = entry.classes.split(/\s+/).filter((token) => token.length > 0)

  const resting = classes.filter((token) => !token.includes(':') && !token.includes('['))
  const stateful = classes.filter(
    (token) => token !== '' && token.includes(':') && STATEFUL_UTILITY.test(token),
  )

  const matched = resting
    .map((token) => UTILITY.exec(token))
    .filter((match): match is RegExpExecArray => match !== null)
    .filter((match) => colours.has(match[2] ?? ''))

  const of = (kind: 'bg' | 'text'): readonly RegExpExecArray[] =>
    matched.filter((match) => match[1] === kind)

  for (const kind of ['bg', 'text'] as const) {
    if (of(kind).length > 1) {
      return fail(
        `La chaîne ${quote(entry.classes)} de ${quote(file)} déclare ${of(kind).length} couleurs ` +
          `\`${kind}-…\` au repos. Le contrôle refuse plutôt que d’en choisir une en silence : ` +
          'la première correspondance n’est pas une décision, c’est un hasard d’écriture.',
      )
    }
  }

  const background = of('bg')[0]
  const foreground = of('text')[0]

  return {
    background:
      background === undefined
        ? undefined
        : {
            token: `--${background[2] ?? ''}`,
            alpha: background[3] === undefined ? 1 : Number(background[3]) / 100,
          },
    foreground: foreground === undefined ? undefined : `--${foreground[2] ?? ''}`,
    stateful,
  }
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
 * **La mesure : les paires dérivées des fichiers livrés, et ce qui reste dehors.**
 *
 * Tout y est dérivé — les fichiers balayés, leurs chaînes de classes, les
 * valeurs de la feuille de style, les surfaces, les composants qui portent
 * l'anneau. Une table recopiée resterait verte après un changement de jeton ou
 * l'arrivée d'un composant, ce qui est exactement le faux vert que cette
 * commande existe pour empêcher.
 */
export function measureContrast(input: {
  readonly components: readonly ComponentSource[]
  readonly stylesheet: string
}): ContrastMeasurement {
  const colours = colourNames(input.stylesheet)
  const root = declarationsOf(input.stylesheet, ':root')

  const declaredIn = (selector: string): ReadonlyMap<string, string> =>
    selector === ':root' ? new Map<string, string>() : declarationsOf(input.stylesheet, selector)

  const overridesByMode = new Map(
    CONTRAST_MODES.map((mode) => [mode.label, declaredIn(mode.selector)] as const),
  )

  const valueOf = (token: string, mode: ContrastMode): string | undefined =>
    overridesByMode.get(mode.label)?.get(token) ?? root.get(token)

  const resolve = (token: string, mode: ContrastMode, why: string): Color => {
    const declared = valueOf(token, mode)

    if (declared === undefined) {
      return fail(
        `Le jeton ${quote(token)}, employé par ${quote(why)}, n’est déclaré ni dans ` +
          `${quote(mode.selector)} ni dans \`:root\`. Le contrôle refuse plutôt que de mesurer ` +
          'une couleur qu’il a inventée.',
      )
    }

    return parseColor(declared)
  }

  const painted = input.components.map((component) => ({
    file: component.name,
    entries: classStringsOf(component.source).map((entry) => ({
      entry,
      ...paintedBy(entry, colours, component.name),
    })),
    ring: component.source.includes(RING_UTILITY),
  }))

  const ringComponents = painted.filter((file) => file.ring).map((file) => file.file)

  if (ringComponents.length === 0) {
    fail(
      `Aucun fichier balayé ne porte \`${RING_UTILITY}\` : mesurer l’anneau de focus reviendrait ` +
        'à mesurer un jeton que plus rien ne rend, et la commande serait verte sur du vide.',
    )
  }

  /**
   * **Une surface est un fond opaque peint hors d'une variante.**
   *
   * Opaque **dans tous les modes** : un fond translucide demanderait lui-même
   * une surface, donc une hypothèse de plus — précisément ce que s57 retire.
   */
  const surfaces = [
    ...new Set(
      painted.flatMap((file) =>
        file.entries
          .filter((line) => !line.entry.inVariants)
          .map((line) => line.background)
          .filter(
            (background): background is { token: string; alpha: number } =>
              background !== undefined && background.alpha === 1,
          )
          .map((background) => background.token),
      ),
    ),
  ].filter((token) =>
    CONTRAST_MODES.every((mode) => {
      const declared = valueOf(token, mode)

      return declared !== undefined && parseColor(declared).alpha === 1
    }),
  )

  if (surfaces.length < MINIMUM_SURFACES) {
    fail(
      `Le balayage n’a dérivé que ${surfaces.length} surface(s), moins que les ` +
        `${MINIMUM_SURFACES} attendues. Une correspondance qui cesse de correspondre rendrait ` +
        'la mesure de l’anneau verte en ne la posant sur presque rien.',
    )
  }

  const pairs: ContrastPair[] = []

  for (const mode of CONTRAST_MODES) {
    for (const file of painted) {
      for (const line of file.entries) {
        if (line.background === undefined || line.foreground === undefined) {
          continue
        }

        const tint = resolve(line.background.token, mode, file.file)
        const alpha = tint.alpha * line.background.alpha
        const tinted = alpha < 1

        const surfaceToken = tinted ? DECLARED_TINT_SURFACES.get(file.file) : undefined

        if (tinted && surfaceToken === undefined) {
          fail(
            `${quote(file.file)} peint un fond teinté (${line.background.token} à ` +
              `${Math.round(line.background.alpha * 100)} %) sans qu’aucune surface soit déclarée ` +
              'pour lui. Le contrôle refuse : ce qu’il y a **dessous** décide du rapport, et le ' +
              'supposer est le défaut que s57 retire de ce fichier.',
          )
        }

        const background = tinted
          ? composite(
              { rgb: tint.rgb, alpha },
              resolve(surfaceToken ?? '', mode, `${file.file} (surface déclarée)`),
            )
          : tint

        pairs.push({
          source: file.file,
          variant: line.entry.label,
          mode: mode.label,
          kind: 'texte',
          foregroundToken: line.foreground,
          backgroundToken: line.background.token,
          backgroundAlpha: line.background.alpha,
          surfaceToken: surfaceToken ?? '—',
          threshold: thresholdOf('texte'),
          ratio: contrastRatio(
            composite(resolve(line.foreground, mode, file.file), background).rgb,
            background.rgb,
          ),
        })
      }
    }

    for (const surface of surfaces) {
      const behind = resolve(surface, mode, 'l’anneau de focus')

      pairs.push({
        source: 'anneau de focus',
        variant: surface.replace(/^--/, ''),
        mode: mode.label,
        kind: 'indicateur',
        foregroundToken: RING_TOKEN,
        backgroundToken: surface,
        backgroundAlpha: 1,
        surfaceToken: '—',
        threshold: thresholdOf('indicateur'),
        ratio: contrastRatio(resolve(RING_TOKEN, mode, 'l’anneau de focus').rgb, behind.rgb),
      })
    }
  }

  for (const mode of CONTRAST_MODES) {
    const tinted = pairs.filter((pair) => pair.mode === mode.label && pair.backgroundAlpha < 1)

    if (tinted.length < MINIMUM_TINTED_PAIRS) {
      fail(
        `L’extraction n’a dérivé que ${tinted.length} paire(s) teintée(s) en mode ${mode.label}, ` +
          `moins que les ${MINIMUM_TINTED_PAIRS} sémantiques du design system. Une ` +
          'correspondance qui cesse de correspondre rend la commande verte en ne vérifiant ' +
          'rien — le défaut trouvé en s26 puis en s48.',
      )
    }
  }

  const pairedSources = new Set(
    pairs.filter((pair) => pair.kind === 'texte').map((pair) => pair.source),
  )

  if (pairedSources.size < MINIMUM_PAIRED_SOURCES) {
    fail(
      `Seuls ${pairedSources.size} fichier(s) portent une paire de texte, moins que les ` +
        `${MINIMUM_PAIRED_SOURCES} attendus. La commande d’avant s57 n’en mesurait qu’un — y ` +
        'retomber perdrait le critère 3 sans que rien ne rougisse.',
    )
  }

  const inherited = [
    ...new Set(
      painted.flatMap((file) =>
        file.entries
          .filter((line) => line.background === undefined && line.foreground !== undefined)
          .map((line) => `${file.file} : ${line.foreground ?? ''}`),
      ),
    ),
  ]

  const stateful = [
    ...new Set(
      painted.flatMap((file) =>
        file.entries.flatMap((line) => line.stateful.map((token) => `${file.file} : ${token}`)),
      ),
    ),
  ]

  /**
   * **Un fond teinté sans texte au repos : ni mesuré, ni refusé, mais nommé.**
   *
   * Le refus ci-dessus vit dans la boucle des paires : une source teintée sans
   * surface déclarée n'y arrive que si la même chaîne peint aussi du texte.
   * Un voile (`bg-foreground/50`) n'en peint pas — lui déclarer une surface
   * serait une cérémonie qui ne mesurerait rien —, et le taire laisserait
   * croire que toute source teintée est vue.
   */
  const tintedWithoutText = [
    ...new Set(
      CONTRAST_MODES.flatMap((mode) =>
        painted.flatMap((file) =>
          file.entries.flatMap((line) => {
            const background = line.background

            if (background === undefined || line.foreground !== undefined) {
              return []
            }

            const tint = resolve(background.token, mode, file.file)

            // L'alpha écrit dans la classe n'est pas le seul en jeu : `--border`
            // est lui-même translucide en mode sombre. Le suffixe ne s'écrit
            // donc que lorsque la classe en porte un, sans quoi `bg-border`
            // s'afficherait « /100 » tout en étant compté comme teinté.
            return tint.alpha * background.alpha < 1
              ? [
                  `${file.file} : ${background.token}${
                    background.alpha < 1 ? `/${Math.round(background.alpha * 100)}` : ''
                  }`,
                ]
              : []
          }),
        ),
      ),
    ),
  ]

  return {
    pairs,
    components: painted.map((file) => file.file),
    surfaces,
    ringComponents,
    inherited,
    stateful,
    tintedWithoutText,
  }
}

/**
 * **Ce que la commande ne mesure pas, en toutes lettres dans sa sortie.**
 *
 * Le critère 4 de s57, et il ne se satisfait pas d'un document : le dépôt s'est
 * déjà fait prendre à laisser une commande verte suggérer une couverture
 * qu'elle n'avait pas. Les lignes qui portent un compte sont **dérivées** de ce
 * que le balayage a rencontré et écarté — leur nombre n'est pas écrit ici, il
 * se lit dans la liste ci-dessous ; les autres nomment ce que ce fichier ne
 * sait structurellement pas voir. Aucune ne prétend à l'exhaustivité : elles
 * disent ce qui a été balayé, jamais ce qui existe.
 */
export function contrastNotes(measurement: ContrastMeasurement): readonly string[] {
  const list = (values: readonly string[], limit = 6): string =>
    values.length <= limit
      ? values.join(', ')
      : `${values.slice(0, limit).join(', ')}… (+${values.length - limit})`

  return [
    `Balayé : ${measurement.components.length} fichier(s) — ${list(measurement.components, 20)}.`,
    `Surfaces dérivées : ${list(measurement.surfaces, 10)}. L’anneau est mesuré contre elles, et ` +
      `il est porté par ${measurement.ringComponents.length} composant(s) : ` +
      `${list(measurement.ringComponents, 20)}.`,
    `NON mesuré — ${measurement.inherited.length} texte(s) qui héritent de leur surface, donc ` +
      `d’un fond que ce fichier ne connaît pas : ${list(measurement.inherited)}.`,
    `NON mesuré — ${measurement.stateful.length} couleur(s) d’état (survol, focus, saisie ` +
      `invalide) : ${list(measurement.stateful)}.`,
    `NON mesuré — ${measurement.tintedWithoutText.length} fond(s) teinté(s) sans texte au repos, ` +
      'donc sans paire : un voile n’a pas de texte à lui, et le refus d’une surface non déclarée ' +
      `ne se déclenche que là où une paire existe : ${list(measurement.tintedWithoutText)}.`,
    'NON mesuré — les bordures (`border-…`), les icônes, l’épaisseur et le décalage de l’anneau, ' +
      'et tout fichier hors du dossier balayé : un écran ou un module qui peindrait sa propre ' +
      'paire n’entre pas ici.',
    'NON mesuré — le rendu réel : ce fichier fait de l’arithmétique sur la feuille de style. Ce ' +
      'que le navigateur peint vraiment, y compris la surface effective sous un élément, est ' +
      'mesuré par les parcours `e2e/alert-contrast.spec.ts` et `e2e/focus-contrast.spec.ts`.',
    'NON mesuré — la taille de rendu : le seuil « grand texte » (3 : 1) n’est jamais appliqué à ' +
      'du texte, ce qui rend la mesure trop sévère plutôt que trop indulgente.',
  ]
}

export type ContrastReport = {
  /** Une ligne par paire : variante, mode, rapport mesuré, seuil, verdict. */
  readonly lines: readonly string[]
  /** Les paires sous le seuil. Non vide ⇒ la commande sort non-zéro. */
  readonly failures: readonly ContrastPair[]
}

const ratioLabel = (ratio: number): string => `${ratio.toFixed(2).replace('.', ',')} : 1`

/**
 * **La composition mesurée, écrite en toutes lettres.**
 *
 * Un fond opaque ne nomme pas de surface — il n'y en a pas sous lui qui compte.
 * Un fond teinté la nomme, parce que c'est elle qui décide du reste, et la
 * taire serait exactement l'hypothèse que s57 retire du fichier.
 */
const composition = (pair: ContrastPair): string =>
  pair.backgroundAlpha < 1
    ? `${pair.foregroundToken} sur ${pair.backgroundToken}/${Math.round(
        pair.backgroundAlpha * 100,
      )} au-dessus de ${pair.surfaceToken}`
    : `${pair.foregroundToken} sur ${pair.backgroundToken}`

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
    const verdict = pair.ratio >= pair.threshold ? 'OK' : 'ÉCHEC'

    return [
      `${pair.source}/${pair.variant}`.padEnd(28),
      pair.mode.padEnd(7),
      composition(pair).padEnd(66),
      ratioLabel(pair.ratio).padStart(11),
      `seuil ${ratioLabel(pair.threshold)} (${pair.kind})`.padEnd(28),
      verdict,
    ].join('  ')
  })

  return { lines, failures: pairs.filter((pair) => pair.ratio < pair.threshold) }
}
