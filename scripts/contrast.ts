import {
  CONTRAST_THRESHOLDS,
  ContrastRuleError,
  contrastNotes,
  contrastReport,
  measureContrast,
} from './contrast-rules'
import { COMPONENTS_DIRECTORY, STYLESHEET_PATH, deliveredContrastInput } from './contrast-sources'

/**
 * **`pnpm test:contrast`** — le contraste des jetons livrés, mesuré sur les
 * fichiers livrés (s49, élargie par s57).
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
 * ## Ce qu'elle vérifie
 *
 * Chaque chaîne de classes des composants de `packages/ui/src/components` qui
 * peint **au repos** un fond et un texte, dans les deux thèmes, plus l'anneau
 * de focus contre les surfaces sur lesquelles il tombe. Deux espèces, donc deux
 * seuils : **4,5 : 1** pour du texte, **3 : 1** pour un indicateur non textuel
 * (s57 — un seuil unique serait faux dans un sens ou dans l'autre).
 *
 * ## Ce qu'elle ne vérifie pas
 *
 * **La liste est imprimée par la commande elle-même**, et elle est en partie
 * dérivée de ce que le balayage a rencontré : la recopier ici la ferait vieillir
 * à côté du code, et une commande verte suggérerait une couverture qu'elle n'a
 * pas — le reproche que le dépôt s'est déjà fait deux fois.
 *
 * Tout est **dérivé** — les fichiers, leurs classes, les valeurs de la feuille
 * de style, les surfaces. Une table recopiée resterait verte après un changement
 * de jeton, ce qui est exactement le faux vert que cette commande existe pour
 * empêcher. Les règles vivent dans `scripts/contrast-rules.ts`, la lecture du
 * disque dans `scripts/contrast-sources.ts`, et `tests/contrast.test.ts` les
 * éprouve sur des paires connues, extérieures à ce dépôt.
 */

const label = (ratio: number): string => ratio.toFixed(2).replace('.', ',')

const main = (): void => {
  const measurement = measureContrast(deliveredContrastInput())
  const report = contrastReport(measurement.pairs)

  console.log(`Contraste des jetons — ${COMPONENTS_DIRECTORY}/*.tsx × ${STYLESHEET_PATH}`)
  console.log(
    `Seuils : ${label(CONTRAST_THRESHOLDS.texte)} : 1 pour du texte (WCAG AA, texte normal), ` +
      `${label(CONTRAST_THRESHOLDS.indicateur)} : 1 pour un indicateur non textuel (SC 1.4.11).`,
  )
  console.log('')

  for (const line of report.lines) {
    console.log(line)
  }

  console.log('')

  // **Ce que la commande ne mesure pas, avant son verdict et quel qu'il soit.**
  // Le critère 4 de s57 : écrit dans un document seul, personne ne le lit au
  // moment où la ligne verte s'affiche.
  for (const note of contrastNotes(measurement)) {
    console.log(note)
  }

  console.log('')

  if (report.failures.length > 0) {
    console.error(
      `${report.failures.length} paire(s) sous leur seuil : ` +
        `${report.failures
          .map(
            (pair) =>
              `${pair.source}/${pair.variant} (${pair.mode}, ${label(pair.ratio)} : 1 contre ` +
              `${label(pair.threshold)} : 1)`,
          )
          .join(', ')}.`,
    )
    process.exitCode = 1

    return
  }

  console.log(`${report.lines.length} paires mesurées, toutes au-dessus de leur seuil.`)
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
