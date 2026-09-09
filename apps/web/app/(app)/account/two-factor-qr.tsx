import { encode } from 'uqr'

/**
 * Le QR d'enrôlement, **rendu en JSX**.
 *
 * `uqr` ne rend pas une image : il rend une matrice booléenne. C'est ce qui
 * permet de composer le `<svg>` ici, un `<rect>` par module sombre, plutôt que
 * d'injecter une chaîne de balisage. Trois conséquences, et les trois sont des
 * règles du dépôt :
 *
 * - **aucun `dangerouslySetInnerHTML`** (`docs/security.md` §4) ;
 * - **aucun style en ligne**, donc rien à autoriser dans la politique de
 *   sécurité du contenu livrée par s45 ;
 * - **le secret ne sort pas** : il n'y a ni URL d'image, ni service tiers, ni
 *   requête réseau. La matrice est calculée là où l'URI se trouve déjà.
 *
 * `docs/designs/s13-two-factor.md` signale ce composant comme un **design
 * system gap** : `docs/design-system.md` ne couvre ni le QR ni la valeur à
 * recopier. Il vit donc dans l'écran, pas dans `packages/ui` — un besoin non
 * couvert se signale, il ne se comble pas sur place.
 *
 * Le nom accessible est une **prop obligatoire** : une image muette n'a rien à
 * faire dans un parcours de sécurité, et `packages/ui` interdirait de l'écrire
 * ici de toute façon (aucun texte en dur, s09).
 *
 * ## Les deux couleurs écrites, et pourquoi elles ne sont pas des tokens
 *
 * Un QR se lit **sombre sur clair** : la plupart des lecteurs de téléphone
 * refusent l'inverse. Peint avec `foreground` sur `background`, il s'inverse en
 * thème sombre — mesuré sur la capture `enrolment-dark-mobile`, blanc sur noir,
 * donc illisible par une bonne partie des appareils. Ce n'est pas un choix
 * d'apparence qu'un projet voudrait rethémer : c'est une contrainte du format.
 *
 * Les deux couleurs sont donc des **attributs de peinture SVG**, pas des
 * classes Tailwind — la règle du design system vise la couleur brute qui casse
 * le thème d'une **interface** (`bg-zinc-800`, `text-red-500`), et ce carré-ci
 * est une donnée, comme le serait un code-barres. Le cadre, lui, reste
 * thémable : la bordure est le token `border`.
 *
 * `docs/designs/s13-two-factor.md` le consigne comme partie du design system
 * gap : le jour où s14 demande la même chose, c'est un composé à nommer dans
 * `docs/design-system.md`, avec cette exception écrite.
 */

/** Sombre sur clair, dans les deux thèmes : c'est la contrainte du format. */
const QR_DARK = '#000000'
const QR_LIGHT = '#ffffff'
export interface TwoFactorQrProps {
  /** L'URI `otpauth://` que l'application d'authentification lit. */
  readonly value: string
  /** Nom accessible, déjà traduit par l'appelant. */
  readonly label: string
}

/** La marge silencieuse exigée par la norme : quatre modules de chaque côté. */
const QUIET_ZONE = 4

export function TwoFactorQr({ value, label }: TwoFactorQrProps) {
  const { size, data } = encode(value)
  const extent = size + QUIET_ZONE * 2

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${extent} ${extent}`}
      className="h-48 w-48 max-w-full rounded-md border border-border"
      shapeRendering="crispEdges"
    >
      {/* La marge silencieuse fait partie du code : sans fond clair, elle
          n'existe pas et le lecteur ne trouve pas les repères. */}
      <rect x={0} y={0} width={extent} height={extent} fill={QR_LIGHT} />
      {data.map((row, y) =>
        row.map((dark, x) =>
          dark ? (
            <rect
              key={`${String(x)}-${String(y)}`}
              x={x + QUIET_ZONE}
              y={y + QUIET_ZONE}
              width={1}
              height={1}
              fill={QR_DARK}
            />
          ) : null,
        ),
      )}
    </svg>
  )
}
