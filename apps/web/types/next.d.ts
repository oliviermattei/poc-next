/**
 * Références de types de Next, versionnées.
 *
 * Next écrit `apps/web/next-env.d.ts` à chaque `dev` et à chaque `build`, avec
 * des chemins qui changent selon la commande (`.next/dev/types/…` en
 * développement, `.next/types/…` au build — voir
 * `next/dist/lib/typescript/writeAppTypeDeclarations.js`). Versionné, ce
 * fichier salit donc l'arbre après chaque build ; c'est pourquoi il est ignoré
 * par git.
 *
 * Ne restent ici que les deux directives stables, celles qui n'ont jamais
 * dépendu de la commande. Sans elles, un clone vierge n'aurait aucun type
 * global de Next tant que personne n'a lancé `dev` ou `build` : `pnpm
 * typecheck` deviendrait dépendant d'un artefact généré.
 *
 * Les types de routes générés (`.next/types/**`) restent, eux, dans le
 * `include` du tsconfig : ils sont absents d'un clone vierge, et c'est correct
 * — ils ne décrivent que des routes déjà compilées.
 */

/// <reference types="next" />
/// <reference types="next/image-types/global" />
