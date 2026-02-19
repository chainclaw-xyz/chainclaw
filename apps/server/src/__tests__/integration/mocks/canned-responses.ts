/**
 * Reusable canned response data for integration tests.
 */
import type { TokenBalance } from "@chainclaw/core";

export const ETH_BALANCE_1ETH: TokenBalance = {
  symbol: "ETH",
  name: "Ether",
  address: null,
  decimals: 18,
  balance: "1000000000000000000",
  formatted: "1.0",
  chainId: 1,
};

export const ETH_BALANCE_2ETH: TokenBalance = {
  symbol: "ETH",
  name: "Ether",
  address: null,
  decimals: 18,
  balance: "2000000000000000000",
  formatted: "2.0",
  chainId: 1,
};

export const USDC_BALANCE_5K: TokenBalance = {
  symbol: "USDC",
  name: "USD Coin",
  address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  decimals: 6,
  balance: "5000000000",
  formatted: "5000.0",
  chainId: 1,
};

export const BASE_ETH_BALANCE: TokenBalance = {
  symbol: "ETH",
  name: "Ether",
  address: null,
  decimals: 18,
  balance: "500000000000000000",
  formatted: "0.5",
  chainId: 8453,
};

export const ARB_ETH_BALANCE: TokenBalance = {
  symbol: "ETH",
  name: "Ether",
  address: null,
  decimals: 18,
  balance: "100000000000000000",
  formatted: "0.1",
  chainId: 42161,
};

export const OP_ETH_BALANCE: TokenBalance = {
  symbol: "ETH",
  name: "Ether",
  address: null,
  decimals: 18,
  balance: "0",
  formatted: "0.0",
  chainId: 10,
};

/** Standard CoinGecko price mapping */
export const STANDARD_PRICES: Record<string, number> = {
  ethereum: 3000,
  bitcoin: 60000,
  "usd-coin": 1,
  tether: 1,
  dai: 1,
};
