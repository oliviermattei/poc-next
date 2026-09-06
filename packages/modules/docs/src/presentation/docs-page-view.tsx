import {
  Alert,
  AlertDescription,
  AlertTitle,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  PROSE_CLASSNAME,
} from '@repo/ui'
import type { ReactNode } from 'react'

import { DOCS_PATH, docsPagePath, type DocsNavigationSection } from '../application/docs-catalog'
import type { DocsSearchEntry } from '../application/docs-search'
import type { DocsPage } from '../domain/docs-page'
import { DOCS_KEYS } from '../domain/message-keys'
import type { DocsIntl } from './docs-intl'
import { DocsMobileSidebar } from './docs-mobile-sidebar'
import { DocsSearch } from './docs-search'
import { DocsSidebar } from './docs-sidebar'
import { DocsToc } from './docs-toc'

/**
 * Une page de documentation : navigation latérale, fil d'Ariane, corps, sommaire.
 *
 * **Le corps arrive en `children`**, déjà compilé. Ce composant ne connaît ni
 * MDX, ni le système de fichiers : c'est l'application qui charge le module
 * compilé par le bundler (ADR 053), et c'est ce qui rend cette vue rendable dans
 * un test sans bundler.
 *
 * **Trois colonnes au-delà de `lg`**, une seule en dessous — et la navigation
 * comme le sommaire y sont rendus **une seconde fois**, jamais en même temps :
 * l'un est en `display: none` pendant que l'autre est monté, donc l'arbre
 * d'accessibilité n'en voit qu'un. C'est le motif d'`app-navigation.tsx` (s08),
 * et deux navigations portant le même nom accessible seraient indistinguables
 * pour un lecteur d'écran comme pour un parcours de test.
 *
 * **Aucun état de chargement, et c'est une décision** : poser un `loading.tsx`
 * sur un segment vide la coquille **avant** que la page ne décide, si bien
 * qu'un `notFound()` arrive en HTTP 200 — mesuré en s29 sur trois placements. Le
 * 404 est une règle du socle de sécurité.
 *
 * `min-w-0` revient partout : un élément de grille a `min-width: auto` par
 * défaut, si bien qu'un bloc de code large pousse la page au lieu de défiler
 * dans son cadre. C'est la cause n°1 de débordement horizontal sous 400 px.
 */
export interface DocsPageViewProps {
  readonly tree: readonly DocsNavigationSection[]
  readonly page: DocsPage
  /**
   * `false` quand la page servie est celle de la langue par défaut faute de
   * traduction. C'est **l'inverse du blog** : un article sans traduction
   * disparaît de sa langue, une page de documentation se sert quand même.
   */
  readonly translated: boolean
  /**
   * L'index de recherche de la langue servie, **construit au build** (s54).
   *
   * Vide quand le module est coupé, et la palette disparaît alors avec lui —
   * aucune ligne de cet écran ne nomme un module.
   */
  readonly search: readonly DocsSearchEntry[]
  readonly intl: DocsIntl
  /** Le corps compilé de la page. */
  readonly children: ReactNode
}

