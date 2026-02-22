import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  generatePrivateKey,
  privateKeyToAccount,
  type PrivateKeyAccount,
} from "viem/accounts";
import {
  english,
  generateMnemonic,
  mnemonicToAccount,
} from "viem/accounts";
import { getLogger, type WalletInfo, type WalletStore, type StoredWallet } from "@chainclaw/core";
import { encrypt, decrypt } from "./crypto.js";
import type { Signer } from "./signer.js";
import { LocalSigner } from "./signers/local.js";

const logger = getLogger("wallet");
const STORE_FILE = "wallets.json";

export class WalletManager {
  private storePath: string;
  private store: WalletStore;
  private password: string;

  constructor(walletDir: string, password: string) {
    this.password = password;
    this.storePath = join(walletDir, STORE_FILE);

    // Ensure wallet directory exists
    mkdirSync(walletDir, { recursive: true });

    // Load existing store or create new one
    this.store = this.loadStore();
    logger.info(
      { walletCount: this.store.wallets.length },
      "Wallet manager initialized",
    );
  }

  private loadStore(): WalletStore {
    if (!existsSync(this.storePath)) {
      return { wallets: [], defaultAddress: null };
    }
    try {
      const raw = readFileSync(this.storePath, "utf-8");
      return JSON.parse(raw) as WalletStore;
    } catch {
      logger.warn("Failed to load wallet store, starting fresh");
      return { wallets: [], defaultAddress: null };
    }
  }

  private saveStore(): void {
    writeFileSync(this.storePath, JSON.stringify(this.store, null, 2), "utf-8");
  }

  generateWallet(label: string): WalletInfo {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);

    return this.storeWallet(privateKey, account.address, label);
  }

  generateWalletFromMnemonic(label: string): { wallet: WalletInfo; mnemonic: string } {
    const mnemonic = generateMnemonic(english);
    const account = mnemonicToAccount(mnemonic);
    const privateKey = `0x${Buffer.from(account.getHdKey().privateKey!).toString("hex")}`;

    const wallet = this.storeWallet(privateKey, account.address, label);
    return { wallet, mnemonic };
  }

  importFromPrivateKey(privateKey: `0x${string}`, label: string): WalletInfo {
    const account = privateKeyToAccount(privateKey);

    // Check if already exists
    const existing = this.store.wallets.find(
      (w) => w.address.toLowerCase() === account.address.toLowerCase(),
    );
    if (existing) {
      throw new Error(`Wallet ${account.address} already exists`);
    }

    return this.storeWallet(privateKey, account.address, label);
  }

  private storeWallet(
    privateKey: string,
    address: string,
    label: string,
  ): WalletInfo {
    const encrypted = encrypt(privateKey, this.password);

    const storedWallet: StoredWallet = {
      address,
      label,
      encryptedKey: `${encrypted.ciphertext}:${encrypted.authTag}`,
      iv: encrypted.iv,
      salt: encrypted.salt,
      createdAt: new Date().toISOString(),
    };

    this.store.wallets.push(storedWallet);

    // Set as default if it's the first wallet
    if (!this.store.defaultAddress) {
      this.store.defaultAddress = address;
    }

    this.saveStore();
    logger.info({ address, label }, "Wallet stored");

    return {
      address,
      label,
      isDefault: this.store.defaultAddress === address,
      createdAt: storedWallet.createdAt,
    };
  }

  getAccount(address: string): PrivateKeyAccount {
    const stored = this.store.wallets.find(
      (w) => w.address.toLowerCase() === address.toLowerCase(),
    );
    if (!stored) {
      throw new Error(`Wallet not found: ${address}`);
    }

    const [ciphertext, authTag] = stored.encryptedKey.split(":");
    const privateKey = decrypt(
      { ciphertext, authTag, iv: stored.iv, salt: stored.salt },
      this.password,
    );

    return privateKeyToAccount(privateKey as `0x${string}`);
  }

  listWallets(): WalletInfo[] {
    return this.store.wallets.map((w) => ({
      address: w.address,
      label: w.label,
      isDefault: this.store.defaultAddress === w.address,
      createdAt: w.createdAt,
    }));
  }

  getDefaultAddress(): string | null {
    return this.store.defaultAddress;
  }

  setDefault(address: string): void {
    const exists = this.store.wallets.some(
      (w) => w.address.toLowerCase() === address.toLowerCase(),
    );
    if (!exists) {
      throw new Error(`Wallet not found: ${address}`);
    }
    this.store.defaultAddress = address;
    this.saveStore();
  }

  getSigner(address: string, rpcOverrides?: Record<number, string>): Signer {
    const account = this.getAccount(address);
    return new LocalSigner(account, rpcOverrides);
  }

  hasWallets(): boolean {
    return this.store.wallets.length > 0;
  }
}
