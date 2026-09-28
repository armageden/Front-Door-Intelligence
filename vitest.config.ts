import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Coverage is scoped to src/ only. Test files are measured by whether they pass,
    // not by how much of themselves they execute.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // src/types/ is types only — it emits no executable code, so including it
      // reports a misleading 0% that looks like a gap and is not one.
      exclude: ['src/types/**'],
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: 'coverage',
    },
  },
});
