import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

// Separate Vite config for Storybook (without react-router plugin)
export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  resolve: {
    alias: {
      // node:path is used in audit-report-pdf.tsx for production font paths.
      // fontBasePath is only set server-side (typeof window === 'undefined'),
      // so join() is never called in the browser, but the import must resolve.
      'node:path': fileURLToPath(new URL('../app/lib/__stubs__/node-path.ts', import.meta.url)),
    },
  },
});
