import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@chainclaw/core", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const mockGetEnsAddress = vi.fn();

vi.mock("viem", async () => {
  const actual = await vi.importActual("viem");
  return {
    ...actual,
    createPublicClient: vi.fn().mockReturnValue({
      getEnsAddress: (...args: any[]) => mockGetEnsAddress(...args),
    }),
  };
});

// normalize is a passthrough in tests (no Unicode edge cases)
vi.mock("viem/ens", () => ({
  normalize: (name: string) => name.toLowerCase(),
}));

describe("EnsResolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── isEnsName ─────────────────────────────────────────────

  it("isEnsName returns true for valid ENS names", async () => {
    const { EnsResolver } = await import("../ens.js");
    const resolver = new EnsResolver();

    expect(resolver.isEnsName("vitalik.eth")).toBe(true);
    expect(resolver.isEnsName("name.base.eth")).toBe(true);
    expect(resolver.isEnsName("my-wallet.eth")).toBe(true);
    expect(resolver.isEnsName("sub.domain.eth")).toBe(true);
  });

  it("isEnsName returns false for non-ENS inputs", async () => {
    const { EnsResolver } = await import("../ens.js");
    const resolver = new EnsResolver();

    expect(resolver.isEnsName("0xABCdef1234567890abcdef1234567890ABCDEF12")).toBe(false);
    expect(resolver.isEnsName("hello")).toBe(false);
    expect(resolver.isEnsName("")).toBe(false);
    expect(resolver.isEnsName(".eth")).toBe(false);
    expect(resolver.isEnsName("name.com")).toBe(false);
  });

  // ─── resolve: 0x address passthrough ───────────────────────

  it("resolve returns checksummed address for valid 0x input", async () => {
    const { EnsResolver } = await import("../ens.js");
    const resolver = new EnsResolver();

    const result = await resolver.resolve("0xd8da6bf26964af9d7eed9e03e53415d37aa96045");
    expect(result).toBe("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
    expect(mockGetEnsAddress).not.toHaveBeenCalled();
  });

  it("resolve returns checksummed address for any valid 0x input", async () => {
    const { EnsResolver } = await import("../ens.js");
    const resolver = new EnsResolver();

    const input = "0xABCdef1234567890abcdef1234567890ABCDEF12";
    const result = await resolver.resolve(input);
    // Should return EIP-55 checksummed version of the same address
    expect(result.toLowerCase()).toBe(input.toLowerCase());
    expect(result).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(mockGetEnsAddress).not.toHaveBeenCalled();
  });

  // ─── resolve: ENS name ─────────────────────────────────────

  it("resolve calls getEnsAddress for .eth names", async () => {
    mockGetEnsAddress.mockResolvedValue("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");

    const { EnsResolver } = await import("../ens.js");
    const resolver = new EnsResolver();

    const result = await resolver.resolve("vitalik.eth");
    expect(result).toBe("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
    expect(mockGetEnsAddress).toHaveBeenCalledWith({ name: "vitalik.eth" });
  });

  it("resolve throws for unresolvable ENS names", async () => {
    mockGetEnsAddress.mockResolvedValue(null);

    const { EnsResolver } = await import("../ens.js");
    const resolver = new EnsResolver();

    await expect(resolver.resolve("nonexistent.eth")).rejects.toThrow(
      "ENS name 'nonexistent.eth' did not resolve to an address",
    );
  });

  it("resolve handles L2 subdomains (name.base.eth)", async () => {
    // Mock returns lowercase; resolver should checksum it
    mockGetEnsAddress.mockResolvedValue("0xd8da6bf26964af9d7eed9e03e53415d37aa96045");

    const { EnsResolver } = await import("../ens.js");
    const resolver = new EnsResolver();

    const result = await resolver.resolve("myname.base.eth");
    expect(result).toBe("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
    expect(mockGetEnsAddress).toHaveBeenCalledWith({ name: "myname.base.eth" });
  });

  // ─── resolve: caching ──────────────────────────────────────

  it("caches resolved names and skips RPC on second call", async () => {
    mockGetEnsAddress.mockResolvedValue("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");

    const { EnsResolver } = await import("../ens.js");
    const resolver = new EnsResolver(undefined, { ttlMs: 60_000 });

    await resolver.resolve("vitalik.eth");
    await resolver.resolve("vitalik.eth");

    expect(mockGetEnsAddress).toHaveBeenCalledTimes(1);
  });

  it("cache is case-insensitive", async () => {
    mockGetEnsAddress.mockResolvedValue("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");

    const { EnsResolver } = await import("../ens.js");
    const resolver = new EnsResolver(undefined, { ttlMs: 60_000 });

    await resolver.resolve("Vitalik.eth");
    await resolver.resolve("vitalik.eth");

    expect(mockGetEnsAddress).toHaveBeenCalledTimes(1);
  });

  it("re-resolves after TTL expires", async () => {
    mockGetEnsAddress.mockResolvedValue("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");

    const { EnsResolver } = await import("../ens.js");
    const resolver = new EnsResolver(undefined, { ttlMs: 1 }); // 1ms TTL

    await resolver.resolve("vitalik.eth");

    // Wait for TTL to expire
    await new Promise((r) => setTimeout(r, 5));

    await resolver.resolve("vitalik.eth");
    expect(mockGetEnsAddress).toHaveBeenCalledTimes(2);
  });

  it("evicts oldest entry when cache is full", async () => {
    mockGetEnsAddress.mockResolvedValue("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");

    const { EnsResolver } = await import("../ens.js");
    const resolver = new EnsResolver(undefined, { ttlMs: 60_000, maxEntries: 2 });

    await resolver.resolve("a.eth");
    await resolver.resolve("b.eth");
    await resolver.resolve("c.eth"); // should evict "a.eth" (oldest)

    expect(mockGetEnsAddress).toHaveBeenCalledTimes(3);

    // "a.eth" was evicted, needs re-resolution
    await resolver.resolve("a.eth");
    expect(mockGetEnsAddress).toHaveBeenCalledTimes(4);

    // "b.eth" was also evicted (by c.eth insertion b was oldest, then a.eth evicted b)
    // After c.eth insert: cache = [b, c]. Then a.eth evicts b → cache = [c, a].
    // So b.eth needs re-resolution:
    await resolver.resolve("b.eth");
    expect(mockGetEnsAddress).toHaveBeenCalledTimes(5);
  });

  it("LRU: cache hit moves entry to end, protecting it from eviction", async () => {
    mockGetEnsAddress.mockResolvedValue("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");

    const { EnsResolver } = await import("../ens.js");
    const resolver = new EnsResolver(undefined, { ttlMs: 60_000, maxEntries: 2 });

    await resolver.resolve("a.eth"); // cache: [a]
    await resolver.resolve("b.eth"); // cache: [a, b]

    // Access "a.eth" — cache hit moves it to end: [b, a]
    await resolver.resolve("a.eth");
    expect(mockGetEnsAddress).toHaveBeenCalledTimes(2); // still cached

    // Insert "c.eth" — evicts "b.eth" (now oldest): [a, c]
    await resolver.resolve("c.eth");
    expect(mockGetEnsAddress).toHaveBeenCalledTimes(3);

    // "a.eth" should still be cached (was moved to end by LRU hit)
    await resolver.resolve("a.eth");
    expect(mockGetEnsAddress).toHaveBeenCalledTimes(3); // no new call

    // "b.eth" was evicted, needs re-resolution
    await resolver.resolve("b.eth");
    expect(mockGetEnsAddress).toHaveBeenCalledTimes(4);
  });

  it("clearCache empties the cache", async () => {
    mockGetEnsAddress.mockResolvedValue("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");

    const { EnsResolver } = await import("../ens.js");
    const resolver = new EnsResolver(undefined, { ttlMs: 60_000 });

    await resolver.resolve("vitalik.eth");
    resolver.clearCache();
    await resolver.resolve("vitalik.eth");

    expect(mockGetEnsAddress).toHaveBeenCalledTimes(2);
  });

  // ─── resolve: error handling ───────────────────────────────

  it("throws for invalid input (not address and not ENS)", async () => {
    const { EnsResolver } = await import("../ens.js");
    const resolver = new EnsResolver();

    await expect(resolver.resolve("hello")).rejects.toThrow("Invalid address or ENS name");
    await expect(resolver.resolve("")).rejects.toThrow("Invalid address or ENS name");
    await expect(resolver.resolve("0x123")).rejects.toThrow("Invalid address or ENS name");
  });

  it("propagates RPC errors from getEnsAddress", async () => {
    mockGetEnsAddress.mockRejectedValue(new Error("RPC timeout"));

    const { EnsResolver } = await import("../ens.js");
    const resolver = new EnsResolver();

    await expect(resolver.resolve("vitalik.eth")).rejects.toThrow("RPC timeout");
  });
});
