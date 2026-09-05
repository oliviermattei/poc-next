import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  CONTRAST_THRESHOLD,
  ContrastRuleError,
  contrastPairs,
  contrastReport,
} from './contrast-rules'

/**
 * **`pnpm test:contrast`** (s49) — le contraste de l'`Alert`, mesuré sur les
 * jetons livrés.
 *
 * ## Pourquoi une commande, et pas seulement un correctif
 *
 * s28 a déplacé un refus d'authentification vers la variante `warning`, alors
 * mesurée à **1,83 : 1** en mode clair : la seule explication qu'un utilisateur
 * bloqué reçoit était illisible, et rien dans le dépôt ne pouvait le dire. Un
 * correctif sans cette commande laisserait un contraste qu'un futur ajustement
 * de jeton casserait en silence — « une règle qu'aucune commande ne vérifie est
 * de la documentation, pas une règle » (`AGENTS.md`).
 *
 * ## Ce qu'elle vérifie, et ce qu'elle ne vérifie pas
 *
 * Elle vérifie : chaque variante de `packages/ui/src/components/alert.tsx`, dans
 * les deux thèmes, texte sur teinte composée au-dessus de la carte, contre le
 * seuil WCAG AA du **texte normal** (4,5 : 1 — l'`Alert` rend du `text-sm`, le
 * seuil « grand texte » à 3 : 1 ne s'y applique pas).
 *
 * Elle ne vérifie pas : les bordures `border-<sem>/50` (éléments non textuels,
 * seuil 3 : 1), les badges, les icônes, les états de focus, ni aucun autre
 * composant. Et elle ne remplace pas un rendu : le fond effectif est **supposé**
 * être la carte, c'est le navigateur qui le confirme.
 *
 * Tout est **dérivé** — les variantes du composant, les valeurs de la feuille de
 * style. Une table recopiée resterait verte après un changement de jeton, ce qui
 * est exactement le faux vert que cette commande existe pour empêcher. Les
 * règles vivent dans `scripts/contrast-rules.ts` et `tests/contrast.test.ts` les
 * éprouve sur des paires connues, extérieures à ce dépôt.
 */

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8')

const ALERT = 'packages/ui/src/components/alert.tsx'
const STYLESHEET = 'packages/ui/src/styles.css'

const main = (): void => {
  const pairs = contrastPairs({ alert: read(ALERT), stylesheet: read(STYLESHEET) })
  const report = contrastReport(pairs)

  console.log(`Contraste de l’Alert — ${ALERT} × ${STYLESHEET}`)
  console.log(`Seuil : ${CONTRAST_THRESHOLD.toFixed(2).replace('.', ',')} : 1 (WCAG AA, texte normal)`)
  console.log('')

  for (const line of report.lines) {
    console.log(line)
  }

  console.log('')

  if (report.failures.length > 0) {
    console.error(
      `${report.failures.length} paire(s) sous le seuil : ` +
        `${report.failures.map((pair) => `${pair.variant} (${pair.mode})`).join(', ')}.`,
    )
    process.exitCode = 1

    return
  }

  console.log(`${report.lines.length} paires mesurées, toutes au-dessus du seuil.`)
}

try {
  main()
} catch (error) {
  if (error instanceof ContrastRuleError) {
    // Un refus de la dérivation n'est pas un contraste trop faible : c'est la
    // commande qui a cessé de mesurer ce qu'elle annonce, et le distinguer
    // évite de chercher une couleur là où il n'y a qu'une extraction cassée.
    console.error(`Le contrôle de contraste refuse de conclure : ${error.message}`)
    process.exitCode = 1
  } else {
    throw error
  }
}
