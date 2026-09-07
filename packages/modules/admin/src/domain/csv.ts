/**
 * **L'écriture d'un fichier CSV, et son assainissement** (s37c).
 *
 * Elle vit dans le `domain` — aucune requête HTTP, aucune table, aucun
 * composant — parce qu'elle se prouve sans base et sans navigateur, et parce
 * qu'elle porte une règle de sécurité : `packages/modules/admin/src/domain/csv.test.ts`
 * la mesure sur la **chaîne rendue**, jamais sur une intention.
 *
 * ## L'injection de formule, et pourquoi elle est réelle ici
 *
 * Une cellule dont le premier caractère est `=`, `+`, `-` ou `@` est **exécutée**
 * par un tableur à l'ouverture. Les adresses que ce fichier porte viennent
 * d'inconnus : ce sont des entrées hostiles qui traversent un fichier que
 * quelqu'un ouvrira sur son poste, hors de tout navigateur et de toute CSP.
 *
 * L'assainissement est un **préfixe apostrophe**, et non un guillemet : `"=1+1"`
 * est lu par un tableur comme le texte `=1+1`, qu'il évalue quand même. Le
 * citer protège le *format*, pas le lecteur.
 *
 * `\t` et `\r` sont neutralisés avec les autres : ce sont les mêmes amorces
 * dans les tableurs balayés par l'OWASP. **Ce sont les cas balayés, pas une
 * liste de ce qui existe** — un tableur qui en reconnaîtrait un de plus ne
 * serait pas couvert, et il faudrait l'ajouter à `FORMULA_STARTERS`, d'où le
 * test dérive son balayage. Aucun nombre n'est écrit ici : il vieillirait à
 * côté de la liste.
 *
 * ## Le format
 *
 * Point-virgule, guillemets **partout**, guillemet interne doublé (RFC 4180),
 * fin de ligne CRLF, et une marque d'ordre des octets en tête — sans elle, un
 * tableur ouvre un fichier UTF-8 dans son encodage local et abîme les accents.
 * Citer chaque cellule plutôt que celles qui en ont besoin retire une décision :
 * il n'y a pas de cas où une cellule échappe à la règle.
 */

/** Le séparateur : le point-virgule, celui qu'attend un tableur configuré en français. */
const SEPARATOR = ';'

/** La fin de ligne de RFC 4180. */
const LINE_BREAK = '\r\n'

/**
 * La marque d'ordre des octets, en tête du fichier.
 *
 * Sans elle, un tableur ouvre un fichier UTF-8 en interprétant ses octets dans
 * son encodage local : les accents deviennent illisibles, et la personne qui
 * ouvre le fichier conclut que l'export est cassé.
 */
const BYTE_ORDER_MARK = '﻿'

/**
 * Les amorces de formule neutralisées — **ce qui a été balayé**, sur ces
 * caractères, et non la liste de ce qu'un tableur pourrait exécuter.
 *
 * Exportée pour que son test la **dérive** au lieu de la recopier : une amorce
 * ajoutée ici entre alors dans le balayage sans qu'on y pense (revue de s37c,
 * constat 4).
 */
export const FORMULA_STARTERS = ['=', '+', '-', '@', '\t', '\r'] as const

/**
 * Le type de contenu du fichier, écrit une fois.
 *
 * `charset=utf-8` est déclaré en plus de la marque d'ordre des octets : l'un
 * sert au navigateur qui télécharge, l'autre au tableur qui ouvre.
 */
export const CSV_CONTENT_TYPE = 'text/csv; charset=utf-8'

/** Une cellule, assainie puis citée. Les deux, toujours, sans exception. */
const cell = (value: string): string => {
  const guarded = FORMULA_STARTERS.some((starter) => value.startsWith(starter))
    ? `'${value}`
    : value

  return `"${guarded.replaceAll('"', '""')}"`
}

/**
 * Rend le fichier CSV de ces rangées — **en-tête compris**, l'appelant le
 * fournit comme première rangée.
 *
 * Une sélection sans résultat produit un fichier avec son seul en-tête : un
 * fichier de zéro octet se lit comme un téléchargement en échec.
 */
export function toCsv(rows: readonly (readonly string[])[]): string {
  const body = rows.map((row) => row.map(cell).join(SEPARATOR)).join(LINE_BREAK)

  return `${BYTE_ORDER_MARK}${body}${LINE_BREAK}`
}
