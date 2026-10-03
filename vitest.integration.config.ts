import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ['app/db/__tests__/integration/**/*.test.ts'],
    globalSetup: ['app/db/__tests__/integration/global-setup.ts'],
    setupFiles: ['app/db/__tests__/integration/test-database-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: true,
    maxWorkers: 4,
  },
})
