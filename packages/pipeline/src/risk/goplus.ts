import { getLogger, fetchWithRetry } from "@chainclaw/core";
import type { Address } from "viem";
import type { TokenSafetyReport, RiskDimension } from "./types.js";

const logger = getLogger("goplus");

// GoPlus chain IDs match standard EVM chain IDs
const SUPPORTED_CHAINS = [1, 8453, 42161, 10, 137, 56, 43114, 324, 534352, 81457, 100, 59144, 250, 5000];

interface GoPlusTokenResponse {
  code: number;
  result: Record<
    string,
    {
      token_name?: string;
      token_symbol?: string;
      is_honeypot?: string;
      is_open_source?: string;
      is_proxy?: string;
      is_mintable?: string;
      can_take_back_ownership?: string;
      owner_change_balance?: string;
      is_blacklisted?: string;
      trading_cooldown?: string;
      buy_tax?: string;
      sell_tax?: string;
      holder_count?: string;
      holders?: Array<{
        address: string;
        percent: string;
        is_locked: number;
        is_contract: number;
      }>;
      lp_holder_count?: string;
      lp_total_supply?: string;
      lp_holders?: Array<{
        address: string;
        percent: string;
        is_locked: number;
        is_contract: number;
      }>;
      total_supply?: string;
    }
  >;
}

export class GoPlusClient {
  private baseUrl = "https://api.gopluslabs.io/api/v1";

