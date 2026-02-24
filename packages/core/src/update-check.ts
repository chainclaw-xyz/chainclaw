import { getLogger } from "./logger.js";

const logger = getLogger("update-check");

const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const GITHUB_API_URL = "https://api.github.com/repos/chainclaw-xyz/chainclaw/releases/latest";

export interface UpdateStatus {
  latest: string | null;
  updateAvailable: boolean;
  lastCheckedAt: number | null;
}

export interface UpdateCheckResult {
  available: boolean;
  latest: string;
  current: string;
}

/**
 * Passively checks for newer ChainClaw releases on GitHub.
 * Does NOT auto-download, auto-pull, or auto-restart anything.
 * Results are exposed via the /health endpoint for the user to act on.
 */
export class UpdateChecker {
  private currentVersion: string;
  private checkIntervalMs: number;
  private initialTimer: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private _status: UpdateStatus = { latest: null, updateAvailable: false, lastCheckedAt: null };

  constructor(opts: { currentVersion: string; checkIntervalMs?: number }) {
    this.currentVersion = opts.currentVersion;
    this.checkIntervalMs = opts.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;
  }

  async checkForUpdate(): Promise<UpdateCheckResult | null> {
    try {
      const response = await fetch(GITHUB_API_URL, {
        headers: { "Accept": "application/vnd.github.v3+json", "User-Agent": "chainclaw-update-check" },
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        logger.debug({ status: response.status }, "GitHub API returned non-OK status");
        return null;
      }

      const data = await response.json() as { tag_name?: string };
      if (!data.tag_name) return null;

      const latest = data.tag_name.replace(/^v/, "");
      const available = compareVersions(latest, this.currentVersion) > 0;

      this._status = { latest, updateAvailable: available, lastCheckedAt: Date.now() };

      if (available) {
        logger.warn({ current: this.currentVersion, latest },
          "A newer version of ChainClaw is available. Run 'docker compose pull && docker compose up -d' to update.");
      }

      return { available, latest, current: this.currentVersion };
    } catch (err) {
      logger.debug({ err }, "Update check failed — will retry later");
      return null;
    }
  }

  start(): void {
    // Initial check after 30s delay (don't slow down startup)
    this.initialTimer = setTimeout(() => {
      this.initialTimer = null;
      void this.checkForUpdate();
    }, 30_000);

    this.interval = setInterval(() => {
      void this.checkForUpdate();
    }, this.checkIntervalMs);

    logger.info({ intervalMs: this.checkIntervalMs }, "Update checker started");
  }

  stop(): void {
    if (this.initialTimer) {
      clearTimeout(this.initialTimer);
      this.initialTimer = null;
    }
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  getStatus(): UpdateStatus {
    return { ...this._status };
  }
}

/**
 * Compare two semver strings. Returns:
 *  > 0 if a > b
 *  < 0 if a < b
 *  0 if equal
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  const len = Math.max(pa.length, pb.length);

  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}
