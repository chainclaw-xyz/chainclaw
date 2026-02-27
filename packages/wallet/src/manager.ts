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
import { Keypair } from "@solana/web3.js";
import { getLogger, type WalletInfo, type WalletStore, type StoredWallet } from "@chainclaw/core";
import { encrypt, decrypt } from "./crypto.js";
import type { Signer } from "./signer.js";
import { LocalSigner } from "./signers/local.js";
import type { SolanaSigner } from "./solana-signer.js";
import { LocalSolanaSigner } from "./signers/solana.js";

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

  // ─── EVM Wallet Methods ───────────────────────────────────

  generateWallet(label: string): WalletInfo {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);

    return this.storeWallet(privateKey, account.address, label, "evm");
  }

  generateWalletFromMnemonic(label: string): { wallet: WalletInfo; mnemonic: string } {
    const mnemonic = generateMnemonic(english);
    const account = mnemonicToAccount(mnemonic);
    const privateKey = `0x${Buffer.from(account.getHdKey().privateKey!).toString("hex")}`;

    const wallet = this.storeWallet(privateKey, account.address, label, "evm");
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

    return this.storeWallet(privateKey, account.address, label, "evm");
  }

  getAccount(address: string): PrivateKeyAccount {
    const stored = this.findWallet(address);
    const [ciphertext, authTag] = stored.encryptedKey.split(":");
    const privateKey = decrypt(
      { ciphertext, authTag, iv: stored.iv, salt: stored.salt },
      this.password,
    );

    return privateKeyToAccount(privateKey as `0x${string}`);
  }

  getSigner(address: string, rpcOverrides?: Record<number, string>): Signer {
    const account = this.getAccount(address);
    return new LocalSigner(account, rpcOverrides);
  }

  /**
   * Returns the raw decrypted private key for the given address.
   * Required by privacy providers that derive zk-wallets from the key.
   */
  getPrivateKey(address: string): `0x${string}` {
    const stored = this.findWallet(address);
    const [ciphertext, authTag] = stored.encryptedKey.split(":");
    return decrypt(
      { ciphertext, authTag, iv: stored.iv, salt: stored.salt },
      this.password,
    ) as `0x${string}`;
  }

  // ─── Solana Wallet Methods ────────────────────────────────

  generateSolanaWallet(label: string): WalletInfo {
    const keypair = Keypair.generate();
    const secretKeyBase58 = Buffer.from(keypair.secretKey).toString("hex");
    const address = keypair.publicKey.toBase58();

    return this.storeWallet(secretKeyBase58, address, label, "solana");
  }

  importSolanaWallet(secretKey: Uint8Array, label: string): WalletInfo {
    const keypair = Keypair.fromSecretKey(secretKey);
    const address = keypair.publicKey.toBase58();

    // Check if already exists
    const existing = this.store.wallets.find((w) => w.address === address);
    if (existing) {
      throw new Error(`Solana wallet ${address} already exists`);
    }

    const secretKeyHex = Buffer.from(secretKey).toString("hex");
    return this.storeWallet(secretKeyHex, address, label, "solana");
  }

  getSolanaKeypair(address: string): Keypair {
    const stored = this.findWallet(address);
    const [ciphertext, authTag] = stored.encryptedKey.split(":");
    const secretKeyHex = decrypt(
      { ciphertext, authTag, iv: stored.iv, salt: stored.salt },
      this.password,
    );

    return Keypair.fromSecretKey(Buffer.from(secretKeyHex, "hex"));
  }

  getSolanaSigner(address: string, rpcUrl?: string): SolanaSigner {
    const keypair = this.getSolanaKeypair(address);
    return new LocalSolanaSigner(keypair, rpcUrl);
  }

  /** Get the first Solana wallet address, or null if none exist. */
  getSolanaAddress(): string | null {
    const solWallet = this.store.wallets.find((w) => w.chainType === "solana");
    return solWallet?.address ?? null;
  }

  // ─── Common Methods ───────────────────────────────────────

  private storeWallet(
    key: string,
    address: string,
    label: string,
    chainType: "evm" | "solana",
  ): WalletInfo {
    const encrypted = encrypt(key, this.password);

    const storedWallet: StoredWallet = {
      address,
      label,
      encryptedKey: `${encrypted.ciphertext}:${encrypted.authTag}`,
      iv: encrypted.iv,
      salt: encrypted.salt,
      createdAt: new Date().toISOString(),
      chainType,
    };

    this.store.wallets.push(storedWallet);

    // Set as default if it's the first wallet of its type
    if (!this.store.defaultAddress && chainType === "evm") {
      this.store.defaultAddress = address;
    }

    this.saveStore();
    logger.info({ address, label, chainType }, "Wallet stored");

    return {
      address,
      label,
      isDefault: this.store.defaultAddress === address,
      createdAt: storedWallet.createdAt,
      chainType,
    };
  }

  private findWallet(address: string): StoredWallet {
    const stored = this.store.wallets.find(
      (w) => w.address.toLowerCase() === address.toLowerCase() || w.address === address,
    );
    if (!stored) {
      throw new Error(`Wallet not found: ${address}`);
    }
    return stored;
  }

  listWallets(): WalletInfo[] {
    return this.store.wallets.map((w) => ({
      address: w.address,
      label: w.label,
      isDefault: this.store.defaultAddress === w.address,
      createdAt: w.createdAt,
      chainType: w.chainType ?? "evm",
    }));
  }

  getDefaultAddress(): string | null {
    return this.store.defaultAddress;
  }

  setDefault(address: string): void {
    const exists = this.store.wallets.some(
      (w) => w.address.toLowerCase() === address.toLowerCase() || w.address === address,
    );
    if (!exists) {
      throw new Error(`Wallet not found: ${address}`);
    }
    this.store.defaultAddress = address;
    this.saveStore();
  }

  hasWallets(): boolean {
    return this.store.wallets.length > 0;
  }
}
