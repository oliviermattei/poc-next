import { randomBytes } from 'node:crypto'

/**
 * **L'identifiant d'un périmètre invité** (ADR 047).
 *
 * Il est écrit **avant** tout paiement, dans une ligne que le webhook
 * retrouvera et promouvra vers un compte : un identifiant prévisible
 * permettrait de viser la ligne d'un autre, donc de faire promouvoir vers son
 * propre compte le paiement de quelqu'un d'autre.
 *
 * Trente-deux octets tirés du générateur **cryptographique** du système, comme
 * les jetons à usage unique de `auth` (`infrastructure/token-factory.ts`).
 * Jamais un compteur, jamais `Date.now()`, jamais `Math.random()` : les trois
 * produisent une suite dont deux valeurs voisines ne diffèrent que de quelques
 * caractères, et `tests/billing.test.ts` mesure exactement cela — deux tirages
 * doivent différer sur la plus grande partie de leur longueur.
 *
 * Il vit dans `infrastructure/` parce que le `domain` n'a pas le droit
 * d'importer un module natif de Node (ADR 006, tenu par `pnpm lint`) ; c'est le
 * `domain` qui dit la forme (`isOpaqueGuestScopeId`), et ce fichier qui la
 * produit.
 */
export const createGuestScopeIdGenerator = (): (() => string) =>
  () => randomBytes(32).toString('hex')
