import { z } from "zod";
import {
  createPublicClient,
  http,
  encodeFunctionData,
  parseUnits,

  maxUint256,
  erc20Abi,
  type Address,
  type Hex,
  type Chain,
} from "viem";
import { mainnet, base, arbitrum, optimism } from "viem/chains";
import { getLogger, type SkillResult } from "@chainclaw/core";
import type { TransactionExecutor } from "@chainclaw/pipeline";
import type { WalletManager, Signer } from "@chainclaw/wallet";
import type { SkillDefinition, SkillExecutionContext } from "./types.js";
import { getEthPriceUsd } from "./prices.js";

const logger = getLogger("skill-lend");

const lendParams = z.object({
  action: z.enum(["supply", "withdraw", "borrow", "repay", "position"]),
  token: z.string().optional(),
  amount: z.string().optional(),
  chainId: z.number().default(1),
  interestRateMode: z.number().optional(), // 2 = variable (default), 1 = stable (deprecated on most)
});

// Aave V3 Pool addresses
const AAVE_POOL: Record<number, Address> = {
  1: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
  8453: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
  42161: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
  10: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
};

// Aave-supported tokens per chain
const AAVE_TOKENS: Record<number, Record<string, { address: Address; decimals: number }>> = {
  1: {
    USDC: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
    USDT: { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
    WETH: { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18 },
    DAI: { address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", decimals: 18 },
  },
  8453: {
    USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
    WETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18 },
  },
  42161: {
    USDC: { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
    USDT: { address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6 },
    WETH: { address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", decimals: 18 },
    DAI: { address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", decimals: 18 },
  },
  10: {
    USDC: { address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6 },
    USDT: { address: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", decimals: 6 },
    WETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18 },
    DAI: { address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", decimals: 18 },
  },
};

const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum",
  8453: "Base",
  42161: "Arbitrum",
  10: "Optimism",
};

const viemChains: Record<number, Chain> = {
  1: mainnet,
  8453: base,
  42161: arbitrum,
  10: optimism,
};

// Minimal Aave V3 Pool ABI
const POOL_ABI = [
  {
    name: "supply",
    type: "function" as const,
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "asset", type: "address" as const },
      { name: "amount", type: "uint256" as const },
      { name: "onBehalfOf", type: "address" as const },
      { name: "referralCode", type: "uint16" as const },
    ],
    outputs: [],
  },
  {
    name: "withdraw",
    type: "function" as const,
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "asset", type: "address" as const },
      { name: "amount", type: "uint256" as const },
      { name: "to", type: "address" as const },
    ],
    outputs: [{ name: "", type: "uint256" as const }],
  },
  {
    name: "borrow",
    type: "function" as const,
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "asset", type: "address" as const },
      { name: "amount", type: "uint256" as const },
      { name: "interestRateMode", type: "uint256" as const },
      { name: "referralCode", type: "uint16" as const },
      { name: "onBehalfOf", type: "address" as const },
    ],
    outputs: [],
  },
  {
    name: "repay",
    type: "function" as const,
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "asset", type: "address" as const },
      { name: "amount", type: "uint256" as const },
      { name: "interestRateMode", type: "uint256" as const },
      { name: "onBehalfOf", type: "address" as const },
    ],
    outputs: [{ name: "", type: "uint256" as const }],
  },
  {
    name: "getUserAccountData",
    type: "function" as const,
    stateMutability: "view" as const,
    inputs: [{ name: "user", type: "address" as const }],
    outputs: [
      { name: "totalCollateralBase", type: "uint256" as const },
      { name: "totalDebtBase", type: "uint256" as const },
      { name: "availableBorrowsBase", type: "uint256" as const },
      { name: "currentLiquidationThreshold", type: "uint256" as const },
      { name: "ltv", type: "uint256" as const },
      { name: "healthFactor", type: "uint256" as const },
    ],
  },
] as const;

function getClient(chainId: number, rpcOverrides?: Record<number, string>) {
  const chain = viemChains[chainId];
  if (!chain) throw new Error(`Unsupported chain: ${chainId}`);
  return createPublicClient({ chain, transport: http(rpcOverrides?.[chainId]) });
}

