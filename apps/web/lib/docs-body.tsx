import { docsProseComponents } from '@repo/module-docs/presentation'
import type { ComponentType, ReactNode } from 'react'

/**
 * Le corps d'une page de documentation, **compilé par le bundler** (ADR 053).
 *
 * L'`import()` porte trois segments variables, et c'est ce qui fait tenir le
 * critère 1 de la story : le bundler en fait un **contexte** — il compile tous
 * les `.mdx` du dossier, chacun dans son morceau —, si bien qu'un fichier
 * déposé apparaît après un build sans être inscrit nulle part.
 *
 * **Aucune évaluation à l'exécution, aucun `dangerouslySetInnerHTML`** : ce que
 * l'on charge ici est un module JavaScript, et ce qu'il rend est un arbre React.
 *
 * `locale` est celle de la page **servie**, pas celle de la requête : une page
 * non traduite retombe sur la langue par défaut, et l'appelant a déjà résolu
 * laquelle (`docsPageView`). Charger la locale demandée ferait échouer l'import
 * sur le fichier qui manque, au lieu de servir le repli.
 *
 * **Une fonction, pas un composant asynchrone**, et c'est mesuré (s29) : un
 * composant qui suspend au milieu de l'arbre ne peut pas être rendu par
 * `renderToStaticMarkup`, que `tests/rendered-text.test.ts` emploie pour
 * balayer tous les écrans. La page l'attend, l'arbre est complet avant le rendu.
 */
export async function docsBody({
  locale,
  section,
  slug,
}: {
  readonly locale: string
  readonly section: string
  readonly slug: string
}): Promise<ReactNode> {
  const loaded = (await import(`../../../content/docs/${locale}/${section}/${slug}.mdx`)) as {
    readonly default: ComponentType<{ readonly components?: typeof docsProseComponents }>
  }
  const Content = loaded.default

  return <Content components={docsProseComponents} />
}
