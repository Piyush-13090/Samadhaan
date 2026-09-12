import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    // The e2e suite boots the real Nest application and connects to
    // PostgreSQL, Redis and the AI service, so it needs a longer budget than
    // the unit tests and must not run files in parallel against one database.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
