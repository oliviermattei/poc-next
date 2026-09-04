import { proseComponents } from '@repo/module-blog/presentation'
import type { ComponentType, ReactNode } from 'react'

/**
 * Le corps d'un article, **compilé par le bundler** (ADR 053).
 *
 * L'`import()` porte deux segments variables, et c'est ce qui fait tenir le
 * critère 1 de la story : le bundler en fait un **contexte** — il compile tous
 * les `.mdx` du dossier, chacun dans son morceau —, si bien qu'un fichier
 * déposé apparaît après un build sans être inscrit nulle part. Mesuré sur
 * Turbopack : après `pnpm build`, les articles français et anglais se
 * retrouvent tous dans `.next/standalone/apps/web/.next/server/chunks/ssr/`.
 *
 * **Aucune évaluation à l'exécution, aucun `dangerouslySetInnerHTML`** : ce que
 * l'on charge ici est un module JavaScript, et ce qu'il rend est un arbre React.
 *
 * L'appelant a déjà vérifié que l'article existe dans cette langue
 * (`articleOf`) : un slug inconnu répond 404 avant d'arriver ici.
 *
 * **Une fonction, pas un composant asynchrone**, et c'est mesuré : un composant
 * qui suspend au milieu de l'arbre ne peut pas être rendu par
 * `renderToStaticMarkup`, que `tests/rendered-text.test.ts` emploie pour
 * balayer tous les écrans (« A component suspended while responding to
 * synchronous input »). La page l'attend, l'arbre est complet avant le rendu.
 */
export async function articleBody({
  locale,
  slug,
}: {
  readonly locale: string
  readonly slug: string
}): Promise<ReactNode> {
  const loaded = (await import(`../../../content/blog/${locale}/${slug}.mdx`)) as {
    readonly default: ComponentType<{ readonly components?: typeof proseComponents }>
  }
  const Content = loaded.default

  return <Content components={proseComponents} />
}
