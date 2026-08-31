/**
 * Les polices, **telles que le greffon de build les rend**.
 *
 * `next/font` n'est pas une bibliothèque exécutable : c'est une transformation
 * de `next build` / `next dev` qui remplace l'import par un nom de classe et
 * fait servir les fichiers depuis `/_next/static`. Hors de Next, `geist/font/*`
 * ne résout même pas — il charge `geist/dist/*.js`, qui importe le répertoire
 * `next/font/local`, ce que Node refuse (`Directory import … is not supported`).
 *
 * Ce double remplace donc **l'outil de build**, jamais une règle : les deux
 * écrans qui rendent un document (`app/layout.tsx` et `app/global-error.tsx`)
 * ne font que poser la classe sur `<html>`. Il est branché par un alias de
 * `vitest.config.ts` plutôt que par `vi.mock`, parce que le mock est résolu
 * après le chargement du vrai module et échoue donc au même endroit.
 */
const fontOf = (variable: string) => ({
  variable,
  className: variable,
  style: { fontFamily: variable },
})

export const GeistSans = fontOf('--font-geist-sans')
export const GeistMono = fontOf('--font-geist-mono')
