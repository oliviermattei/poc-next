import { createProseComponents } from '@repo/ui'

import { headingAnchor } from '../domain/docs-page'

/**
 * L'échelle de prose de la documentation : celle du design system, **avec ses
 * ancres**.
 *
 * Une seule ligne, et c'est tout ce que la documentation ajoute à la
 * typographie du produit (ADR 055) : `headingAnchor` est la **même** fonction
 * que celle qui construit le sommaire depuis la source Markdown
 * (`documentHeadings`). Deux fonctions de slug donneraient un sommaire dont les
 * liens ne mènent nulle part, et rien à l'écran ne le dirait — un fragment
 * inconnu ne fait rien, il ne casse pas.
 *
 * Les deux passes ne comptent pas les occurrences (l'une lit la source, l'autre
 * rend l'arbre), donc **elles ne dédoublonnent ni l'une ni l'autre** :
 * `parseDocsPage` refuse une page dont deux titres produiraient la même ancre.
 * La divergence est rendue impossible plutôt que documentée — à la condition que
 * les deux passes portent sur les mêmes niveaux. `documentHeadings` ne dérive
 * que `##` et `###` ; `createProseComponents` ne pose donc d'ancre que sur `h2`
 * et `h3`, et `tests/docs.test.ts` tient l'accord des deux.
 */
export const docsProseComponents = createProseComponents({ headingId: headingAnchor })
