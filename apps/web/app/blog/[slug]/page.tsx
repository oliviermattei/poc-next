import { articleOf, articlePath } from '@repo/module-blog'
import { BlogArticleView } from '@repo/module-blog/presentation'
import { MarketingFooter } from '@repo/module-marketing/presentation'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { z } from 'zod'

import { blogCatalog } from '../../../lib/blog'
import { articleBody } from '../../../lib/blog-body'
import { DEFAULT_OG_IMAGE } from '../../../lib/og-image'
import { publicFooterLinks } from '../../../lib/footer'
import { appIntl } from '../../../lib/i18n'
import { marketingFormsAvailable, marketingSite } from '../../../lib/marketing'

/**
 * Un article.
 *
 * Le paramètre de route est une **entrée**, donc validé par Zod avant d'être
 * regardé (`docs/security.md` §4) : sa forme acceptée est celle d'un slug, et
 * ce qui ne la respecte pas n'atteint jamais la recherche. Un slug bien formé
 * mais absent **de cette langue** n'existe pas davantage — `articleOf` rend
 * `null`, et la page répond 404. C'est la moitié « article » du critère i18n :
 * on ne sert jamais le français sur une URL anglaise.
 *
 * Module coupé, le catalogue est vide : toutes les URL de cette forme répondent
 * 404, sans qu'une seule ligne ne nomme un module.
 */
const articleParam = z.object({ slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/) })

const requestedSlug = async (
  params: Promise<Record<string, string | string[] | undefined>>,
): Promise<string | null> => {
  const parsed = articleParam.safeParse(await params)

  return parsed.success ? parsed.data.slug : null
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Record<string, string | string[] | undefined>>
}): Promise<Metadata> {
  const { locale, path } = await appIntl()
  const slug = await requestedSlug(params)
  const article = slug === null ? null : articleOf(blogCatalog, { locale, slug })

  if (article === null) {
    return {}
  }

  return {
    title: article.title,
    description: article.description,
    authors: [{ name: article.author }],
    keywords: [...article.tags],
    openGraph: {
      title: article.title,
      description: article.description,
      type: 'article',
      locale,
      publishedTime: article.date,
      authors: [article.author],
      tags: [...article.tags],
      // L'image de partage de l'article, ou celle de l'application. Un article
      // sans image serait partagé sans aperçu, c'est-à-dire à peu près jamais
      // (critère 3 de s53).
      images: [article.image ?? DEFAULT_OG_IMAGE],
    },
    // La canonique est l'URL **servie dans cette langue** : la même valeur en
    // `fr` et en `en` fusionnerait les deux versions pour un moteur.
    alternates: { canonical: path(articlePath(article.slug)) },
  }
}

export default async function BlogArticlePage({
  params,
}: {
  params: Promise<Record<string, string | string[] | undefined>>
}) {
  const { locale, t, path } = await appIntl()
  const slug = await requestedSlug(params)
  const article = slug === null ? null : articleOf(blogCatalog, { locale, slug })

  if (article === null) {
    notFound()
  }

  return (
    <>
      <BlogArticleView article={article} intl={{ t, path }}>
        {await articleBody({ locale: article.locale, slug: article.slug })}
      </BlogArticleView>
      {marketingFormsAvailable ? (
        <MarketingFooter
          site={marketingSite}
          intl={{ t, path }}
          extraLinks={publicFooterLinks(t)}
        />
      ) : null}
    </>
  )
}
