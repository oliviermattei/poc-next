
import type { Rgb } from '../../scripts/contrast-rules'

/**
 * **Ce que le navigateur a peint sous un texte**, extrait de
 * `e2e/alert-contrast.spec.ts` par s46 pour être employé par un second
 * parcours — le contraste des écrans d'authentification.
 *
 * Rien n'a changé du calcul : les fonds sont empilés de la racine vers
 * l'élément dans un `canvas` d'un pixel, c'est Chromium qui lit `oklch(…)` ou
 * le `color-mix` que Tailwind émet, et la lecture du pixel rend le sRGB à huit
 * bits. Une couleur que le navigateur ne saurait pas repeindre **arrête** la
 * mesure au lieu d'en rendre une fausse.
 *
 * Ce que ce fichier ne dit pas : quelle surface est sous l'élément. Il la
 * **mesure**, contrairement à `pnpm test:contrast`, qui la suppose.
 */

/**
 * Ce que la mesure demande à son sujet : savoir évaluer une fonction sur son
 * nœud. `Locator` et `ElementHandle` le savent tous les deux, et c'est tout ce
 * dont ce fichier a besoin — les nommer par leur type ferait une union que
 * TypeScript refuse d'appeler.
 */
export type Paintable = {
  evaluate<R>(pageFunction: (node: HTMLElement) => R): Promise<R>
}

export type Painted = {
  /** La couleur du texte, telle que le navigateur l'a peinte, en sRGB [0, 1]. */
  readonly text: Rgb
  /** Le fond effectif sous ce texte, tous calques composés. */
  readonly background: Rgb
  readonly textHex: string
  readonly backgroundHex: string
}

/**
 * **Ce que le navigateur a peint sous ce texte**, et non ce qu'un convertisseur
 * en déduit.
 *
 * Les fonds sont empilés de la racine vers l'élément dans un `canvas` de un
 * pixel : c'est Chromium qui lit `oklch(…)` ou le `color-mix` que Tailwind
 * émet, c'est lui qui compose l'alpha, et la lecture du pixel rend le sRGB à
 * huit bits — celui de l'écran. Une couleur que le navigateur ne saurait pas
 * repeindre **arrête** la mesure au lieu d'en rendre une fausse.
 *
 * **Un `Locator` ou une poignée d'élément**, et ce n'est pas une commodité : un
 * balayage qui filtre les éléments d'un écran puis les mesure par `nth(i)` lit
 * deux fois le DOM, et le second est un autre document dès que quelque chose
 * arrive entre les deux — l'hydratation, par exemple. Mesuré en s46 : le lien
 * attendu à l'indice 14 était devenu un séparateur, et le cas rougissait sur un
 * élément qui ne porte pas de texte. Une poignée désigne **le** nœud.
 */
export const painted = async (element: Paintable): Promise<Painted> =>
  await element.evaluate((node: HTMLElement) => {
    const layers: string[] = []

    for (let current: Element | null = node; current !== null; current = current.parentElement) {
      layers.push(window.getComputedStyle(current).backgroundColor)
    }

    const canvas = document.createElement('canvas')

    canvas.width = 1
    canvas.height = 1

    const context = canvas.getContext('2d')

    if (context === null) {
      throw new Error('Aucun contexte 2d : le navigateur ne peut pas rendre sa propre mesure.')
    }

    const SENTINEL = '#010203'

    const paint = (colour: string): void => {
      context.fillStyle = SENTINEL
      context.fillStyle = colour

      if (context.fillStyle === SENTINEL && colour !== SENTINEL) {
        throw new Error(
          `Le navigateur n’a pas su repeindre « ${colour} » : la mesure serait fausse, ` +
            'donc elle n’a pas lieu.',
        )
      }

      context.fillRect(0, 0, 1, 1)
    }

    const sample = (): readonly [number, number, number, number] => {
      const data = context.getImageData(0, 0, 1, 1).data

      return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, data[3] ?? 0]
    }

    const hex = (channels: readonly number[]): string =>
      `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`

    // De la racine vers l'alerte : l'ordre dans lequel le navigateur empile ses
    // fonds. `body` porte `--background`, opaque, donc la pile se ferme.
    for (const layer of [...layers].reverse()) {
      paint(layer)
    }

    const [br, bg, bb, ba] = sample()

    if (ba !== 255) {
      throw new Error(
        `Le fond composé sous cet élément n’est pas opaque (alpha ${ba}) : aucun calque de la pile ` +
          'ne ferme le fond, et le rapport mesuré serait celui d’un fond inventé.',
      )
    }

    paint(window.getComputedStyle(node).color)

    const [tr, tg, tb] = sample()

    return {
      text: [tr / 255, tg / 255, tb / 255] as const,
      background: [br / 255, bg / 255, bb / 255] as const,
      textHex: hex([tr, tg, tb]),
      backgroundHex: hex([br, bg, bb]),
    }
  })

export type PaintedRing = {
  /** La couleur de l'anneau, composée sur ce qui est derrière lui, en sRGB [0, 1]. */
  readonly ring: Rgb
  /** Le fond effectif **sous** l'élément focalisé, tous calques composés. */
  readonly background: Rgb
  readonly ringHex: string
  readonly backgroundHex: string
}