  async getTokenSecurity(
    chainId: number,
    tokenAddress: Address,
  ): Promise<TokenSafetyReport | null> {
    if (!SUPPORTED_CHAINS.includes(chainId)) {
      logger.warn({ chainId }, "Chain not supported by GoPlus");
      return null;
    }

    try {
      const url = `${this.baseUrl}/token_security/${chainId}?contract_addresses=${tokenAddress.toLowerCase()}`;
      const response = await fetchWithRetry(url, {
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        logger.error({ status: response.status }, "GoPlus API error");
        return null;
      }

      const data = (await response.json()) as GoPlusTokenResponse;

      if (data.code !== 1) {
        logger.warn({ code: data.code }, "GoPlus returned non-success code");
        return null;
      }

      const tokenData = data.result[tokenAddress.toLowerCase()];
      if (!tokenData) {
        logger.warn({ tokenAddress }, "Token not found in GoPlus response");
        return null;
      }

      return this.parseTokenReport(tokenAddress, chainId, tokenData);
    } catch (err) {
      logger.error({ err, tokenAddress, chainId }, "GoPlus API request failed");
      return null;
    }
  }

  private parseTokenReport(
    address: Address,
    chainId: number,
    data: GoPlusTokenResponse["result"][string],
  ): TokenSafetyReport {
    const dimensions: RiskDimension[] = [];
    const isHoneypot = data.is_honeypot === "1";
    const canTakeBackOwnership = data.can_take_back_ownership === "1";
    const hasMintFunction = data.is_mintable === "1";
    const canBlacklist = data.is_blacklisted === "1";
    const hasTradingCooldown = data.trading_cooldown === "1";
    const isOpenSource = data.is_open_source === "1";
    const buyTax = parseFloat(data.buy_tax ?? "0") * 100;
    const sellTax = parseFloat(data.sell_tax ?? "0") * 100;
    const holderCount = parseInt(data.holder_count ?? "0", 10);

    // Calculate top holder concentration
    let topHolderPercent = 0;
    if (data.holders && data.holders.length > 0) {
      // Sum top 10 non-contract holder percentages
      const humanHolders = data.holders
        .filter((h) => !h.is_contract)
        .slice(0, 10);
      topHolderPercent = humanHolders.reduce(
        (sum, h) => sum + parseFloat(h.percent) * 100,
        0,
      );
    }

    // Honeypot check
    if (isHoneypot) {
      dimensions.push({
        name: "honeypot",
        severity: "critical",
        description: "Token is flagged as a honeypot — you may not be able to sell",
        score: 100,
      });
    }

    // Owner privileges
    if (canTakeBackOwnership) {
      dimensions.push({
        name: "owner_takeback",
        severity: "high",
        description: "Owner can reclaim ownership after renouncing",
        score: 80,
      });
    }

    if (data.owner_change_balance === "1") {
      dimensions.push({
        name: "owner_modify_balance",
        severity: "critical",
        description: "Owner can modify token balances",
        score: 90,
      });
    }

    // Mint function
    if (hasMintFunction) {
      dimensions.push({
        name: "mintable",
        severity: "medium",
        description: "Token has a mint function — supply can be inflated",
        score: 50,
      });
    }

    // Blacklist
    if (canBlacklist) {
      dimensions.push({
        name: "blacklist",
        severity: "medium",
        description: "Contract can blacklist addresses from trading",
        score: 40,
      });
    }

    // Trading cooldown
    if (hasTradingCooldown) {
      dimensions.push({
        name: "trading_cooldown",
        severity: "low",
        description: "Token has a trading cooldown period",
        score: 20,
      });
    }

    // Buy/sell tax
    if (buyTax > 5) {
      dimensions.push({
        name: "buy_tax",
        severity: buyTax > 20 ? "high" : "medium",
        description: `Buy tax: ${buyTax.toFixed(1)}%`,
        score: Math.min(buyTax * 2, 100),
      });
    }

    if (sellTax > 5) {
      dimensions.push({
        name: "sell_tax",
        severity: sellTax > 20 ? "high" : "medium",
        description: `Sell tax: ${sellTax.toFixed(1)}%`,
        score: Math.min(sellTax * 2, 100),
      });
    }

    // Source code verification
    if (!isOpenSource) {
      dimensions.push({
        name: "not_verified",
        severity: "medium",
        description: "Contract source code is not verified",
        score: 40,
      });
    }

    // Holder concentration
    if (topHolderPercent > 50) {
      dimensions.push({
        name: "whale_concentration",
        severity: "high",
        description: `Top holders control ${topHolderPercent.toFixed(1)}% of supply`,
        score: Math.min(topHolderPercent, 100),
      });
    } else if (topHolderPercent > 25) {
      dimensions.push({
        name: "whale_concentration",
        severity: "medium",
        description: `Top holders control ${topHolderPercent.toFixed(1)}% of supply`,
        score: topHolderPercent,
      });
    }

    // Low holder count
    if (holderCount < 100 && holderCount > 0) {
      dimensions.push({
        name: "low_holders",
        severity: "medium",
        description: `Only ${holderCount} holders`,
        score: 40,
      });
    }

    // LP lock analysis
    const lpHolders = data.lp_holders ?? [];
    if (lpHolders.length > 0) {
      const totalLpPercent = lpHolders.reduce(
        (sum, h) => sum + parseFloat(h.percent) * 100,
        0,
      );
      const lockedLpPercent =
        totalLpPercent > 0
          ? (lpHolders
              .filter((h) => h.is_locked === 1)
              .reduce((sum, h) => sum + parseFloat(h.percent) * 100, 0) /
              totalLpPercent) *
            100
          : 0;

      if (lockedLpPercent < 80) {
        const severity: RiskDimension["severity"] =
          lockedLpPercent < 20 ? "high" : "medium";
        dimensions.push({
          name: "unlocked_liquidity",
          severity,
          description: `Only ${lockedLpPercent.toFixed(1)}% of LP tokens are locked`,
          score: severity === "high" ? 70 : 40,
        });
      }
    }

    // Low LP holder count
    const lpHolderCount = parseInt(data.lp_holder_count ?? "0", 10);
    if (lpHolderCount > 0 && lpHolderCount < 5) {
      dimensions.push({
        name: "low_lp_holders",
        severity: "medium",
        description: `Only ${lpHolderCount} LP holder(s) — liquidity is concentrated`,
        score: 45,
      });
    }

    // Calculate overall score
    const overallScore =
      dimensions.length > 0
        ? Math.round(
            dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length,
          )
        : 0;

    const riskLevel = this.scoreToLevel(overallScore);

    logger.info(
      { address, chainId, overallScore, riskLevel, dimensions: dimensions.length },
      "Token risk report generated",
    );

    return {
      address,
      chainId,
      symbol: data.token_symbol ?? "UNKNOWN",
      name: data.token_name ?? "Unknown Token",
      overallScore,
      riskLevel,
      dimensions,
      isHoneypot,
      canTakeBackOwnership,
      hasMintFunction,
      canBlacklist,
      hasTradingCooldown,
      buyTax,
      sellTax,
      holderCount,
      topHolderPercent,
      liquidityUsd: 0, // GoPlus doesn't provide this directly
      isOpenSource,
      cachedAt: new Date().toISOString(),
    };
  }

  private scoreToLevel(score: number): TokenSafetyReport["riskLevel"] {
    if (score >= 80) return "critical";
    if (score >= 60) return "high";
    if (score >= 35) return "medium";
    if (score >= 15) return "low";
    return "safe";
  }
}
