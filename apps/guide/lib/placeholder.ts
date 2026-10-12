/**
 * **La marque d'une page en attente de rédaction.**
 *
 * Chaque page du plan existe dès le départ, dans les deux langues, pour
 * qu'aucun lien ne soit jamais mort : tant que son contenu n'est pas écrit,
 * son corps porte cette chaîne, exactement, suivie d'une phrase qui le dit.
 * C'est un commentaire MDX : il ne s'affiche pas.
 *
 * Rédiger une page, c'est retirer la marque. Toutes le sont (#203) :
 * `tests/guide.test.ts` refuse désormais une page qui la porte, et lit la
 * chaîne ici plutôt que de la recopier.
 */
export const PLACEHOLDER_MARKER = '{/* PAGE-EN-ATTENTE */}'
