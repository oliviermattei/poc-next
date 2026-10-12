/**
 * **La marque d'une page en attente de rédaction.**
 *
 * Chaque page du plan existe dès le départ, dans les deux langues, pour
 * qu'aucun lien ne soit jamais mort : tant que son contenu n'est pas écrit,
 * son corps porte cette chaîne, exactement, suivie d'une phrase qui le dit.
 * C'est un commentaire MDX : il ne s'affiche pas.
 *
 * Rédiger une page, c'est retirer la marque. La chaîne est déclarée ici une
 * seule fois, pour qu'un test puisse un jour refuser une page qui la porte
 * encore, sans la recopier.
 */
export const PLACEHOLDER_MARKER = '{/* PAGE-EN-ATTENTE */}'
