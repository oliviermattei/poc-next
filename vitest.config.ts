import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const resolveFromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
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
