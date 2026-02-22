import { describe, it, expect } from "vitest";
import { resolveAllowlistMatch, formatAllowlistMatchMeta, SecurityGuard } from "../security.js";

describe("resolveAllowlistMatch", () => {
  it("returns not allowed for empty allowlist", () => {
    const result = resolveAllowlistMatch({ allowlist: [], senderId: "123" });
    expect(result.allowed).toBe(false);
  });

  it("matches wildcard", () => {
    const result = resolveAllowlistMatch({ allowlist: ["*"], senderId: "anyone" });
    expect(result).toEqual({ allowed: true, matchKey: "*", matchSource: "wildcard" });
  });

  it("matches by user ID (case-insensitive)", () => {
    const result = resolveAllowlistMatch({ allowlist: ["ABC123"], senderId: "abc123" });
    expect(result).toEqual({ allowed: true, matchKey: "abc123", matchSource: "id" });
  });

  it("matches by platform-prefixed ID", () => {
    const result = resolveAllowlistMatch({
      allowlist: ["telegram:123456"],
      senderId: "123456",
      platform: "telegram",
    });
    expect(result).toEqual({ allowed: true, matchKey: "telegram:123456", matchSource: "platform-prefixed" });
  });

  it("matches by display name", () => {
    const result = resolveAllowlistMatch({
      allowlist: ["alice"],
      senderId: "999",
      senderName: "Alice",
    });
    expect(result).toEqual({ allowed: true, matchKey: "alice", matchSource: "name" });
  });

  it("returns not allowed when no match", () => {
    const result = resolveAllowlistMatch({
      allowlist: ["bob", "telegram:555"],
      senderId: "123",
      senderName: "Alice",
      platform: "discord",
    });
    expect(result.allowed).toBe(false);
  });

  it("trims and lowercases entries", () => {
    const result = resolveAllowlistMatch({
      allowlist: ["  MyUser  "],
      senderId: "myuser",
    });
    expect(result.allowed).toBe(true);
  });

  it("skips empty entries", () => {
    const result = resolveAllowlistMatch({
      allowlist: ["", "  ", "valid-id"],
      senderId: "valid-id",
    });
    expect(result.allowed).toBe(true);
  });
});

describe("formatAllowlistMatchMeta", () => {
  it("formats a match result", () => {
    expect(formatAllowlistMatchMeta({ matchKey: "alice", matchSource: "name" }))
      .toBe("matchKey=alice matchSource=name");
  });

  it("handles null/undefined", () => {
    expect(formatAllowlistMatchMeta(null)).toBe("matchKey=none matchSource=none");
    expect(formatAllowlistMatchMeta(undefined)).toBe("matchKey=none matchSource=none");
  });
});

describe("SecurityGuard", () => {
  it("allows everyone in open mode", () => {
    const guard = new SecurityGuard({ mode: "open", allowlist: [] });
    expect(guard.isAllowed("anyone")).toBe(true);
    expect(guard.getMode()).toBe("open");
  });

  it("blocks unlisted users in allowlist mode", () => {
    const guard = new SecurityGuard({
      mode: "allowlist",
      allowlist: ["telegram:111", "222"],
    });

    expect(guard.isAllowed("222")).toBe(true);
    expect(guard.isAllowed("111", null, "telegram")).toBe(true);
    expect(guard.isAllowed("333")).toBe(false);
    expect(guard.isAllowed("111", null, "discord")).toBe(false); // wrong platform prefix
  });

  it("supports wildcard in allowlist mode", () => {
    const guard = new SecurityGuard({ mode: "allowlist", allowlist: ["*"] });
    expect(guard.isAllowed("anyone")).toBe(true);
  });
});
