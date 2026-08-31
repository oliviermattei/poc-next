'use client'

import { ThemeProvider as NextThemeProvider, type ThemeProviderProps } from 'next-themes'

/**
 * Le thème, piloté par la **classe** `.dark` sur `<html>`.
 *
 * Pas par `prefers-color-scheme` seul : le commutateur doit pouvoir contredire
 * le système, et le choix persiste entre deux sessions — `next-themes` l'écrit
 * dans le stockage local et repose la classe **avant le premier rendu**, par un
 * script en ligne, ce qui est ce qui évite le clignotement.
 *
 * `defaultTheme="system"` n'est pas une contradiction : c'est la valeur tant que
 * personne n'a choisi. Dès qu'un choix est fait, il gagne.
 *
 * `nonce` est transmis tel quel : le socle de sécurité impose un nonce par
 * requête à la politique de sécurité du contenu (§1). La story qui pose la CSP
 * n'a alors rien à changer ici.
 */
export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemeProvider>
  )
}
