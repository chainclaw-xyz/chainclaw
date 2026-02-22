/**
 * Shared test setup for all packages.
 * - Isolates HOME directory to prevent tests from touching real config/wallets
 * - Resets environment variables between tests
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach } from "vitest";

// Create a temp HOME for each test file to prevent touching real config
const testHome = mkdtempSync(join(tmpdir(), "chainclaw-test-"));
const originalHome = process.env.HOME;

beforeEach(() => {
  process.env.HOME = testHome;
});

afterEach(() => {
  process.env.HOME = originalHome;
});
