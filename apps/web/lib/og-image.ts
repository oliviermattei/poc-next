/**
 * **L'image de partage par défaut** (s53).
 *
 * Un fichier statique unique, servi par l'application (`apps/web/public`), et
 * non un gabarit rendu à la requête : le design system n'a **ni gabarit
 * d'image sociale, ni dimensions, ni jetons applicables** — c'est le manque
 * n°2 de `docs/designs/s29-blog-mdx.md`, et un manque se signale plutôt que se
 * comble en passant. La décision complète, ses options rejetées et ce que le
 * système ne couvre toujours pas vivent dans `scripts/og-image.ts`, qui produit
 * le fichier depuis les jetons du dépôt, et dans l'ADR 054.
 *
 * **Le chemin est relatif, et c'est voulu** : Next le rend absolu contre
 * `metadataBase` (`app/layout.tsx`), qui vient d'`APP_URL`. Écrire l'URL
 * absolue ici obligerait à lire `APP_URL` pendant le rendu des métadonnées,
 * donc à échouer pendant un build qui n'en a pas.
 *
 * **La politique de sécurité du contenu ne gagne rien** : l'image est sur notre
 * origine, que `img-src 'self'` couvre déjà.
 */
export const DEFAULT_OG_IMAGE = '/og-default.png'
