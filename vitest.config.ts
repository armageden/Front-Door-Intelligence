import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Three trees, because they are three runtimes. `test/` holds the Lambda-side suites
    // and is compiled by the root Node tsconfig; `web/test/` and `firetv/test/` hold the
    // two browser surfaces and are compiled by their own tsconfigs with a DOM lib. A
    // suite importing across a boundary fails to resolve, which is the correct outcome.
    include: ['test/**/*.test.ts', 'web/test/**/*.test.ts', 'firetv/test/**/*.test.ts'],
    // Coverage is scoped to src/ only. Test files are measured by whether they pass,
    // not by how much of themselves they execute.
    coverage: {
      provider: 'v8',
      // Both browser surfaces are included. Their DOM shells and entry points read low
      // for the same reason the Lambda handler adapters do — they need a browser, not a
      // faked boundary.
      include: ['src/**/*.ts', 'web/src/**/*.ts', 'firetv/src/**/*.ts'],
      // src/types/ is types only — it emits no executable code, so including it
      // reports a misleading 0% that looks like a gap and is not one.
      exclude: ['src/types/**'],
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: 'coverage',
    },
  },
});
