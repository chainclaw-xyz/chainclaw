import { startAnvil, type AnvilInstance } from "./anvil.js";

let anvil: AnvilInstance;

export async function setup() {
  const forkUrl = process.env.FORK_RPC_URL;
  if (!forkUrl) {
    console.log("\n[e2e] FORK_RPC_URL not set — skipping E2E tests.");
    console.log("[e2e] To run: FORK_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY npm run test:e2e\n");
    process.env.E2E_SKIP = "1";
    return;
  }

  console.log("[e2e] Starting Anvil (forking Ethereum mainnet)...");

  try {
    anvil = await startAnvil({ port: 8545, forkUrl });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("429") || msg.includes("rate")) {
      console.error("[e2e] Upstream RPC rate-limited. Check your FORK_RPC_URL.");
    }
    throw err;
  }

  console.log(`[e2e] Anvil ready at ${anvil.rpcUrl} (pid: ${anvil.pid})`);
  process.env.ANVIL_RPC_URL = anvil.rpcUrl;
}

export async function teardown() {
  if (anvil) {
    console.log("[e2e] Stopping Anvil...");
    await anvil.stop();
    console.log("[e2e] Anvil stopped.");
  }
}
