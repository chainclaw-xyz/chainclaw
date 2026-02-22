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
        lines: 30,
        functions: 30,
        branches: 30,
        statements: 30,
      },
    },
  },
});
