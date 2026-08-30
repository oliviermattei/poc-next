import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const resolveFromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
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
    include: ['tests/**/*.test.ts'],
    globalSetup: [],
  },
})
