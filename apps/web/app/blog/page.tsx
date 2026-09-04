import { BLOG_KEYS, blogListView } from '@repo/module-blog'
import { BlogList } from '@repo/module-blog/presentation'
import { MarketingFooter } from '@repo/module-marketing/presentation'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { z } from 'zod'

import { blogCatalog } from '../../lib/blog'
import { consentFooterLinks } from '../../lib/consent'
import { appIntl } from '../../lib/i18n'
import { marketingFormsAvailable, marketingSite } from '../../lib/marketing'

/**
 * La liste des articles.
 *
 * **Module coupé, elle répond 404**, comme une page légale dont le slug n'est
 * pas déclaré : la décision se lit sur `blogCatalog.index`, c'est-à-dire sur une
 * **donnée**, jamais sur l'identifiant d'un module (`apps/web/AGENTS.md`). Un
 * blog monté sans aucun article, lui, rend un état vide — les deux situations
 * ne se confondent pas.
 *
 * Les paramètres d'URL sont une **entrée**, donc validés par Zod avant d'être
 * regardés (`docs/security.md` §4). Un paramètre malformé ne fait pas d'erreur :
 * il retombe sur sa valeur par défaut. Un lien périmé n'a pas à casser une page
 * publique.
 *
 * **Chacun est validé pour lui-même, et c'est la raison d'être des deux
 * schémas** : un objet unique fait échouer la lecture entière sur un seul champ
 * illisible, si bien que `?tag=produit&page=abc` servirait la liste complète et
 * ferait disparaître le filtre demandé sans un mot. `tests/blog.test.ts` porte
 * le cas.
 *
 * Le pied de page marketing n'est rendu que si le site public existe : ses
 * libellés viennent du catalogue de `marketing`, qui disparaît avec le module.
 * La condition porte sur la **donnée** que `/contact` suit déjà, pas sur un nom
 * de module.
 */
const tagParam = z.string().min(1).max(64)
const pageParam = z.coerce.number().int().min(1)

const requestedList = async (
  searchParams: Promise<Record<string, string | string[] | undefined>>,
): Promise<{ tag: string | null; page: number }> => {
  const params = await searchParams
  const tag = tagParam.safeParse(params.tag)
  const page = pageParam.safeParse(params.page)

  return {
    tag: tag.success ? tag.data : null,
    page: page.success ? page.data : 1,
  }
}

export async function generateMetadata(): Promise<Metadata> {
  if (blogCatalog.index === null) {
    // Module coupé : les clés du blog ont disparu du catalogue avec lui, et en
    // demander une ferait tomber la page.
    return {}
  }

  const { locale, t, path } = await appIntl()
  const title = t(BLOG_KEYS.listTitle)
  const description = t(BLOG_KEYS.listDescription)

  return {
    title,
    description,
    openGraph: { title, description, type: 'website', locale },
    alternates: { canonical: path(blogCatalog.index.path) },
  }
}

export default async function BlogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (blogCatalog.index === null) {
    notFound()
  }

  const { locale, t, path } = await appIntl()
  const { tag, page } = await requestedList(searchParams)

  return (
    <>
      <BlogList view={blogListView(blogCatalog, { locale, tag, page })} intl={{ t, path }} />
      {marketingFormsAvailable ? (
        <MarketingFooter
          site={marketingSite}
          intl={{ t, path }}
          extraLinks={consentFooterLinks(t)}
        />
      ) : null}
    </>
  )
}
