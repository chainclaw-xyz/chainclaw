import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createChainAdapter } from "@chainclaw/chains";
import { snapshot, revert, ANVIL_ACCOUNT_0, ANVIL_ACCOUNT_1 } from "../../src/anvil.js";

const skip = !!process.env.E2E_SKIP;
const rpcUrl = () => process.env.ANVIL_RPC_URL!;

describe.skipIf(skip)("balance reads against forked mainnet", () => {
  let snapshotId: string;

  beforeAll(async () => {
    snapshotId = await snapshot(rpcUrl());
  });

  afterAll(async () => {
    try { await revert(rpcUrl(), snapshotId); } catch { /* best-effort */ }
  });

  it("reads native ETH balance for Anvil account #0", async () => {
    const adapter = createChainAdapter(1, rpcUrl());
    const balance = await adapter.getBalance(ANVIL_ACCOUNT_0.address);

    expect(balance.symbol).toBe("ETH");
    expect(balance.chainId).toBe(1);
    expect(BigInt(balance.balance)).toBeGreaterThan(0n);
    expect(Number(balance.formatted)).toBeGreaterThan(0);
  });

  it("reads native ETH balance for a second Anvil account", async () => {
    const adapter = createChainAdapter(1, rpcUrl());
    const balance = await adapter.getBalance(ANVIL_ACCOUNT_1.address);

    expect(balance.symbol).toBe("ETH");
    expect(Number(balance.formatted)).toBeGreaterThan(0);
  });

  it("reads block number from forked chain", async () => {
    const adapter = createChainAdapter(1, rpcUrl());
    const blockNumber = await adapter.getBlockNumber();

    expect(blockNumber).toBeGreaterThan(18_000_000n);
  });

  it("reads gas price from forked chain", async () => {
    const adapter = createChainAdapter(1, rpcUrl());
    const gasPrice = await adapter.getGasPrice();

    expect(gasPrice).toBeGreaterThan(0n);
  });

  it("reads ERC20 token balances from forked state", async () => {
    const usdcWhale = "0x55FE002aefF02F77364de339a1292923A15844B8";
    const adapter = createChainAdapter(1, rpcUrl());
    const tokens = await adapter.getTokenBalances(usdcWhale);

    expect(tokens.length).toBeGreaterThan(0);
    for (const token of tokens) {
      expect(token.chainId).toBe(1);
      expect(BigInt(token.balance)).toBeGreaterThan(0n);
    }
  });
});
