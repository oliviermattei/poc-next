import { ThemeProvider } from '@repo/ui'
import { GeistMono } from 'geist/font/mono'
import { GeistSans } from 'geist/font/sans'
import type { Metadata, Viewport } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'

import { currentLocale } from '../lib/current-locale'
import { AppShell } from './app-shell'
import './globals.css'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

/**
 * Les métadonnées viennent du catalogue, comme le reste : le titre d'un onglet
 * et la description d'un partage sont des textes affichés.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations()

  return {
    title: t('app.metadata.title'),
    description: t('app.metadata.description'),
  }
}

/**
 * La racine de l'application : polices, langue, thème, shell.
 *
 * **`lang` vient de la requête**, plus d'une constante `"fr"`. C'est ce que
 * lisent les lecteurs d'écran, les traducteurs automatiques et la césure des
 * navigateurs ; un attribut qui ment sur la langue du document est une
 * régression d'accessibilité invisible à l'œil.
 *
 * `NextIntlClientProvider` porte le catalogue **de la locale servie** jusqu'aux
 * composants clients. Sans lui, les formulaires — qui sont des composants
 * clients — n'auraient d'autre choix que de recevoir chaque libellé en
 * propriété, ou de le coder en dur.
 *
 * **Les polices sont servies par l'application** (`next/font` les copie dans
 * l'artefact de build). Aucune requête vers un domaine externe : une police
 * servie par un CDN serait un script tiers, donc soumise au registre de
 * consentement (s36), et elle ferait fuiter l'adresse IP de chaque visiteur
 * avant qu'il n'ait rien accepté.
 *
 * `suppressHydrationWarning` est **nécessaire** et borné à `<html>` : le script
 * de `next-themes` pose la classe `.dark` avant le premier rendu du navigateur —
 * c'est ce qui évite le clignotement —, si bien que l'attribut `class` du
 * serveur et celui du client diffèrent par construction. React signalerait cet
 * écart-là ; l'attribut ne masque que celui de cet élément, jamais celui de
 * l'arbre.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const [locale, messages] = await Promise.all([currentLocale(), getMessages()])

  return (
    <html
      lang={locale}
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider>
            <AppShell>{children}</AppShell>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
