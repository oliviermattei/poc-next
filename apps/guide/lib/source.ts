import { llms, loader } from 'fumadocs-core/source'
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema'
import { defineDocs } from 'fumadocs-mdx/macro'

import { i18n } from './i18n'

/**
 * Les pages du Guide : `content/docs`, le français dans `page.mdx`, l'anglais
 * dans `page.en.mdx` à côté. Le titre et la description de chaque page sont
 * validés par `pageSchema` au build.
 */
const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    schema: pageSchema,
    postprocess: { includeProcessedMarkdown: true },
  },
  meta: { schema: metaSchema },
})

export const source = loader({
  i18n,
  baseUrl: '/',
  source: docs.toFumadocsSource(),
})

/** Le Guide entier en Markdown, pour qu'un assistant IA le lise d'un coup. */
export const guideLlms = llms(source, {
  renderPage: async (page) =>
    `# ${page.data.title} (${page.url})\n\n${await page.data.getText('processed')}`,
})
