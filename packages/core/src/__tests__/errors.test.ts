import { describe, it, expect } from "vitest";
import {
  isAbortError,
  isTransientNetworkError,
  classifyError,
  type ErrorCategory,
} from "../errors.js";

describe("isAbortError", () => {
  it("detects DOMException AbortError", () => {
    expect(isAbortError(new DOMException("Aborted", "AbortError"))).toBe(true);
  });

  it("detects object with name AbortError", () => {
    expect(isAbortError({ name: "AbortError", message: "cancelled" })).toBe(true);
  });

  it("returns false for regular errors", () => {
    expect(isAbortError(new Error("nope"))).toBe(false);
  });
});

describe("isTransientNetworkError", () => {
  it("detects ECONNRESET", () => {
    const err = Object.assign(new Error("connection reset"), { code: "ECONNRESET" });
    expect(isTransientNetworkError(err)).toBe(true);
  });

  it("detects ECONNREFUSED", () => {
    const err = Object.assign(new Error("refused"), { code: "ECONNREFUSED" });
    expect(isTransientNetworkError(err)).toBe(true);
  });

  it("detects ETIMEDOUT", () => {
    const err = Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
    expect(isTransientNetworkError(err)).toBe(true);
  });

  it("detects undici UND_ERR_CONNECT_TIMEOUT", () => {
    const err = Object.assign(new Error("connect timeout"), { code: "UND_ERR_CONNECT_TIMEOUT" });
    expect(isTransientNetworkError(err)).toBe(true);
  });

  it("detects fetch failed TypeError with transient cause", () => {
    const cause = Object.assign(new Error("dns"), { code: "ENOTFOUND" });
    const err = new TypeError("fetch failed");
    (err as unknown as { cause: Error }).cause = cause;
    expect(isTransientNetworkError(err)).toBe(true);
  });

  it("detects transient error in cause chain", () => {
    const inner = Object.assign(new Error("reset"), { code: "ECONNRESET" });
    const outer = Object.assign(new Error("wrapper"), { cause: inner });
    expect(isTransientNetworkError(outer)).toBe(true);
  });

  it("detects AggregateError with transient element", () => {
    const transient = Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
    const agg = new AggregateError([new Error("other"), transient]);
    expect(isTransientNetworkError(agg)).toBe(true);
  });

  it("returns false for non-network errors", () => {
    expect(isTransientNetworkError(new Error("something else"))).toBe(false);
  });

  it("returns false for null/undefined", () => {
    expect(isTransientNetworkError(null)).toBe(false);
    expect(isTransientNetworkError(undefined)).toBe(false);
  });
});

describe("classifyError", () => {
  it("classifies abort errors", () => {
    expect(classifyError(new DOMException("Aborted", "AbortError"))).toBe("abort");
  });

  it("classifies fatal errors", () => {
    const err = Object.assign(new Error("oom"), { code: "ERR_OUT_OF_MEMORY" });
    expect(classifyError(err)).toBe("fatal");
  });

  it("classifies config errors", () => {
    const err = Object.assign(new Error("missing key"), { code: "MISSING_API_KEY" });
    expect(classifyError(err)).toBe("config");
  });

  it("classifies transient errors", () => {
    const err = Object.assign(new Error("reset"), { code: "ECONNRESET" });
    expect(classifyError(err)).toBe("transient");
  });

  it("classifies unknown errors", () => {
    expect(classifyError(new Error("mystery"))).toBe("unknown");
  });

  it("prioritizes abort over transient", () => {
    // Abort errors should be classified as abort even if they have network-like properties
    const err = new DOMException("Aborted", "AbortError");
    expect(classifyError(err)).toBe("abort");
  });

  const categories: [string, string, ErrorCategory][] = [
    ["ERR_WORKER_OUT_OF_MEMORY", "fatal worker OOM", "fatal"],
    ["MISSING_CREDENTIALS", "missing creds", "config"],
    ["ENOTFOUND", "DNS lookup", "transient"],
    ["UND_ERR_SOCKET", "undici socket", "transient"],
    ["EHOSTUNREACH", "host unreachable", "transient"],
  ];

  for (const [code, desc, expected] of categories) {
    it(`classifies ${code} (${desc}) as ${expected}`, () => {
      const err = Object.assign(new Error(desc), { code });
      expect(classifyError(err)).toBe(expected);
    });
  }
});
