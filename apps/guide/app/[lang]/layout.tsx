import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import { i18nProvider } from 'fumadocs-ui/i18n'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'

import { Provider } from '@/components/provider'
import type { Lang } from '@/lib/feature-grid'
import { i18n } from '@/lib/i18n'
import { baseOptions } from '@/lib/layout.shared'
import { source } from '@/lib/source'
import { translations } from '@/lib/ui-translations'

import '../global.css'

export const dynamicParams = false

export function generateStaticParams() {
  return i18n.languages.map((lang) => ({ lang }))
}

export const metadata: Metadata = {
  title: { template: '%s · Guide', default: 'Guide' },
}

const isLang = (value: string): value is Lang =>
  (i18n.languages as readonly string[]).includes(value)

export default async function LangLayout({
  params,
  children,
}: {
  params: Promise<{ lang: string }>
  children: ReactNode
}) {
  const { lang } = await params

  if (!isLang(lang)) {
    notFound()
  }

  return (
    <html lang={lang} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <Provider i18n={i18nProvider(translations, lang)}>
          <DocsLayout tree={source.getPageTree(lang)} {...baseOptions(lang)}>
            {children}
          </DocsLayout>
        </Provider>
      </body>
    </html>
  )
}
