import { Step, Steps } from 'fumadocs-ui/components/steps'
import { Tab, Tabs } from 'fumadocs-ui/components/tabs'
import defaultMdxComponents from 'fumadocs-ui/mdx'
import type { MDXComponents } from 'mdx/types'

import { FeatureGrid } from './feature-grid'

/**
 * Les composants disponibles dans chaque page MDX : ceux de Fumadocs
 * (`Card`, `Cards`, `Callout`, les tableaux, le code), plus les étapes et les
 * onglets, plus la grille de l'accueil. Aucun composant maison quand un
 * composant intégré suffit.
 */
export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    Steps,
    Step,
    Tabs,
    Tab,
    FeatureGrid,
    ...components,
  } satisfies MDXComponents
}

export const useMDXComponents = getMDXComponents

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>
}
