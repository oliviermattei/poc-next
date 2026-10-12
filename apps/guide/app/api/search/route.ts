import { createFromSource } from 'fumadocs-core/search/server'

import { source } from '@/lib/source'

/**
 * L'index de recherche, exporté au build dans `out/api/search` : les deux
 * langues y sont, et le navigateur filtre sur celle de la page.
 */
export const revalidate = false

export const { staticGET: GET } = createFromSource(source)
