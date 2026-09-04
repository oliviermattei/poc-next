import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Pagination,
} from '@repo/ui'

import { BLOG_PATH, articlePath, type BlogListView } from '../application/blog-catalog'
import { formatArticleDate } from '../domain/article'
import { BLOG_KEYS } from '../domain/message-keys'
import type { BlogIntl } from './blog-intl'

/**
 * La liste des articles : en-tête, filtres par tag, grille de cartes,
 * pagination.
 *
 * **Le tag actif se distingue par la primaire, jamais par une couleur
 * sémantique** : `s49-contraste-des-alertes` a mesuré que les quatre variantes
 * sémantiques passent sous le seuil WCAG AA en thème clair, et un tag n'est de
 * toute façon pas un état métier. Le lien actif porte en plus
 * `aria-current="true"` — la couleur seule ne dit rien à un lecteur d'écran, et
 * c'est ce qui rend la distinction lisible sans elle.
 *
 * **Les filtres sont des liens**, pas des boutons : chaque tag est une URL, donc
 * partageable et indexable, et la page fonctionne avant l'hydratation.
 */
export interface BlogListProps {
  readonly view: BlogListView
  readonly intl: BlogIntl
}

const hrefFor = (
  intl: BlogIntl,
  input: { readonly tag: string | null; readonly page: number },
): string => {
  const query = new URLSearchParams()

  if (input.tag !== null) {
    query.set('tag', input.tag)
  }

  if (input.page > 1) {
    query.set('page', String(input.page))
  }

  const search = query.toString()
  const base = intl.path(BLOG_PATH)

  // Deux formes, sans gabarit imbriqué : le détecteur de texte en dur de
  // `tests/i18n.test.ts` découpe les gabarits sur `${…}` par une expression qui
  // ne gère pas l'imbrication, et lirait le fragment restant comme une phrase.
  return search === '' ? base : `${base}?${search}`
}

export function BlogList({ view, intl }: BlogListProps) {
  const allHref = hrefFor(intl, { tag: null, page: 1 })

  return (
    <div className="min-w-0 space-y-8">
      <PageHeader title={intl.t(BLOG_KEYS.listTitle)} description={intl.t(BLOG_KEYS.listDescription)} />

      {view.tags.length > 0 ? (
        <nav aria-label={intl.t(BLOG_KEYS.tagsLabel)} className="flex flex-wrap gap-2">
          <a href={allHref} aria-current={view.activeTag === null ? 'true' : undefined}>
            <Badge variant={view.activeTag === null ? 'default' : 'outline'}>
              {intl.t(BLOG_KEYS.tagsAll)}
            </Badge>
          </a>
          {view.tags.map((tag) => (
            <a
              key={tag}
              href={hrefFor(intl, { tag, page: 1 })}
              aria-current={view.activeTag === tag ? 'true' : undefined}
            >
              <Badge variant={view.activeTag === tag ? 'default' : 'outline'}>{tag}</Badge>
            </a>
          ))}
        </nav>
      ) : null}

      {view.articles.length === 0 ? (
        <EmptyState
          title={intl.t(view.activeTag === null ? BLOG_KEYS.emptyTitle : BLOG_KEYS.emptyTagTitle)}
          description={intl.t(
            view.activeTag === null ? BLOG_KEYS.emptyDescription : BLOG_KEYS.emptyTagDescription,
          )}
          action={
            <Button variant="outline" asChild>
              <a href={view.activeTag === null ? intl.path('/') : allHref}>
                {intl.t(
                  view.activeTag === null ? BLOG_KEYS.emptyAction : BLOG_KEYS.emptyTagAction,
                )}
              </a>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {view.articles.map((article) => (
            <Card key={`${article.locale}/${article.slug}`} className="min-w-0">
              <CardHeader className="space-y-2">
                <CardTitle>
                  <a href={intl.path(articlePath(article.slug))} className="hover:underline">
                    {article.title}
                  </a>
                </CardTitle>
                <CardDescription>{article.description}</CardDescription>
                <p className="text-xs text-muted-foreground">
                  <time dateTime={article.date}>{formatArticleDate(article)}</time>
                  {/* Le point médian dans son propre élément : collé au nom, il
                      formerait un seul nœud de texte avec lui, et
                      `tests/rendered-text.test.ts` ne pourrait plus reconnaître
                      la donnée « auteur » qu'il balaie. */}
                  <span aria-hidden> · </span>
                  <span>{article.author}</span>
                </p>
                <div className="flex flex-wrap gap-1">
                  {article.tags.map((tag) => (
                    <Badge key={tag} variant="outline">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      {view.pageCount > 1 ? (
        <Pagination
          page={view.page}
          pageCount={view.pageCount}
          hrefFor={(page) => hrefFor(intl, { tag: view.activeTag, page })}
          label={intl.t(BLOG_KEYS.paginationLabel)}
          previousLabel={intl.t(BLOG_KEYS.paginationPrevious)}
          nextLabel={intl.t(BLOG_KEYS.paginationNext)}
          pageLabel={(page) => intl.t(BLOG_KEYS.paginationPage, { page })}
        />
      ) : null}
    </div>
  )
}
