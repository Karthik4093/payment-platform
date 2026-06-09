import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
    sequence: {
      concurrent: false,
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'tests/**',
        'prisma/**',
        '**/*.d.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@common': new URL('./src/common', import.meta.url).pathname,
      '@modules': new URL('./src/modules', import.meta.url).pathname,
      '@workers': new URL('./src/workers', import.meta.url).pathname,
    },
  },
});