export function createLendSkill(
  executor: TransactionExecutor,
  walletManager: WalletManager,
  rpcOverrides?: Record<number, string>,
): SkillDefinition {
  return {
    name: "lend",
    description:
      "Lend/borrow via Aave V3. Supply tokens as collateral, borrow against them, withdraw, repay, or check your lending position.",
    parameters: lendParams,

    async execute(params: unknown, context: SkillExecutionContext): Promise<SkillResult> {
      const parsed = lendParams.parse(params);

      if (!context.walletAddress) {
        return { success: false, message: "No wallet configured. Use /wallet create first." };
      }

      const { action, chainId } = parsed;
      const chainName = CHAIN_NAMES[chainId] ?? `Chain ${chainId}`;
      const poolAddress = AAVE_POOL[chainId];

      if (!poolAddress) {
        return { success: false, message: `Aave V3 is not available on ${chainName}.` };
      }

      if (action === "position") {
        return getPosition(chainId, chainName, poolAddress, context, rpcOverrides);
      }

      // All write actions need token and amount
      const tokenUpper = parsed.token?.toUpperCase();
      if (!tokenUpper || !parsed.amount) {
        return { success: false, message: `Token and amount are required for ${action}.` };
      }

      const tokenInfo = AAVE_TOKENS[chainId]?.[tokenUpper];
      if (!tokenInfo) {
        const supported = Object.keys(AAVE_TOKENS[chainId] ?? {}).join(", ");
        return {
          success: false,
          message: `${tokenUpper} is not supported on Aave V3 (${chainName}). Supported: ${supported || "none"}`,
        };
      }

      const amountWei = parseUnits(parsed.amount, tokenInfo.decimals);
      const rateMode = BigInt(parsed.interestRateMode ?? 2); // default: variable

      logger.info({ action, token: tokenUpper, amount: parsed.amount, chainId }, "Executing lend action");

      const walletAddr = context.walletAddress as Address;
      const signer = walletManager.getSigner(context.walletAddress, rpcOverrides);
      const ethPrice = await getEthPriceUsd();

      switch (action) {
        case "supply":
          return handleSupply(
            chainId, chainName, poolAddress, tokenInfo.address, tokenUpper,
            parsed.amount, amountWei, tokenInfo.decimals, walletAddr, signer,
            ethPrice, executor, context, rpcOverrides,
          );
        case "withdraw":
          return handleWithdraw(
            chainId, chainName, poolAddress, tokenInfo.address, tokenUpper,
            parsed.amount, amountWei, walletAddr, signer, ethPrice,
            executor, context,
          );
        case "borrow":
          return handleBorrow(
            chainId, chainName, poolAddress, tokenInfo.address, tokenUpper,
            parsed.amount, amountWei, rateMode, walletAddr, signer, ethPrice,
            executor, context,
          );
        case "repay":
          return handleRepay(
            chainId, chainName, poolAddress, tokenInfo.address, tokenUpper,
            parsed.amount, amountWei, tokenInfo.decimals, rateMode, walletAddr,
            signer, ethPrice, executor, context, rpcOverrides,
          );
      }
    },
  };
}

// ─── Position query ─────────────────────────────────────────────

