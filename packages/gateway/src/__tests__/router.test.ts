import { describe, it, expect, vi, beforeEach } from "vitest";
import { CommandRouter } from "../router.js";
import type { ChannelContext, GatewayDeps } from "../types.js";

vi.mock("@chainclaw/core", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

function createMockDeps(overrides?: Partial<GatewayDeps>): GatewayDeps {
  return {
    walletManager: {
      listWallets: vi.fn(() => []),
      getDefaultAddress: vi.fn(() => null),
      generateWalletFromMnemonic: vi.fn((label: string) => ({
        wallet: { address: "0xABCdef1234567890abcdef1234567890ABCDEF12", label, isDefault: true, createdAt: "2026-01-01" },
        mnemonic: "word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12",
      })),
      importFromPrivateKey: vi.fn((_key: string, label: string) => ({
        address: "0xABCdef1234567890abcdef1234567890ABCDEF12",
        label,
        isDefault: false,
        createdAt: "2026-01-01",
      })),
      setDefault: vi.fn(),
    } as any,
    chainManager: {
      getSupportedChains: vi.fn(() => [1, 8453]),
    } as any,
    skillRegistry: {
      list: vi.fn(() => []),
      get: vi.fn(() => undefined),
    } as any,
    ...overrides,
  };
}

function createMockCtx(): ChannelContext {
  return {
    userId: "user-123",
    channelId: "chat-456",
    platform: "telegram",
    sendReply: vi.fn(async () => {}),
    requestConfirmation: vi.fn(async () => true),
  };
}

describe("CommandRouter", () => {
  let deps: GatewayDeps;
  let router: CommandRouter;
  let ctx: ChannelContext;

  beforeEach(() => {
    deps = createMockDeps();
    router = new CommandRouter(deps);
    ctx = createMockCtx();
  });

  // ─── handleStart ───────────────────────────────────────

  describe("handleStart", () => {
    it("shows onboarding wizard when no wallet and no LLM", async () => {
      await router.handleStart(ctx);
      const reply = (ctx.sendReply as any).mock.calls[0][0] as string;
      expect(reply).toContain("Setup Guide");
      expect(reply).toContain("Create a wallet");
      expect(reply).toContain("Configure AI");
    });

    it("shows wallet configured when wallet exists but no LLM", async () => {
      (deps.walletManager.listWallets as any).mockReturnValue([{ address: "0x1" }]);
      await router.handleStart(ctx);
      const reply = (ctx.sendReply as any).mock.calls[0][0] as string;
      expect(reply).toContain("Setup Guide");
      expect(reply).toContain("Wallet configured");
      expect(reply).toContain("Configure AI");
    });

    it("shows LLM configured when LLM exists but no wallet", async () => {
      deps.agentRuntime = { handleMessage: vi.fn(), clearHistory: vi.fn() } as any;
      router = new CommandRouter(deps);
      await router.handleStart(ctx);
      const reply = (ctx.sendReply as any).mock.calls[0][0] as string;
      expect(reply).toContain("Setup Guide");
      expect(reply).toContain("Create a wallet");
      expect(reply).toContain("AI configured");
    });

    it("shows full welcome when both wallet and LLM are configured", async () => {
      (deps.walletManager.listWallets as any).mockReturnValue([{ address: "0x1" }]);
      deps.agentRuntime = { handleMessage: vi.fn(), clearHistory: vi.fn() } as any;
      (deps.skillRegistry.list as any).mockReturnValue([{ name: "balance" }, { name: "swap" }]);
      router = new CommandRouter(deps);
      await router.handleStart(ctx);
      const reply = (ctx.sendReply as any).mock.calls[0][0] as string;
      expect(reply).toContain("Welcome to ChainClaw");
      expect(reply).toContain("2 skills loaded");
      expect(reply).not.toContain("Setup Guide");
    });
  });

  // ─── handleHelp ────────────────────────────────────────

  describe("handleHelp", () => {
    it("shows 'No skills registered' when list is empty", async () => {
      await router.handleHelp(ctx);
      const reply = (ctx.sendReply as any).mock.calls[0][0] as string;
      expect(reply).toContain("No skills registered");
    });

    it("lists all registered skills", async () => {
      (deps.skillRegistry.list as any).mockReturnValue([
        { name: "balance", description: "Check balances" },
        { name: "swap", description: "Swap tokens" },
      ]);
      await router.handleHelp(ctx);
      const reply = (ctx.sendReply as any).mock.calls[0][0] as string;
      expect(reply).toContain("*balance* - Check balances");
      expect(reply).toContain("*swap* - Swap tokens");
    });
  });

  // ─── handleWallet ──────────────────────────────────────

  describe("handleWallet", () => {
    it("creates a wallet and replies with address and mnemonic", async () => {
      await router.handleWallet(ctx, ["create", "my-wallet"]);
      expect(deps.walletManager.generateWalletFromMnemonic).toHaveBeenCalledWith("my-wallet");
      const reply = (ctx.sendReply as any).mock.calls[0][0] as string;
      expect(reply).toContain("Wallet Created");
      expect(reply).toContain("0xABCdef");
      expect(reply).toContain("word1 word2");
    });

    it("imports wallet with valid private key", async () => {
      const hook = { onImportMessage: vi.fn(async () => {}) };
      await router.handleWallet(ctx, ["import", "0xdeadbeef1234", "imported"], hook);
      expect(hook.onImportMessage).toHaveBeenCalled();
      expect(deps.walletManager.importFromPrivateKey).toHaveBeenCalled();
      const reply = (ctx.sendReply as any).mock.calls[0][0] as string;
      expect(reply).toContain("Wallet Imported");
    });

    it("rejects import without 0x prefix", async () => {
      await router.handleWallet(ctx, ["import", "deadbeef1234"]);
      const reply = (ctx.sendReply as any).mock.calls[0][0] as string;
      expect(reply).toContain("Usage:");
      expect(deps.walletManager.importFromPrivateKey).not.toHaveBeenCalled();
    });

    it("catches import errors (e.g. duplicate wallet)", async () => {
      (deps.walletManager.importFromPrivateKey as any).mockImplementation(() => {
        throw new Error("Wallet already exists");
      });
      await router.handleWallet(ctx, ["import", "0xdeadbeef"]);
      const reply = (ctx.sendReply as any).mock.calls[0][0] as string;
      expect(reply).toContain("Error: Wallet already exists");
    });

    it("calls onImportMessage hook before importFromPrivateKey", async () => {
      const callOrder: string[] = [];
      const hook = {
        onImportMessage: vi.fn(async () => { callOrder.push("hook"); }),
      };
      (deps.walletManager.importFromPrivateKey as any).mockImplementation(() => {
        callOrder.push("import");
        return { address: "0x1", label: "w", isDefault: false, createdAt: "" };
      });
      await router.handleWallet(ctx, ["import", "0xabc", "w"], hook);
      expect(callOrder).toEqual(["hook", "import"]);
    });

    it("lists wallets with default marker", async () => {
      (deps.walletManager.listWallets as any).mockReturnValue([
        { address: "0xAAA", label: "main", isDefault: true },
        { address: "0xBBB", label: "alt", isDefault: false },
      ]);
      await router.handleWallet(ctx, ["list"]);
      const reply = (ctx.sendReply as any).mock.calls[0][0] as string;
      expect(reply).toContain("-> ");
      expect(reply).toContain("0xAAA");
      expect(reply).toContain("0xBBB");
    });

    it("shows 'no wallets' when list is empty", async () => {
      await router.handleWallet(ctx, ["list"]);
      const reply = (ctx.sendReply as any).mock.calls[0][0] as string;
      expect(reply).toContain("No wallets configured");
    });

    it("sets default wallet", async () => {
      await router.handleWallet(ctx, ["default", "0xABC"]);
      expect(deps.walletManager.setDefault).toHaveBeenCalledWith("0xABC");
      const reply = (ctx.sendReply as any).mock.calls[0][0] as string;
      expect(reply).toContain("Default wallet set to");
    });

    it("requires address for default subcommand", async () => {
      await router.handleWallet(ctx, ["default"]);
      const reply = (ctx.sendReply as any).mock.calls[0][0] as string;
      expect(reply).toContain("Usage:");
    });

    it("shows usage help with no subcommand", async () => {
      await router.handleWallet(ctx, []);
      const reply = (ctx.sendReply as any).mock.calls[0][0] as string;
      expect(reply).toContain("Wallet Commands");
    });
  });

  // ─── handleBalance ─────────────────────────────────────

  describe("handleBalance", () => {
    it("replies with no wallet message when no default wallet", async () => {
      await router.handleBalance(ctx);
      const reply = (ctx.sendReply as any).mock.calls[0][0] as string;
      expect(reply).toContain("No wallet configured");
    });

    it("replies when balance skill is not available", async () => {
      (deps.walletManager.getDefaultAddress as any).mockReturnValue("0xABC");
      await router.handleBalance(ctx);
      const reply = (ctx.sendReply as any).mock.calls[0][0] as string;
      expect(reply).toContain("Balance skill not available");
    });

    it("executes balance skill and returns result", async () => {
      (deps.walletManager.getDefaultAddress as any).mockReturnValue("0xABC");
      const mockSkill = { execute: vi.fn(async () => ({ success: true, message: "ETH: 2.5" })) };
      (deps.skillRegistry.get as any).mockReturnValue(mockSkill);
      await router.handleBalance(ctx);
      expect(mockSkill.execute).toHaveBeenCalled();
      const reply = (ctx.sendReply as any).mock.calls[0][0] as string;
      expect(reply).toContain("ETH: 2.5");
    });

    it("handles balance skill execution error", async () => {
      (deps.walletManager.getDefaultAddress as any).mockReturnValue("0xABC");
      const mockSkill = { execute: vi.fn(async () => { throw new Error("RPC error"); }) };
      (deps.skillRegistry.get as any).mockReturnValue(mockSkill);
      await router.handleBalance(ctx);
      const reply = (ctx.sendReply as any).mock.calls[0][0] as string;
      expect(reply).toContain("Failed to fetch balances");
    });
  });

  // ─── handleClear ───────────────────────────────────────

  describe("handleClear", () => {
    it("replies 'not available' when no agentRuntime", async () => {
      await router.handleClear(ctx);
      const reply = (ctx.sendReply as any).mock.calls[0][0] as string;
      expect(reply).toContain("Memory system not available");
    });

    it("clears history and confirms", async () => {
      deps.agentRuntime = { handleMessage: vi.fn(), clearHistory: vi.fn() } as any;
      router = new CommandRouter(deps);
      await router.handleClear(ctx);
      expect(deps.agentRuntime!.clearHistory).toHaveBeenCalledWith("user-123");
      const reply = (ctx.sendReply as any).mock.calls[0][0] as string;
      expect(reply).toContain("Conversation history cleared");
    });
  });

  // ─── handleMessage ─────────────────────────────────────

  describe("handleMessage", () => {
    it("replies with 'not configured' when no agentRuntime", async () => {
      await router.handleMessage(ctx, "What is my balance?");
      const reply = (ctx.sendReply as any).mock.calls[0][0] as string;
      expect(reply).toContain("Natural language processing is not configured");
    });

    it("forwards message to agentRuntime and replies", async () => {
      deps.agentRuntime = {
        handleMessage: vi.fn(async () => ({ text: "Your ETH balance is 2.5" })),
        clearHistory: vi.fn(),
      } as any;
      (deps.walletManager.getDefaultAddress as any).mockReturnValue("0xABC");
      router = new CommandRouter(deps);
      await router.handleMessage(ctx, "What is my balance?");
      expect(deps.agentRuntime!.handleMessage).toHaveBeenCalledWith(
        "user-123",
        "What is my balance?",
        expect.objectContaining({ walletAddress: "0xABC" }),
      );
      const reply = (ctx.sendReply as any).mock.calls[0][0] as string;
      expect(reply).toContain("Your ETH balance is 2.5");
    });

    it("handles agentRuntime errors gracefully", async () => {
      deps.agentRuntime = {
        handleMessage: vi.fn(async () => { throw new Error("LLM timeout"); }),
        clearHistory: vi.fn(),
      } as any;
      router = new CommandRouter(deps);
      await router.handleMessage(ctx, "test");
      const reply = (ctx.sendReply as any).mock.calls[0][0] as string;
      expect(reply).toContain("Something went wrong");
    });
  });
});
