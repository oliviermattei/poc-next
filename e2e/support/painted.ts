
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
