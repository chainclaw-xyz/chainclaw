import { getLogger } from "@chainclaw/core";

const logger = getLogger("security");

/**
 * Security mode for the gateway.
 * - "open": anyone can interact (default for self-hosted)
 * - "allowlist": only listed users can interact
 */
export type SecurityMode = "open" | "allowlist";

export type AllowlistMatchSource = "wildcard" | "id" | "name" | "platform-prefixed";

export interface AllowlistMatch {
  allowed: boolean;
  matchKey?: string;
  matchSource?: AllowlistMatchSource;
}

export interface SecurityConfig {
  mode: SecurityMode;
  allowlist: string[];
}

/**
 * Resolve whether a sender is allowed based on the allowlist.
 * Ported from OpenClaw's resolveAllowlistMatchSimple pattern.
 *
 * Supports:
 * - "*" wildcard (match everyone)
 * - Raw user ID match (e.g. "123456789")
 * - Platform-prefixed match (e.g. "telegram:123456789", "discord:alice")
 * - Display name match
 */
export function resolveAllowlistMatch(params: {
  allowlist: string[];
  senderId: string;
  senderName?: string | null;
  platform?: string;
}): AllowlistMatch {
  const entries = params.allowlist
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (entries.length === 0) {
    return { allowed: false };
  }

  if (entries.includes("*")) {
    return { allowed: true, matchKey: "*", matchSource: "wildcard" };
  }

  const senderId = params.senderId.toLowerCase();

  // Direct ID match
  if (entries.includes(senderId)) {
    return { allowed: true, matchKey: senderId, matchSource: "id" };
  }

  // Platform-prefixed match (e.g. "telegram:123456789")
  if (params.platform) {
    const prefixed = `${params.platform.toLowerCase()}:${senderId}`;
    if (entries.includes(prefixed)) {
      return { allowed: true, matchKey: prefixed, matchSource: "platform-prefixed" };
    }
  }

  // Display name match
  const senderName = params.senderName?.toLowerCase();
  if (senderName && entries.includes(senderName)) {
    return { allowed: true, matchKey: senderName, matchSource: "name" };
  }

  return { allowed: false };
}

/**
 * Format an allowlist match result for logging.
 */
export function formatAllowlistMatchMeta(
  match?: { matchKey?: string; matchSource?: string } | null,
): string {
  return `matchKey=${match?.matchKey ?? "none"} matchSource=${match?.matchSource ?? "none"}`;
}

/**
 * Gateway-level security guard.
 * Checks the security mode and allowlist before processing a message.
 */
export class SecurityGuard {
  private config: SecurityConfig;

  constructor(config: SecurityConfig) {
    this.config = config;
  }

  /**
   * Check if a sender is allowed to interact.
   * Returns true if allowed, false if blocked.
   */
  isAllowed(senderId: string, senderName?: string | null, platform?: string): boolean {
    if (this.config.mode === "open") {
      return true;
    }

    const match = resolveAllowlistMatch({
      allowlist: this.config.allowlist,
      senderId,
      senderName,
      platform,
    });

    if (!match.allowed) {
      logger.info(
        { senderId, platform, mode: this.config.mode },
        "Sender blocked by allowlist",
      );
    } else {
      logger.debug(
        { senderId, platform, ...match },
        "Sender allowed",
      );
    }

    return match.allowed;
  }

  getMode(): SecurityMode {
    return this.config.mode;
  }
}
