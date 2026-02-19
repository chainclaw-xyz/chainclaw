/**
 * URL-dispatching fetch mock.
 * Routes fetch() calls to canned handlers based on URL pattern.
 */
export interface FetchRoute {
  pattern: RegExp;
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>;
}

export class FetchRouter {
  private routes: FetchRoute[] = [];

  /** Register a URL pattern handler */
  addRoute(pattern: RegExp, handler: FetchRoute["handler"]): void {
    this.routes.push({ pattern, handler });
  }

  /** Replace all routes matching a pattern, then add a new handler */
  replaceRoute(pattern: RegExp, handler: FetchRoute["handler"]): void {
    this.routes = this.routes.filter((r) => r.pattern.source !== pattern.source);
    this.routes.push({ pattern, handler });
  }

  /** Set default CoinGecko price response (replaces previous) */
  onCoinGecko(prices: Record<string, number>): void {
    this.replaceRoute(/api\.coingecko\.com/, (_url) => {
      // CoinGecko returns { id: { usd: number } }
      const body: Record<string, { usd: number }> = {};
      for (const [id, price] of Object.entries(prices)) {
        body[id.toLowerCase()] = { usd: price };
      }
      return Response.json(body);
    });
  }

  /** Set default GoPlus token security response */
  onGoPlus(overrides?: { isHoneypot?: boolean; riskLevel?: string }): void {
    const honeypot = overrides?.isHoneypot ? "1" : "0";
    this.replaceRoute(/api\.gopluslabs\.io/, (_url) => {
      return Response.json({
        code: 1,
        result: {
          "0x0000000000000000000000000000000000000001": {
            is_honeypot: honeypot,
            is_open_source: "1",
            is_proxy: "0",
            is_mintable: "0",
            owner_address: "",
            can_take_back_ownership: "0",
            cannot_buy: "0",
            cannot_sell_all: honeypot,
            slippage_modifiable: "0",
            buy_tax: "0",
            sell_tax: "0",
            holder_count: "1000",
            total_supply: "1000000",
            holders: [
              { address: "0xaaa", is_contract: 0, percent: "0.15" },
            ],
          },
        },
      });
    });
  }

  /** Set default 1inch quote response (quote-only, no tx data) */
  on1inchQuote(fromAmount: string, toAmount: string): void {
    this.replaceRoute(/api\.1inch\.dev|1inch\.io/, (_url) => {
      return Response.json({
        fromToken: { symbol: "ETH", decimals: 18 },
        toToken: { symbol: "USDC", decimals: 6 },
        fromAmount,
        toAmount,
        protocols: [],
      });
    });
  }

  /** The fetch handler to install via vi.stubGlobal */
  get handler(): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
    return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      for (const route of this.routes) {
        if (route.pattern.test(url)) {
          return route.handler(url, init);
        }
      }

      // Default: return 404 for unmatched URLs
      return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
    };
  }
}