/**
 * **L'anneau de focus, tel que le navigateur l'a peint** (s57).
 *
 * `pnpm test:contrast` mesure `--ring` sur le papier, contre les surfaces
 * qu'elle **dérive** des classes de base des composants. Elle ne peut pas voir
 * ce qu'il y a réellement derrière un champ à l'écran. C'est ce que cette
 * mesure ajoute, et elle suit la même règle que `painted` : la couleur sort
 * d'un `canvas`, c'est-à-dire du convertisseur du navigateur, et une couleur
 * qu'il ne saurait pas repeindre **arrête** la mesure.
 *
 * **Deux pièges, tous deux mesurés en s57 sur Chromium 151** :
 *
 * 1. `box-shadow` calculé porte **cinq** calques — Tailwind v4 empile
 *    `--tw-ring-offset-shadow`, `--tw-ring-shadow`, `--tw-shadow`… — et quatre
 *    d'entre eux valent `rgba(0, 0, 0, 0) 0px 0px 0px 0px`. Prendre la première
 *    couleur venue donnait du **noir transparent** lu comme du noir opaque :
 *    21 : 1 sur fond clair, 1,17 : 1 sur fond sombre — deux chiffres faux, dont
 *    l'un aurait passé le seuil sans rien mesurer. Le calque retenu est donc
 *    celui dont l'**étalement** n'est pas nul, et deux calques étalés arrêtent
 *    la mesure plutôt que d'en choisir un ;
 * 2. la couleur n'est **pas** rendue en `rgb(…)` : Chromium sérialise le jeton
 *    en `lab(48.496 0 0)`. Une expression régulière sur `rgb(…)` ne la voit
 *    pas. Le `canvas` la lit, lui, quel qu'en soit l'espace.
 *
 * L'anneau est un `box-shadow` posé **hors** de la boîte : il tombe sur la
 * surface du parent, jamais sur le fond de l'élément. La pile de fonds part
 * donc du parent.
 */
export const paintedRing = async (element: Paintable): Promise<PaintedRing> =>
  await element.evaluate((node: HTMLElement) => {
    const shadow = window.getComputedStyle(node).boxShadow

    if (shadow === '' || shadow === 'none') {
      throw new Error(
        'Aucune ombre portée sur l’élément focalisé : l’anneau de focus n’est pas peint, et ' +
          'mesurer son contraste reviendrait à mesurer une couleur qui n’est pas à l’écran.',
      )
    }

    // Les calques sont séparés par des virgules **hors parenthèses** :
    // `lab(48.496 0 0)` en contient, et une découpe naïve la couperait en trois.
    const layers: string[] = []
    let depth = 0
    let current = ''

    for (const character of shadow) {
      if (character === '(') {
        depth += 1
      } else if (character === ')') {
        depth -= 1
      }

      if (character === ',' && depth === 0) {
        layers.push(current)
        current = ''
      } else {
        current += character
      }
    }

    layers.push(current)

    const LENGTH = /^-?[\d.]+(px|em|rem)$/

    const spread = layers.filter((layer) => {
      const lengths = layer
        .trim()
        .split(/\s+/)
        .filter((token) => LENGTH.test(token))

      return lengths.length >= 4 && Number.parseFloat(lengths[3] ?? '0') !== 0
    })

    if (spread.length !== 1) {
      throw new Error(
        `${spread.length} calque(s) d’ombre à étalement non nul dans « ${shadow} » : le contrôle ` +
          'refuse plutôt que d’en choisir un. Un seul est l’anneau de focus.',
      )
    }

    const colour = (spread[0] ?? '')
      .trim()
      .split(/\s+/)
      .filter((token) => !LENGTH.test(token) && token !== 'inset')
      .join(' ')

    const canvas = document.createElement('canvas')

    canvas.width = 1
    canvas.height = 1

    const context = canvas.getContext('2d')

    if (context === null) {
      throw new Error('Aucun contexte 2d : le navigateur ne peut pas rendre sa propre mesure.')
    }

    const SENTINEL = '#010203'

    const paint = (value: string): void => {
      context.fillStyle = SENTINEL
      context.fillStyle = value

      if (context.fillStyle === SENTINEL && value !== SENTINEL) {
        throw new Error(
          `Le navigateur n’a pas su repeindre « ${value} » : la mesure serait fausse, ` +
            'donc elle n’a pas lieu.',
        )
      }

      context.fillRect(0, 0, 1, 1)
    }

    const sample = (): readonly [number, number, number, number] => {
      const data = context.getImageData(0, 0, 1, 1).data

      return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, data[3] ?? 0]
    }

    const hex = (channels: readonly number[]): string =>
      `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`

    const layersBehind: string[] = []

    for (
      let current2: Element | null = node.parentElement;
      current2 !== null;
      current2 = current2.parentElement
    ) {
      layersBehind.push(window.getComputedStyle(current2).backgroundColor)
    }

    for (const layer of [...layersBehind].reverse()) {
      paint(layer)
    }

    const [br, bg, bb, ba] = sample()

    if (ba !== 255) {
      throw new Error(
        `Le fond composé derrière cet élément n’est pas opaque (alpha ${ba}) : aucun calque de la ` +
          'pile ne ferme le fond, et le rapport mesuré serait celui d’un fond inventé.',
      )
    }

    paint(colour)

    const [rr, rg, rb] = sample()

    return {
      ring: [rr / 255, rg / 255, rb / 255] as const,
      background: [br / 255, bg / 255, bb / 255] as const,
      ringHex: hex([rr, rg, rb]),
      backgroundHex: hex([br, bg, bb]),
    }
  })
