import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConfigurationManager } from "../config-manager.js";
import type { Config } from "../config.js";
import { triggerHook, createHookEvent } from "../hooks.js";

vi.mock("../logger.js", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("../hooks.js", () => ({
  triggerHook: vi.fn(),
  createHookEvent: vi.fn((_type: string, _action: string, data: unknown) => ({ type: _type, action: _action, data })),
}));

function makeConfig(overrides?: Partial<Config>): Config {
  return {
    walletPassword: "testpassword",
    walletDir: "./data/wallets",
    webChatEnabled: false,
    webChatPort: 8080,
    whatsappEnabled: false,
    whatsappAuthDir: "./data/whatsapp-auth",
    ethRpcUrl: "https://eth.llamarpc.com",
    baseRpcUrl: "https://mainnet.base.org",
    arbitrumRpcUrl: "https://arb1.arbitrum.io/rpc",
    optimismRpcUrl: "https://mainnet.optimism.io",
    polygonRpcUrl: "https://polygon-rpc.com",
    bscRpcUrl: "https://bsc-dataseed1.bnbchain.org",
    avalancheRpcUrl: "https://api.avax.network/ext/bc/C/rpc",
    zkSyncRpcUrl: "https://mainnet.era.zksync.io",
    scrollRpcUrl: "https://rpc.scroll.io",
    blastRpcUrl: "https://rpc.blast.io",
    gnosisRpcUrl: "https://rpc.gnosischain.com",
    lineaRpcUrl: "https://rpc.linea.build",
    fantomRpcUrl: "https://rpc.ftm.tools",
    mantleRpcUrl: "https://rpc.mantle.xyz",
    llmProvider: "anthropic",
    logLevel: "info",
    dataDir: "./data",
    healthCheckPort: 9090,
    securityMode: "open",
    securityAllowlist: [],
    dataPipelineEnabled: false,
    outcomeLabelIntervalMs: 300_000,
    reasoningEnrichmentEnabled: false,
    dbMaxSizeMb: 500,
    dbPruneEnabled: true,
    ...overrides,
  };
}

describe("ConfigurationManager", () => {
  let cm: ConfigurationManager;

  beforeEach(() => {
    vi.clearAllMocks();
    cm = new ConfigurationManager(makeConfig());
  });

  describe("startup immutability", () => {
    it("startup config is frozen and matches initial values", () => {
      expect(cm.startup.logLevel).toBe("info");
      expect(() => { (cm.startup as any).logLevel = "debug"; }).toThrow();
    });

    it("current config is a separate copy from startup", () => {
      expect(cm.current.logLevel).toBe(cm.startup.logLevel);
    });
  });

  describe("edit + apply (hot fields)", () => {
    it("stages a change without applying it", () => {
      cm.edit("logLevel", "debug");
      expect(cm.current.logLevel).toBe("info"); // Not yet applied
      expect(cm.hasPendingChanges()).toBe(true);
      expect(cm.pendingChanges.logLevel).toBe("debug");
    });

    it("applies a hot field immediately", () => {
      cm.edit("logLevel", "debug");
      const result = cm.apply();
      expect(result.applied).toContain("logLevel");
      expect(result.needsRestart).toHaveLength(0);
      expect(cm.current.logLevel).toBe("debug");
    });

    it("applies multiple hot fields", () => {
      cm.edit("logLevel", "debug");
      cm.edit("securityMode", "allowlist");
      const result = cm.apply();
      expect(result.applied).toContain("logLevel");
      expect(result.applied).toContain("securityMode");
      expect(cm.current.logLevel).toBe("debug");
      expect(cm.current.securityMode).toBe("allowlist");
    });

    it("clears pending changes after apply", () => {
      cm.edit("logLevel", "debug");
      cm.apply();
      expect(cm.hasPendingChanges()).toBe(false);
    });
  });

  describe("edit + apply (cold fields)", () => {
    it("reports cold fields as needing restart", () => {
      cm.edit("walletPassword", "newpassword123");
      const result = cm.apply();
      expect(result.needsRestart).toContain("walletPassword");
      expect(result.applied).toHaveLength(0);
      // Cold field should NOT be updated in current
      expect(cm.current.walletPassword).toBe("testpassword");
    });

    it("handles mixed hot and cold fields", () => {
      cm.edit("logLevel", "debug");
      cm.edit("walletPassword", "newpassword123");
      const result = cm.apply();
      expect(result.applied).toContain("logLevel");
      expect(result.needsRestart).toContain("walletPassword");
      expect(cm.current.logLevel).toBe("debug");
      expect(cm.current.walletPassword).toBe("testpassword");
    });
  });

  describe("validation", () => {
    it("throws on invalid config values", () => {
      cm.edit("logLevel", "invalid_level" as any);
      expect(() => cm.apply()).toThrow("Invalid config");
    });

    it("throws on unknown config key", () => {
      expect(() => cm.edit("nonExistentKey" as any, "value")).toThrow("Unknown config key");
    });
  });

  describe("discard", () => {
    it("removes all pending changes", () => {
      cm.edit("logLevel", "debug");
      cm.edit("securityMode", "allowlist");
      cm.discard();
      expect(cm.hasPendingChanges()).toBe(false);
      expect(cm.current.logLevel).toBe("info");
    });
  });

  describe("diff", () => {
    it("returns empty when nothing changed", () => {
      expect(cm.diff()).toHaveLength(0);
    });

    it("shows differences after applying hot fields", () => {
      cm.edit("logLevel", "debug");
      cm.apply();
      const diffs = cm.diff();
      expect(diffs).toHaveLength(1);
      expect(diffs[0]).toEqual({ key: "logLevel", from: "info", to: "debug" });
    });
  });

  describe("lifecycle hook", () => {
    it("triggers config_changed hook on apply", () => {
      cm.edit("logLevel", "debug");
      cm.apply();
      expect(vi.mocked(createHookEvent)).toHaveBeenCalledWith(
        "lifecycle",
        "config_changed",
        expect.objectContaining({ applied: ["logLevel"] }),
      );
    });

    it("does not trigger hook when no changes", () => {
      cm.apply();
      expect(vi.mocked(triggerHook)).not.toHaveBeenCalled();
    });
  });

  describe("getRedactedView", () => {
    it("redacts secret fields", () => {
      const cm2 = new ConfigurationManager(makeConfig({ anthropicApiKey: "sk-secret-123" }));
      const view = cm2.getRedactedView();
      expect(view.anthropicApiKey).toBe("***");
      expect(view.walletPassword).toBe("***");
      expect(view.logLevel).toBe("info");
    });

    it("does not redact undefined secrets", () => {
      const view = cm.getRedactedView();
      expect(view.anthropicApiKey).toBeUndefined();
    });
  });

  describe("no-op apply", () => {
    it("returns empty arrays when no changes pending", () => {
      const result = cm.apply();
      expect(result.applied).toHaveLength(0);
      expect(result.needsRestart).toHaveLength(0);
    });

    it("skips values that haven't actually changed", () => {
      cm.edit("logLevel", "info"); // Same as current
      const result = cm.apply();
      expect(result.applied).toHaveLength(0);
      expect(result.needsRestart).toHaveLength(0);
    });
  });
});
