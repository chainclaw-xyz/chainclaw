import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    globalSetup: ["./src/setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    include: ["tests/**/*.e2e.test.ts"],
  },
});