async function getPosition(
  chainId: number,
  chainName: string,
  poolAddress: Address,
  context: SkillExecutionContext,
  rpcOverrides?: Record<number, string>,
): Promise<SkillResult> {
  const client = getClient(chainId, rpcOverrides);
  const walletAddr = context.walletAddress as Address;

  try {
    const data = await client.readContract({
      address: poolAddress,
      abi: POOL_ABI,
      functionName: "getUserAccountData",
      args: [walletAddr],
    });

    const [totalCollateral, totalDebt, availableBorrows, liqThreshold, ltv, healthFactor] = data;

    // Aave returns base currency values in 8 decimals (USD)
    const collateralUsd = Number(totalCollateral) / 1e8;
    const debtUsd = Number(totalDebt) / 1e8;
    const availableUsd = Number(availableBorrows) / 1e8;
    const hf = Number(healthFactor) / 1e18;
    const ltvPct = Number(ltv) / 100;
    const liqPct = Number(liqThreshold) / 100;

    if (collateralUsd === 0 && debtUsd === 0) {
      return {
        success: true,
        message: `*Aave V3 Position (${chainName})*\n\nNo active lending position found.`,
      };
    }

    const hfDisplay = debtUsd > 0 ? (hf > 100 ? ">100" : hf.toFixed(2)) : "N/A (no debt)";
    const hfWarning = debtUsd > 0 && hf < 1.5 ? "\n⚠️ Health factor is low — consider repaying or adding collateral." : "";

    return {
      success: true,
      message:
        `*Aave V3 Position (${chainName})*\n\n` +
        `Collateral: $${formatUsd(collateralUsd)}\n` +
        `Debt: $${formatUsd(debtUsd)}\n` +
        `Available to borrow: $${formatUsd(availableUsd)}\n` +
        `LTV: ${ltvPct.toFixed(1)}%\n` +
        `Liquidation threshold: ${liqPct.toFixed(1)}%\n` +
        `Health factor: ${hfDisplay}` +
        hfWarning,
      data: { collateralUsd, debtUsd, availableUsd, healthFactor: hf, ltv: ltvPct },
    };
  } catch (err) {
    logger.error({ err, chainId }, "Failed to fetch Aave position");
    return { success: false, message: `Failed to fetch Aave position on ${chainName}. RPC may be unavailable.` };
  }
}

// ─── Supply ─────────────────────────────────────────────────────

async function handleSupply(
  chainId: number, chainName: string, poolAddress: Address,
  tokenAddress: Address, tokenSymbol: string,
  amountHuman: string, amountWei: bigint, decimals: number,
  walletAddr: Address, signer: Signer,
  ethPrice: number, executor: TransactionExecutor,
  context: SkillExecutionContext, rpcOverrides?: Record<number, string>,
): Promise<SkillResult> {
  await context.sendReply(`_Supplying ${amountHuman} ${tokenSymbol} to Aave V3 on ${chainName}..._`);

  // Check and handle approval
  const approvalResult = await ensureApproval(
    chainId, poolAddress, tokenAddress, tokenSymbol, amountWei, decimals,
    walletAddr, signer, ethPrice, executor, context, rpcOverrides,
  );
  if (!approvalResult.success) return approvalResult;

  // Encode supply call
  const data = encodeFunctionData({
    abi: POOL_ABI,
    functionName: "supply",
    args: [tokenAddress, amountWei, walletAddr, 0],
  });

  if (context.requestConfirmation) {
    const confirmed = await context.requestConfirmation(
      `*Supply ${amountHuman} ${tokenSymbol} to Aave V3*\n\nChain: ${chainName}\n\nProceed?`,
    );
    if (!confirmed) return { success: false, message: "Supply cancelled." };
  }

  const result = await executor.execute(
    { chainId, from: walletAddr, to: poolAddress, value: 0n, data: data, gasLimit: 300_000n },
    signer,
    { userId: context.userId, skillName: "lend", intentDescription: `Supply ${amountHuman} ${tokenSymbol} to Aave V3 on ${chainName}`, ethPriceUsd: ethPrice },
    buildCallbacks(context, `Supplied ${amountHuman} ${tokenSymbol} to Aave V3 on ${chainName}`),
  );

  return { success: result.success, message: result.message };
}

// ─── Withdraw ───────────────────────────────────────────────────

