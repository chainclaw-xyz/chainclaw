import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WalletManager } from "../manager.js";

describe("WalletManager", () => {
  let tempDir: string;
  let manager: WalletManager;
  const password = "testpassword123";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "chainclaw-test-"));
    manager = new WalletManager(tempDir, password);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("starts with no wallets", () => {
    expect(manager.listWallets()).toHaveLength(0);
    expect(manager.hasWallets()).toBe(false);
    expect(manager.getDefaultAddress()).toBeNull();
  });

  it("generates a wallet", () => {
    const wallet = manager.generateWallet("test-wallet");

    expect(wallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(wallet.label).toBe("test-wallet");
    expect(wallet.isDefault).toBe(true);
    expect(manager.listWallets()).toHaveLength(1);
  });

  it("generates a wallet from mnemonic", () => {
    const { wallet, mnemonic } = manager.generateWalletFromMnemonic("mnemonic-wallet");

    expect(wallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(mnemonic.split(" ")).toHaveLength(12);
    expect(manager.hasWallets()).toBe(true);
  });

  it("imports a wallet from private key", () => {
    const privateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    const wallet = manager.importFromPrivateKey(privateKey as `0x${string}`, "imported");

    expect(wallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(wallet.label).toBe("imported");
  });

  it("throws when importing duplicate wallet", () => {
    const privateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    manager.importFromPrivateKey(privateKey as `0x${string}`, "first");

    expect(() =>
      manager.importFromPrivateKey(privateKey as `0x${string}`, "second"),
    ).toThrow("already exists");
  });

  it("retrieves the account for signing", () => {
    const privateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    const wallet = manager.importFromPrivateKey(privateKey as `0x${string}`, "test");

    const account = manager.getAccount(wallet.address);
    expect(account.address.toLowerCase()).toBe(wallet.address.toLowerCase());
  });

  it("sets first wallet as default automatically", () => {
    const wallet = manager.generateWallet("first");
    expect(manager.getDefaultAddress()).toBe(wallet.address);
  });

  it("changes default wallet", () => {
    const w1 = manager.generateWallet("first");
    const w2 = manager.generateWallet("second");

    expect(manager.getDefaultAddress()).toBe(w1.address);

    manager.setDefault(w2.address);
    expect(manager.getDefaultAddress()).toBe(w2.address);
  });

  it("persists wallets across instances", () => {
    manager.generateWallet("persistent");

    const manager2 = new WalletManager(tempDir, password);
    expect(manager2.listWallets()).toHaveLength(1);
    expect(manager2.listWallets()[0].label).toBe("persistent");
  });
});
