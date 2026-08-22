import { tmpdir } from 'node:os';
import { reactRouter } from '@react-router/dev/vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';
import { getBuildVersion } from './get-build-version';

const isTest = process.env.VITEST === 'true';

export default defineConfig({
  plugins: [...(isTest ? [] : [reactRouter()]), tsconfigPaths()],
  envDir: isTest ? tmpdir() : undefined,
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
