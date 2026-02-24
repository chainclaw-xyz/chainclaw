import { spawn, type ChildProcess } from "node:child_process";

const DEFAULT_FORK_URL = "https://eth.llamarpc.com";
const DEFAULT_PORT = 8545;
const READY_POLL_INTERVAL_MS = 200;
const READY_TIMEOUT_MS = 30_000;

export interface AnvilInstance {
  port: number;
  rpcUrl: string;
  pid: number;
  stop(): Promise<void>;
}

export interface AnvilOptions {
  forkUrl?: string;
  port?: number;
  blockTime?: number;
}

/**
 * Spawn an Anvil process forking Ethereum mainnet.
 * Waits for the RPC endpoint to respond before resolving.
 */
export async function startAnvil(opts: AnvilOptions = {}): Promise<AnvilInstance> {
  const forkUrl = opts.forkUrl ?? process.env.FORK_RPC_URL ?? DEFAULT_FORK_URL;
  const port = opts.port ?? DEFAULT_PORT;

  const args = [
    "--fork-url", forkUrl,
    "--port", String(port),
    "--auto-impersonate",
    "--no-rate-limit",
  ];

  if (opts.blockTime !== undefined) {
    args.push("--block-time", String(opts.blockTime));
  }

  const proc: ChildProcess = spawn("anvil", args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Capture stderr for debugging if startup fails
  const stderr = { buf: "" };
  proc.stderr?.on("data", (chunk: Buffer) => {
    stderr.buf += chunk.toString();
  });

  const rpcUrl = `http://127.0.0.1:${port}`;

  // Wait for Anvil to be ready
  await waitForReady(rpcUrl, proc, stderr);

  return {
    port,
    rpcUrl,
    pid: proc.pid!,
    async stop() {
      if (!proc.killed) {
        proc.kill("SIGTERM");
        // Give it a moment, then force kill
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            if (!proc.killed) proc.kill("SIGKILL");
            resolve();
          }, 3000);
          proc.on("exit", () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      }
    },
  };
}

async function waitForReady(rpcUrl: string, proc: ChildProcess, stderr: { buf: string }): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < READY_TIMEOUT_MS) {
    // Check if process exited early
    if (proc.exitCode !== null) {
      throw new Error(`Anvil exited with code ${proc.exitCode}:\n${stderr.buf}`);
    }

    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "eth_chainId", params: [], id: 1 }),
      });
      if (res.ok) return;
    } catch {
      // Not ready yet
    }

    await sleep(READY_POLL_INTERVAL_MS);
  }

  proc.kill("SIGKILL");
  throw new Error(`Anvil did not become ready within ${READY_TIMEOUT_MS}ms:\n${stderr.buf}`);
}

// ─── Anvil JSON-RPC helpers ────────────────────────────────────────

/** Set the ETH balance of an address (in wei hex string). */
export async function fundAccount(rpcUrl: string, address: string, weiHex: string): Promise<void> {
  await anvilRpc(rpcUrl, "anvil_setBalance", [address, weiHex]);
}

/** Take an EVM snapshot. Returns the snapshot ID. */
export async function snapshot(rpcUrl: string): Promise<string> {
  return anvilRpc(rpcUrl, "evm_snapshot", []);
}

/** Revert to a snapshot. */
export async function revert(rpcUrl: string, snapshotId: string): Promise<void> {
  await anvilRpc(rpcUrl, "evm_revert", [snapshotId]);
}

/** Mine a single block. */
export async function mineBlock(rpcUrl: string): Promise<void> {
  await anvilRpc(rpcUrl, "evm_mine", []);
}

async function anvilRpc(rpcUrl: string, method: string, params: unknown[]): Promise<any> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  const json = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (json.error) throw new Error(`Anvil RPC ${method} failed: ${json.error.message}`);
  return json.result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Well-known Anvil test accounts ────────────────────────────────

/** Anvil's default account #0 — pre-funded with 10,000 ETH */
export const ANVIL_ACCOUNT_0 = {
  address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as const,
  privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const,
};

/** Anvil's default account #1 */
export const ANVIL_ACCOUNT_1 = {
  address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const,
  privateKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const,
};