async function handleWithdraw(
  chainId: number, chainName: string, poolAddress: Address,
  tokenAddress: Address, tokenSymbol: string,
  amountHuman: string, amountWei: bigint,
  walletAddr: Address, signer: Signer,
  ethPrice: number, executor: TransactionExecutor,
  context: SkillExecutionContext,
): Promise<SkillResult> {
  // Use max uint256 for "all" withdrawals
  const withdrawAmount = amountHuman.toLowerCase() === "all" ? maxUint256 : amountWei;

  await context.sendReply(`_Withdrawing ${amountHuman} ${tokenSymbol} from Aave V3 on ${chainName}..._`);

  if (context.requestConfirmation) {
    const confirmed = await context.requestConfirmation(
      `*Withdraw ${amountHuman} ${tokenSymbol} from Aave V3*\n\nChain: ${chainName}\n\nProceed?`,
    );
    if (!confirmed) return { success: false, message: "Withdraw cancelled." };
  }

  const data = encodeFunctionData({
    abi: POOL_ABI,
    functionName: "withdraw",
    args: [tokenAddress, withdrawAmount, walletAddr],
  });

  const result = await executor.execute(
    { chainId, from: walletAddr, to: poolAddress, value: 0n, data: data, gasLimit: 300_000n },
    signer,
    { userId: context.userId, skillName: "lend", intentDescription: `Withdraw ${amountHuman} ${tokenSymbol} from Aave V3 on ${chainName}`, ethPriceUsd: ethPrice },
    buildCallbacks(context, `Withdrew ${amountHuman} ${tokenSymbol} from Aave V3 on ${chainName}`),
  );

  return { success: result.success, message: result.message };
}

// ─── Borrow ─────────────────────────────────────────────────────

async function handleBorrow(
  chainId: number, chainName: string, poolAddress: Address,
  tokenAddress: Address, tokenSymbol: string,
  amountHuman: string, amountWei: bigint, rateMode: bigint,
  walletAddr: Address, signer: Signer,
  ethPrice: number, executor: TransactionExecutor,
  context: SkillExecutionContext,
): Promise<SkillResult> {
  const rateLabel = rateMode === 1n ? "stable" : "variable";

  await context.sendReply(
    `_Borrowing ${amountHuman} ${tokenSymbol} from Aave V3 on ${chainName} (${rateLabel} rate)..._`,
  );

  if (context.requestConfirmation) {
    const confirmed = await context.requestConfirmation(
      `*Borrow ${amountHuman} ${tokenSymbol} from Aave V3*\n\nChain: ${chainName}\nRate: ${rateLabel}\n\nProceed?`,
    );
    if (!confirmed) return { success: false, message: "Borrow cancelled." };
  }

  const data = encodeFunctionData({
    abi: POOL_ABI,
    functionName: "borrow",
    args: [tokenAddress, amountWei, rateMode, 0, walletAddr],
  });

  const result = await executor.execute(
    { chainId, from: walletAddr, to: poolAddress, value: 0n, data: data, gasLimit: 350_000n },
    signer,
    { userId: context.userId, skillName: "lend", intentDescription: `Borrow ${amountHuman} ${tokenSymbol} (${rateLabel}) from Aave V3 on ${chainName}`, ethPriceUsd: ethPrice },
    buildCallbacks(context, `Borrowed ${amountHuman} ${tokenSymbol} (${rateLabel}) from Aave V3 on ${chainName}`),
  );

  return { success: result.success, message: result.message };
}

// ─── Repay ──────────────────────────────────────────────────────

