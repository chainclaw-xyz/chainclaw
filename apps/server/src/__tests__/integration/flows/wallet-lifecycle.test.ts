import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createMockAdapterControls } from "../mocks/mock-chain-adapter.js";

const adapterControls = createMockAdapterControls();

vi.mock("@chainclaw/core", async (importOriginal) => {
  const original = await importOriginal<typeof import("@chainclaw/core")>();
  return {
    ...original,
    getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    createLogger: vi.fn(),
  };
});

vi.mock("@chainclaw/chains", async (importOriginal) => {
  const original = await importOriginal<typeof import("@chainclaw/chains")>();
  return {
    ...original,
    createChainAdapter: vi.fn((chainId: number) => adapterControls.getAdapter(chainId)),
    createSolanaAdapter: vi.fn(() => adapterControls.getAdapter(900)),
  };
});

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: vi.fn().mockReturnValue({
      getBalance: vi.fn().mockResolvedValue(BigInt(0)),
      readContract: vi.fn().mockResolvedValue(BigInt(0)),
      getGasPrice: vi.fn().mockResolvedValue(BigInt("30000000000")),
      getBlockNumber: vi.fn().mockResolvedValue(BigInt("19000000")),
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "success", blockNumber: BigInt(19000000), gasUsed: BigInt(21000), effectiveGasPrice: BigInt("30000000000") }),
    }),
    encodeFunctionData: vi.fn().mockReturnValue("0xmocked_calldata"),
  };
});

import { createTestHarness, type TestHarness } from "../harness.js";
import { createTestCtx } from "../context-factory.js";

describe("Wallet lifecycle through CommandRouter", () => {
  let harness: TestHarness;

  beforeAll(() => {
    harness = createTestHarness({ adapterControls });
  });

  afterAll(() => {
    harness.cleanup();
  });

  it("creates a wallet via /wallet create and shows mnemonic", async () => {
    const ctx = createTestCtx();
    await harness.router.handleWallet(ctx, ["create", "test-wallet"]);

    expect(ctx.replies).toHaveLength(1);
    expect(ctx.replies[0]).toContain("Wallet Created");
    expect(ctx.replies[0]).toMatch(/0x[a-fA-F0-9]{40}/);
    // 12-word mnemonic
    const words = ctx.replies[0].match(/`([a-z ]+)`/);
    expect(words).toBeTruthy();
    expect(harness.walletManager.listWallets()).toHaveLength(1);
  });

  it("first wallet becomes default", () => {
    expect(harness.walletManager.getDefaultAddress()).not.toBeNull();
  });

  it("imports a wallet via /wallet import with real key", async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const ctx = createTestCtx();

    await harness.router.handleWallet(ctx, ["import", privateKey, "imported"]);

    expect(ctx.replies).toHaveLength(1);
    expect(ctx.replies[0]).toContain("Wallet Imported");
    expect(harness.walletManager.listWallets()).toHaveLength(2);

    // Encryption roundtrip works
    const retrieved = harness.walletManager.getAccount(account.address);
    expect(retrieved.address.toLowerCase()).toBe(account.address.toLowerCase());
  });

  it("lists wallets with default indicator", async () => {
    const ctx = createTestCtx();
    await harness.router.handleWallet(ctx, ["list"]);

    expect(ctx.replies).toHaveLength(1);
    expect(ctx.replies[0]).toContain("Your Wallets");
    expect(ctx.replies[0]).toContain("-> ");
  });

  it("changes default wallet", async () => {
    const wallets = harness.walletManager.listWallets();
    const nonDefault = wallets.find((w) => !w.isDefault)!;
    const ctx = createTestCtx();

    await harness.router.handleWallet(ctx, ["default", nonDefault.address]);

    expect(ctx.replies[0]).toContain("Default wallet set to");
    expect(harness.walletManager.getDefaultAddress()?.toLowerCase()).toBe(
      nonDefault.address.toLowerCase(),
    );
  });

  it("shows usage for unknown subcommand", async () => {
    const ctx = createTestCtx();
    await harness.router.handleWallet(ctx, []);

    expect(ctx.replies[0]).toContain("Wallet Commands");
  });
});
