import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    unstubEnvs: true,
    unstubGlobals: true,
    setupFiles: ["../../test/setup.ts"],
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      thresholds: {
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
      },
    },
  },
});