export function DocsPageView({
  tree,
  page,
  translated,
  search,
  intl,
  children,
}: DocsPageViewProps) {
  const section = tree.find((entry) => entry.section === page.section)
  /*
   * **Les `href` sont mis en forme ici, une fois.** La navigation latérale est
   * montée dans un `Sheet` sous `lg`, donc dans un composant client, et une
   * fonction ne traverse pas la frontière serveur → client — mesuré au
   * navigateur, en HTTP 500, sur la première version de cet écran. Ce composant
   * est le dernier à connaître `intl` ; en dessous, tout est déjà résolu.
   */
  const sections = tree.map((entry) => ({
    ...entry,
    pages: entry.pages.map((item) => ({ ...item, href: intl.path(item.href) })),
  }))
  const currentHref = intl.path(docsPagePath(page.section, page.slug))
  const sidebarLabel = intl.t(DOCS_KEYS.sidebarLabel)
  const tocLabel = intl.t(DOCS_KEYS.tocLabel)
  const tocTitle = intl.t(DOCS_KEYS.tocTitle)

  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[13rem_minmax(0,1fr)_11rem] lg:items-start lg:gap-8">
      <div className="flex min-w-0 flex-col gap-3 lg:col-start-1 lg:row-start-1">
        {/* La recherche au-dessus de l'arbre, dans les deux dispositions :
            c'est la même colonne, et elle est la première chose qu'on lit. Les
            `href` sont mis en forme ici, comme ceux de l'arbre. */}
        <DocsSearch
          entries={search.map((entry) => ({ ...entry, href: intl.path(entry.href) }))}
          labels={{
            open: intl.t(DOCS_KEYS.searchOpen),
            title: intl.t(DOCS_KEYS.searchTitle),
            description: intl.t(DOCS_KEYS.searchDescription),
            placeholder: intl.t(DOCS_KEYS.searchPlaceholder),
            empty: intl.t(DOCS_KEYS.searchEmpty),
            results: intl.t(DOCS_KEYS.searchResults),
            close: intl.t(DOCS_KEYS.searchClose),
            untranslated: intl.t(DOCS_KEYS.searchUntranslated),
          }}
        />
        {/* Sous `lg` : un déclencheur qui ouvre la navigation dans un `Sheet`.
            À partir de `lg` : la colonne, dans le flux. */}
        <DocsMobileSidebar
          sections={sections}
          currentHref={currentHref}
          label={sidebarLabel}
          openLabel={intl.t(DOCS_KEYS.sidebarOpen)}
          closeLabel={intl.t(DOCS_KEYS.sidebarClose)}
        />
        <div className="hidden lg:block">
          <DocsSidebar sections={sections} currentHref={currentHref} label={sidebarLabel} />
        </div>
      </div>

      <DocsToc
        headings={page.headings}
        label={tocLabel}
        title={tocTitle}
        className="hidden lg:col-start-3 lg:row-start-1 lg:block"
      />

      <div className="flex min-w-0 flex-col gap-4 lg:col-start-2 lg:row-start-1">
        <Breadcrumb label={intl.t(DOCS_KEYS.breadcrumbLabel)}>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href={intl.path(DOCS_PATH)}>
                {intl.t(DOCS_KEYS.breadcrumbHome)}
              </BreadcrumbLink>
            </BreadcrumbItem>
            {section === undefined ? null : (
              <>
                <BreadcrumbSeparator />
                <BreadcrumbItem>{section.title}</BreadcrumbItem>
              </>
            )}
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{page.title}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <header className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">{page.title}</h1>
          <p className="text-base text-muted-foreground">{page.description}</p>
        </header>

        {/* Le sommaire sous `lg` : au-dessus du corps, dans le flux, **replié** —
            déplié, il repousserait le premier paragraphe sous la ligne de
            flottaison sur une page qui a beaucoup de titres. */}
        <DocsToc
          headings={page.headings}
          label={tocLabel}
          title={tocTitle}
          collapsible
          className="rounded-lg border border-border px-4 lg:hidden"
        />

        {translated ? null : (
          /*
           * **La mention de repli.** Elle ne repose pas sur la couleur : s49 a
           * mesuré les quatre variantes sémantiques d'`Alert` sous le seuil
           * WCAG AA en thème clair, et la variante par défaut n'en porte aucune.
           *
           * `role="status"` et non `"alert"` : ce n'est pas un refus, et une
           * région vivante assertive interromprait la lecture pour une note.
           * `lang` sur l'article dit à la synthèse vocale de changer de langue —
           * sans lui, un texte français serait prononcé avec la phonétique
           * anglaise.
           */
          <Alert role="status">
            <AlertTitle>{intl.t(DOCS_KEYS.untranslatedTitle)}</AlertTitle>
            <AlertDescription>{intl.t(DOCS_KEYS.untranslatedDescription)}</AlertDescription>
          </Alert>
        )}

        <article className={PROSE_CLASSNAME} lang={page.locale}>
          {children}
        </article>
      </div>
    </div>
  )
}