async function handleRepay(
  chainId: number, chainName: string, poolAddress: Address,
  tokenAddress: Address, tokenSymbol: string,
  amountHuman: string, amountWei: bigint, decimals: number, rateMode: bigint,
  walletAddr: Address, signer: Signer,
  ethPrice: number, executor: TransactionExecutor,
  context: SkillExecutionContext, rpcOverrides?: Record<number, string>,
): Promise<SkillResult> {
  const rateLabel = rateMode === 1n ? "stable" : "variable";
  const repayAmount = amountHuman.toLowerCase() === "all" ? maxUint256 : amountWei;

  await context.sendReply(
    `_Repaying ${amountHuman} ${tokenSymbol} on Aave V3 (${chainName}, ${rateLabel} rate)..._`,
  );

  // Approval needed for repay
  const approvalResult = await ensureApproval(
    chainId, poolAddress, tokenAddress, tokenSymbol,
    repayAmount === maxUint256 ? maxUint256 : amountWei,
    decimals, walletAddr, signer, ethPrice, executor, context, rpcOverrides,
  );
  if (!approvalResult.success) return approvalResult;

  if (context.requestConfirmation) {
    const confirmed = await context.requestConfirmation(
      `*Repay ${amountHuman} ${tokenSymbol} on Aave V3*\n\nChain: ${chainName}\nRate: ${rateLabel}\n\nProceed?`,
    );
    if (!confirmed) return { success: false, message: "Repay cancelled." };
  }

  const data = encodeFunctionData({
    abi: POOL_ABI,
    functionName: "repay",
    args: [tokenAddress, repayAmount, rateMode, walletAddr],
  });

  const result = await executor.execute(
    { chainId, from: walletAddr, to: poolAddress, value: 0n, data: data, gasLimit: 300_000n },
    signer,
    { userId: context.userId, skillName: "lend", intentDescription: `Repay ${amountHuman} ${tokenSymbol} (${rateLabel}) on Aave V3 (${chainName})`, ethPriceUsd: ethPrice },
    buildCallbacks(context, `Repaid ${amountHuman} ${tokenSymbol} on Aave V3 (${chainName})`),
  );

  return { success: result.success, message: result.message };
}

// ─── Token approval helper ──────────────────────────────────────

async function ensureApproval(
  chainId: number, spender: Address, tokenAddress: Address,
  tokenSymbol: string, amountNeeded: bigint, decimals: number,
  walletAddr: Address, signer: Signer,
  ethPrice: number, executor: TransactionExecutor,
  context: SkillExecutionContext, rpcOverrides?: Record<number, string>,
): Promise<SkillResult> {
  const client = getClient(chainId, rpcOverrides);

  try {
    const allowance = await client.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "allowance",
      args: [walletAddr, spender],
    });

    if (allowance >= amountNeeded) {
      return { success: true, message: "Allowance sufficient." };
    }

    logger.info({ tokenSymbol, allowance: allowance.toString(), needed: amountNeeded.toString() }, "Approval needed");
    await context.sendReply(`_Approving ${tokenSymbol} for Aave V3..._`);

    const approveData = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [spender, maxUint256],
    });

    const result = await executor.execute(
      { chainId, from: walletAddr, to: tokenAddress, value: 0n, data: approveData, gasLimit: 100_000n },
      signer,
      { userId: context.userId, skillName: "lend", intentDescription: `Approve ${tokenSymbol} for Aave V3`, ethPriceUsd: ethPrice },
      {
        onBroadcast: async (hash) => {
          await context.sendReply(`Approval tx broadcast: \`${hash}\``);
        },
        onConfirmed: async () => {
          await context.sendReply(`${tokenSymbol} approved for Aave V3.`);
        },
        onFailed: async (error) => {
          await context.sendReply(`Approval failed: ${error}`);
        },
      },
    );

    return result;
  } catch (err) {
    logger.error({ err }, "Failed to check/set approval");
    return { success: false, message: `Failed to check token allowance. RPC may be unavailable.` };
  }
}

// ─── Shared transaction callbacks ───────────────────────────────

function buildCallbacks(context: SkillExecutionContext, successMsg: string) {
  return {
    onSimulated: async (_sim: unknown, preview: string) => {
      await context.sendReply(preview);
    },
    onRiskWarning: context.requestConfirmation
      ? async (warning: string) => context.requestConfirmation!(`*Risk Warning*\n\n${warning}\n\nProceed?`)
      : undefined,
    onBroadcast: async (hash: Hex) => {
      await context.sendReply(`Transaction broadcast: \`${hash}\``);
    },
    onConfirmed: async (_hash: Hex, blockNumber: bigint) => {
      await context.sendReply(`${successMsg}\nConfirmed in block ${blockNumber}.`);
    },
    onFailed: async (error: string) => {
      await context.sendReply(`Transaction failed: ${error}`);
    },
  };
}

// ─── Formatting helpers ─────────────────────────────────────────

function formatUsd(value: number): string {
  if (value < 0.01) return "0.00";
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
