import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'

import type { Lang, Localized } from './i18n'

const TITLE: Localized = {
  fr: 'Guide du propriétaire du projet',
  en: 'Project owner’s Guide',
}

/** Les options communes à la mise en page, dans une langue. */
export function baseOptions(lang: Lang): BaseLayoutProps {
  return {
    nav: {
      title: TITLE[lang],
      url: `/${lang}/`,
    },
  }
}
