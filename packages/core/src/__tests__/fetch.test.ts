import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchWithRetry, HttpRetryError } from "../fetch.js";

// Stub timers so retries don't actually wait
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function mockFetch(impl: (...args: unknown[]) => unknown) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(impl as typeof fetch);
}

function okResponse(body = "ok") {
  return new Response(body, { status: 200, statusText: "OK" });
}

function errorResponse(status: number, statusText = "Error", headers?: Record<string, string>) {
  return new Response(null, { status, statusText, headers });
}

describe("fetchWithRetry", () => {
  it("returns successful response without retry", async () => {
    const spy = mockFetch(() => Promise.resolve(okResponse()));

    const res = await fetchWithRetry("https://api.example.com/data");

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("retries on transient network error and succeeds", async () => {
    const networkErr = new TypeError("fetch failed");
    (networkErr as unknown as { cause: Error }).cause = Object.assign(
      new Error("connect ECONNRESET"),
      { code: "ECONNRESET" },
    );

    const spy = mockFetch(() => Promise.reject(networkErr));
    // Succeed on second attempt
    spy.mockImplementationOnce(() => Promise.reject(networkErr));
    spy.mockImplementationOnce(() => Promise.resolve(okResponse()));

    const res = await fetchWithRetry("https://api.example.com/data");
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("retries on 429 and succeeds on second attempt", async () => {
    const spy = mockFetch(() => Promise.resolve(errorResponse(429, "Too Many Requests")));
    spy.mockImplementationOnce(() => Promise.resolve(errorResponse(429, "Too Many Requests")));
    spy.mockImplementationOnce(() => Promise.resolve(okResponse()));

    const res = await fetchWithRetry("https://api.example.com/data");
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("retries on 502, 503, 504", async () => {
    for (const status of [502, 503, 504]) {
      vi.restoreAllMocks();
      const spy = mockFetch(() => Promise.resolve(errorResponse(status)));
      spy.mockImplementationOnce(() => Promise.resolve(errorResponse(status)));
      spy.mockImplementationOnce(() => Promise.resolve(okResponse()));

      const res = await fetchWithRetry("https://api.example.com/data");
      expect(res.status).toBe(200);
      expect(spy).toHaveBeenCalledTimes(2);
    }
  });

  it("does NOT retry on 400, 401, 403, 404", async () => {
    for (const status of [400, 401, 403, 404]) {
      vi.restoreAllMocks();
      const spy = mockFetch(() => Promise.resolve(errorResponse(status)));

      const res = await fetchWithRetry("https://api.example.com/data");
      expect(res.status).toBe(status);
      expect(spy).toHaveBeenCalledTimes(1);
    }
  });

  it("respects Retry-After header on 429", async () => {
    const headers429 = { "retry-after": "2" };
    const spy = mockFetch(() => Promise.resolve(errorResponse(429, "Rate Limited", headers429)));
    spy.mockImplementationOnce(() => Promise.resolve(errorResponse(429, "Rate Limited", headers429)));
    spy.mockImplementationOnce(() => Promise.resolve(okResponse()));

    const res = await fetchWithRetry("https://api.example.com/data");
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("throws HttpRetryError after all attempts exhausted on retryable status", async () => {
    mockFetch(() => Promise.resolve(errorResponse(503, "Service Unavailable")));

    await expect(
      fetchWithRetry("https://api.example.com/data", undefined, { maxAttempts: 2 }),
    ).rejects.toThrow(HttpRetryError);
  });

  it("throws network error after all attempts exhausted", async () => {
    const networkErr = new TypeError("fetch failed");
    (networkErr as unknown as { cause: Error }).cause = Object.assign(
      new Error("connect ETIMEDOUT"),
      { code: "ETIMEDOUT" },
    );

    mockFetch(() => Promise.reject(networkErr));

    await expect(
      fetchWithRetry("https://api.example.com/data", undefined, { maxAttempts: 2 }),
    ).rejects.toThrow(TypeError);
  });

  it("respects maxAttempts option", async () => {
    const spy = mockFetch(() => Promise.resolve(errorResponse(503)));

    await expect(
      fetchWithRetry("https://api.example.com/data", undefined, { maxAttempts: 1 }),
    ).rejects.toThrow(HttpRetryError);

    // maxAttempts: 1 means no retries
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does not retry non-retryable errors", async () => {
    const configErr = new Error("Invalid API key");
    const spy = mockFetch(() => Promise.reject(configErr));

    await expect(
      fetchWithRetry("https://api.example.com/data"),
    ).rejects.toThrow("Invalid API key");

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("supports custom retryableStatuses", async () => {
    const spy = mockFetch(() => Promise.resolve(errorResponse(408, "Request Timeout")));
    spy.mockImplementationOnce(() => Promise.resolve(errorResponse(408, "Request Timeout")));
    spy.mockImplementationOnce(() => Promise.resolve(okResponse()));

    const res = await fetchWithRetry("https://api.example.com/data", undefined, {
      retryableStatuses: [408],
    });
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
