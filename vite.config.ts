import { execSync } from 'node:child_process';
import { reactRouter } from '@react-router/dev/vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

function getBuildVersion(): string {
  const now = new Date();
  const time = now
    .toLocaleString('sv-SE', { timeZone: 'Europe/Oslo', hour12: false })
    .replace(/[-: ]/g, (m) => (m === ' ' ? '-' : m === ':' ? '.' : '.'))
    .replace(',', '')
    .slice(0, 16);

  let sha: string;
  if (process.env.GITHUB_SHA) {
    sha = process.env.GITHUB_SHA.substring(0, 12);
  } else {
    try {
      sha = execSync('git rev-parse --short=12 HEAD', { encoding: 'utf-8' }).trim();
    } catch {
      sha = 'unknown';
    }
  }

  return `${time}-${sha}`;
}

export default defineConfig({
  plugins: [reactRouter(), tsconfigPaths()],
  define: {
    __BUILD_VERSION__: JSON.stringify(getBuildVersion()),
  },
  test: {
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
