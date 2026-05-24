import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

// Separate Vite config for Storybook (without react-router plugin)
export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  resolve: {
    alias: {
      // node:path is used in audit-report-pdf.tsx for production font paths.
      // In Storybook (browser env) fontBasePath is null, so join() is never called,
      // but the import itself must resolve.
      'node:path': path.resolve(__dirname, '../app/lib/__stubs__/node-path.ts'),
    },
  },
});
