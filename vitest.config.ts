import { fileURLToPath } from 'node:url'

import mdx from '@mdx-js/rollup'
import remarkFrontmatter from 'remark-frontmatter'
import { defineConfig } from 'vitest/config'

const resolveFromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  /**
   * Le compilateur MDX de la suite (s29).
   *
   * `tests/rendered-text.test.ts` rend **tous** les écrans de l'application, la
   * page d'article comprise, et celle-ci importe un `.mdx`. Sans ce greffon,
   * Vitest lit le fichier comme du JavaScript et le rendu échoue avant tout
   * assert. C'est le même compilateur que celui du bundler de Next
   * (`@mdx-js/*`, ADR 053) et le même greffon de frontmatter : deux pipelines
   * différents divergeraient sur le premier article un peu riche.
   */
  plugins: [mdx({ remarkPlugins: [remarkFrontmatter] })],
  // `apps/web` compile en `jsx: "preserve"` — c'est Next qui transforme le JSX
  // dans l'application. Vitest, lui, exécute les écrans directement : sans
  // cette ligne il lit le `tsconfig.json` le plus proche du fichier, y trouve
  // `preserve`, et refuse un `.tsx` comme du JavaScript invalide. La
  // transformation est donc imposée ici, pour tous les fichiers de la suite.
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    // Alias exacts, dans l'ordre : la forme préfixe ferait résoudre
    // `@repo/config/server` en `…/src/index.ts/server`.
    alias: [
      {
        find: /^@repo\/config\/server$/,
        replacement: resolveFromRoot('./packages/config/src/server.ts'),
      },
      { find: /^@repo\/config$/, replacement: resolveFromRoot('./packages/config/src/index.ts') },
      { find: /^@repo\/db$/, replacement: resolveFromRoot('./packages/db/src/index.ts') },
      // Les polices sont une transformation de **build**, pas un module
      // exécutable : hors de Next, `geist/font/*` charge `geist/dist/*.js`, qui
      // importe le répertoire `next/font/local` — que Node refuse. L'alias rend
      // ce que le greffon rendrait (voir `tests/fixtures/next-font.ts`), et il
      // est ici plutôt que dans un `vi.mock` parce que le mock est résolu après
      // le chargement du vrai module, donc trop tard.
      {
        find: /^geist\/font\/(sans|mono)$/,
        replacement: resolveFromRoot('./tests/fixtures/next-font.ts'),
      },
    ],
  },
  test: {
    environment: 'node',
    // Deux emplacements, et deux seulement :
    // - `tests/` à la racine pour ce qui traverse les packages (câblage,
    //   configuration, harnais) ;
    // - `src/**/*.test.ts` dans un package pour ce qui lui appartient — un
    //   module doit embarquer ses tests, sans quoi s03 devrait déplacer le
    //   harnais. Le motif traverse un niveau supplémentaire : les modules
    //   vivent en `packages/modules/<module>/src/`.
    include: ['tests/**/*.test.ts', 'packages/**/src/**/*.test.ts'],
    // Les parcours Playwright ont leur propre exécuteur : `pnpm test:e2e`.
    exclude: ['**/node_modules/**', 'e2e/**'],
    globalSetup: [],
  },
})
