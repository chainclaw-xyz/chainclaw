import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    unstubEnvs: true,
    unstubGlobals: true,
    setupFiles: ["../../test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      thresholds: {
        lines: 40,
        functions: 40,
        branches: 40,
        statements: 40,
      },
    },
  },
});
