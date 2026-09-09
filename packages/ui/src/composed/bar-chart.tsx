import type { ReactNode } from 'react'

import { cn } from '../lib/cn'

/**
 * **Un histogramme d'évolution, rendu par le serveur, sans une ligne de
 * JavaScript.**
 *
 * Le back-office est entièrement servi : aucun de ses écrans n'hydrate quoi que
 * ce soit, et une bibliothèque de graphes en ferait le premier — plusieurs
 * dizaines de kilo-octets de script, sur une surface que seul l'exploitant
 * regarde. Les barres sont donc du SVG calculé ici, et la lecture précise passe
 * par le **tableau** que le composant rend sous le graphe : `<details>` et
 * `<summary>` s'ouvrent sans script.
 *
 * **C'est ce tableau qui remplace l'infobulle au survol.** Un graphe HTML est
 * normalement interactif ; celui-ci ne peut pas l'être sans script, et un graphe
 * dont on ne peut lire aucune valeur est un dessin. Le tableau est donc
 * obligatoire, pas optionnel : il porte les mêmes données, il est lisible au
 * clavier, et il est ce que lit un lecteur d'écran.
 *
 * **Une seule série, donc aucune légende** — le titre nomme ce qui est compté
 * (règle des graphes : une légende n'existe qu'à partir de deux séries). La
 * couleur ne porte aucune identité : elle dit « c'est une donnée », et le texte
 * garde les jetons de texte.
 *
 * **Aucun texte en dur** : ce package ne connaît ni catalogue ni locale
 * (`packages/ui/AGENTS.md`). Le titre, le libellé du tableau, ses en-têtes et
 * les valeurs formatées arrivent en propriété.
 */
export interface BarChartPoint {
  /** L'identité de la barre — une date ISO, un identifiant. Jamais affichée. */
  readonly id: string
  /** Ce que lit un humain : la date mise en forme par l'appelant. */
  readonly label: string
  readonly value: number
  /** La valeur telle qu'elle s'écrit — l'appelant possède la locale. */
  readonly formatted: string
}

export interface BarChartProps {
  readonly title: string
  readonly points: readonly BarChartPoint[]
  /** Le nom accessible du graphe, qui dit ce qu'il montre et sur quelle période. */
  readonly description: string
  /** Ce qu'ouvre le `<details>` : « Voir les valeurs ». */
  readonly tableLabel: string
  readonly columns: { readonly label: string; readonly value: string }
  /** Ce qui s'affiche quand la série est vide — jamais un graphe plat. */
  readonly emptyLabel: string
  readonly className?: string
  readonly footer?: ReactNode
}

/** La hauteur du dessin, en unités de la boîte de vue. */
const HEIGHT = 100
/** L'écart entre deux barres, dans la même unité : deux pixels de surface. */
const GAP = 0.35

export function BarChart({
  title,
  points,
  description,
  tableLabel,
  columns,
  emptyLabel,
  className,
  footer,
}: BarChartProps) {
  const maximum = points.reduce((highest, point) => Math.max(highest, point.value), 0)
  const width = Math.max(points.length, 1)

  return (
    <figure className={cn('flex min-w-0 flex-col gap-3', className)} data-slot="bar-chart">
      <figcaption className="text-sm font-medium text-foreground">{title}</figcaption>

      {points.length === 0 || maximum === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <svg
          role="img"
          aria-label={description}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          preserveAspectRatio="none"
          className="h-32 w-full"
        >
          {points.map((point, index) => {
            // La barre part **toujours** de la ligne de base : une hauteur
            // proportionnelle mesurée depuis le haut mentirait sur le zéro.
            const height = (point.value / maximum) * HEIGHT

            return (
              <rect
                key={point.id}
                x={index + GAP / 2}
                y={HEIGHT - height}
                width={1 - GAP}
                height={height}
                // `rx` en unités de la boîte de vue : l'étirement horizontal
                // l'aplatirait, ce qui est voulu — l'extrémité reste douce sans
                // que la barre ne devienne une gélule.
                rx={0.2}
                className="fill-primary"
              />
            )
          })}
        </svg>
      )}

      <details className="min-w-0">
        <summary className="cursor-pointer text-sm text-muted-foreground">{tableLabel}</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th scope="col" className="py-1 font-medium">
                  {columns.label}
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  {columns.value}
                </th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.id} className="border-t border-border">
                  <td className="py-1">{point.label}</td>
                  <td className="py-1 text-right tabular-nums">{point.formatted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {footer}
    </figure>
  )
}
