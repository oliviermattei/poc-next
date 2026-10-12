import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'

import type { Lang } from './feature-grid'

/** Les options communes à la mise en page, dans une langue. */
export function baseOptions(lang: Lang): BaseLayoutProps {
  return {
    nav: {
      title: lang === 'fr' ? 'Guide du propriétaire du projet' : 'Project owner’s Guide',
      url: `/${lang}/`,
    },
  }
}
