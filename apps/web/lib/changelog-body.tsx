import { proseComponents } from '@repo/ui'
import type { ComponentType, ReactNode } from 'react'

/**
 * Le corps d'une entrée de changelog, **compilé par le bundler** (ADR 053).
 *
 * L'`import()` porte deux segments variables, et c'est ce qui fait tenir le
 * critère 1 : le bundler en fait un **contexte** — il compile tous les `.mdx` du
 * dossier, chacun dans son morceau —, si bien qu'une entrée déposée apparaît
 * après un build sans être inscrite nulle part.
 *
 * **Aucune évaluation à l'exécution, aucun `dangerouslySetInnerHTML`** : ce que
 * l'on charge ici est un module JavaScript, et ce qu'il rend est un arbre React.
 *
 * **Une fonction, pas un composant asynchrone**, et c'est mesuré : un composant
 * qui suspend au milieu de l'arbre ne peut pas être rendu par
 * `renderToStaticMarkup`, que `tests/rendered-text.test.ts` emploie pour balayer
 * tous les écrans.
 */
export async function changelogBody({
  locale,
  slug,
}: {
  readonly locale: string
  readonly slug: string
}): Promise<ReactNode> {
  const loaded = (await import(`../../../content/changelog/${locale}/${slug}.mdx`)) as {
    readonly default: ComponentType<{ readonly components?: typeof proseComponents }>
  }
  const Content = loaded.default

  return <Content components={proseComponents} />
}
