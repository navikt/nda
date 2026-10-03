import { tmpdir } from 'node:os';
import { reactRouter } from '@react-router/dev/vite';
import { defineConfig } from 'vitest/config';
import { getBuildVersion } from './get-build-version.ts';

const isTest = process.env.VITEST === 'true';

export default defineConfig({
  plugins: [...(isTest ? [] : [reactRouter()])],
  envDir: isTest ? tmpdir() : undefined,
  resolve: {
    tsconfigPaths: true,
  },
  define: {
    __BUILD_VERSION__: JSON.stringify(getBuildVersion()),
  },
  test: {
    testTimeout: 15000,
    exclude: ['app/db/__tests__/integration/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      include: ['app/lib/**/*.ts'],
      exclude: ['app/lib/**/__tests__/**', 'app/lib/**/__fixtures__/**'],
      reporter: ['text', 'html'],
      reportsDirectory: './coverage',
    },
  },
});
