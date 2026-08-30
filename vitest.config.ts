import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const resolveFromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@repo/config': resolveFromRoot('./packages/config/src/index.ts'),
      '@repo/db': resolveFromRoot('./packages/db/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: [],
  },
})
