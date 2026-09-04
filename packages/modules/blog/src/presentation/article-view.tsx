import { Avatar, AvatarFallback, Badge, Button, Separator, initialsOf } from '@repo/ui'
import type { ReactNode } from 'react'

import { BLOG_PATH } from '../application/blog-catalog'
import { formatArticleDate, type BlogArticle } from '../domain/article'
import type { BlogIntl } from './blog-intl'
import { BLOG_KEYS } from '../domain/message-keys'
import { PROSE_CLASSNAME } from './prose'

/**
 * Un article : le fil de retour, l'en-tête, le corps, le retour de pied.
 *
 * **Le corps arrive en `children`**, déjà compilé. Ce composant ne connaît ni
 * MDX, ni le système de fichiers : c'est l'application qui charge le module
 * compilé par le bundler (ADR 053), et c'est ce qui rend cette vue rendable
 * dans un test sans bundler.
 *
 * **Aucun `dangerouslySetInnerHTML`**, ici ni ailleurs dans ce module : le
 * précédent de `packages/modules/marketing/src/presentation/legal-document.tsx`
 * le refuse explicitement, et une brique compilée en composants React n'en a
 * pas besoin.
 */
export interface BlogArticleViewProps {
  readonly article: BlogArticle
  readonly intl: BlogIntl
  /** Le corps compilé de l'article. */
  readonly children: ReactNode
}

export function BlogArticleView({ article, intl, children }: BlogArticleViewProps) {
  const listHref = intl.path(BLOG_PATH)

  return (
    <div className="min-w-0 space-y-6">
      <Button variant="ghost" asChild>
        <a href={listHref}>
          <span aria-hidden>←</span>
          {intl.t(BLOG_KEYS.articleBack)}
        </a>
      </Button>

      <article className={PROSE_CLASSNAME}>
        <header className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight">{article.title}</h1>
          <p className="text-base text-muted-foreground">{article.description}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-2">
              <Avatar aria-label={intl.t(BLOG_KEYS.articleAuthorLabel)}>
                <AvatarFallback>{initialsOf(article.author)}</AvatarFallback>
              </Avatar>
              {article.author}
            </span>
            <time dateTime={article.date}>{formatArticleDate(article)}</time>
            <span className="flex flex-wrap gap-1" aria-label={intl.t(BLOG_KEYS.articleTagsLabel)}>
              {article.tags.map((tag) => (
                <Badge key={tag} variant="outline">
                  {tag}
                </Badge>
              ))}
            </span>
          </div>
        </header>

        <Separator />

        {/* Le corps, déjà compilé et déjà habillé par `proseComponents` : la
            table est passée au composant MDX par l'application, qui est la
            seule à connaître le module compilé. */}
        <div className="space-y-4">{children}</div>

        <Separator />

        <Button variant="outline" asChild>
          <a href={listHref}>
            <span aria-hidden>←</span>
            {intl.t(BLOG_KEYS.articleBackToList)}
          </a>
        </Button>
      </article>
    </div>
  )
}
