import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Vitest rather than Jest: NestJS 12 ships ESM only (`"type": "module"`, no CommonJS
 * build). The application itself is fine because Node 22 supports `require(esm)`, but
 * Jest's module runtime does not — it needs Node 24.9+. Vitest loads ESM natively, so
 * the test runner stops being coupled to the Node version.
 *
 * unplugin-swc is required for `emitDecoratorMetadata`: esbuild, which Vitest uses by
 * default, cannot emit it, and NestJS dependency injection depends on it.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
    // Disables HTTP connection pooling — see the file for why it matters here.
    setupFiles: ['test/setup.ts'],
    // e2e specs boot the whole application and talk to Postgres.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Sequential: the specs share one database and one Better Auth instance.
    fileParallelism: false,
  },
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2023',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
});
