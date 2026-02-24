import { configSchema, type Config } from "./config.js";
import { getLogger } from "./logger.js";
import { triggerHook, createHookEvent } from "./hooks.js";

const logger = getLogger("config-manager");

/** Fields safe to change at runtime without a restart. */
const HOT_FIELDS = new Set<keyof Config>([
  "logLevel",
  "securityMode",
  "securityAllowlist",
  "ethRpcUrl",
  "baseRpcUrl",
  "arbitrumRpcUrl",
  "optimismRpcUrl",
  "solanaRpcUrl",
  "dbMaxSizeMb",
  "dbPruneEnabled",
]);

export interface ConfigApplyResult {
  /** Hot fields that were applied immediately. */
  applied: string[];
  /** Cold fields that require a restart to take effect. */
  needsRestart: string[];
}

export interface ConfigDiffEntry {
  key: string;
  from: unknown;
  to: unknown;
}

/**
 * 3-state configuration manager inspired by OctoBot's pattern.
 *
 * - `startup`: Immutable snapshot of the config at boot time.
 * - `current`: The active running config (updated only for hot fields).
 * - `edited`:  Pending changes staged but not yet applied.
 */
export class ConfigurationManager {
  readonly startup: Readonly<Config>;
  private _current: Config;
  private _edited: Partial<Config>;

  constructor(initial: Config) {
    this.startup = Object.freeze({ ...initial });
    this._current = { ...initial };
    this._edited = {};
  }

  get current(): Readonly<Config> {
    return this._current;
  }

  get pendingChanges(): Partial<Config> {
    return { ...this._edited };
  }

  hasPendingChanges(): boolean {
    return Object.keys(this._edited).length > 0;
  }

  /**
   * Stage a config change. Does NOT apply it — call `apply()` to commit.
   * Throws if the key is not a valid config field.
   */
  edit<K extends keyof Config>(key: K, value: Config[K]): void {
    // Validate that the key exists in the schema
    if (!(key in this._current)) {
      throw new Error(`Unknown config key: ${String(key)}`);
    }
    this._edited[key] = value;
    logger.debug({ key, value }, "Config change staged");
  }

  /**
   * Apply all pending edits.
   * Hot fields update immediately. Cold fields are reported as needing restart.
   * Validates the merged config against the Zod schema before applying.
   */
  apply(): ConfigApplyResult {
    if (!this.hasPendingChanges()) {
      return { applied: [], needsRestart: [] };
    }

    // Merge and validate
    const merged = { ...this._current, ...this._edited };
    const result = configSchema.safeParse(merged);
    if (!result.success) {
      const errors = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
      throw new Error(`Invalid config: ${errors}`);
    }

    const applied: string[] = [];
    const needsRestart: string[] = [];
    const changes: Record<string, { from: unknown; to: unknown }> = {};

    for (const [key, value] of Object.entries(this._edited)) {
      const k = key as keyof Config;
      const oldValue = this._current[k];

      if (oldValue === value) continue; // No actual change

      changes[key] = { from: oldValue, to: value };

      if (HOT_FIELDS.has(k)) {
        // Safe to apply at runtime
        (this._current as Record<string, unknown>)[key] = value;
        applied.push(key);
        logger.info({ key, from: oldValue, to: value }, "Config applied (hot)");
      } else {
        needsRestart.push(key);
        logger.info({ key }, "Config change requires restart (cold)");
      }
    }

    // Clear pending edits
    this._edited = {};

    // Trigger lifecycle hook
    if (applied.length > 0 || needsRestart.length > 0) {
      void triggerHook(createHookEvent("lifecycle", "config_changed", { applied, needsRestart, changes }));
    }

    return { applied, needsRestart };
  }

  /**
   * Discard all pending changes.
   */
  discard(): void {
    const count = Object.keys(this._edited).length;
    this._edited = {};
    if (count > 0) {
      logger.info({ discarded: count }, "Pending config changes discarded");
    }
  }

  /**
   * Get diff between startup config and current running config.
   */
  diff(): ConfigDiffEntry[] {
    const diffs: ConfigDiffEntry[] = [];
    for (const key of Object.keys(this.startup) as Array<keyof Config>) {
      const startVal = this.startup[key];
      const currVal = this._current[key];
      if (JSON.stringify(startVal) !== JSON.stringify(currVal)) {
        diffs.push({ key, from: startVal, to: currVal });
      }
    }
    return diffs;
  }

  /**
   * Get a redacted view of the current config (hides secrets).
   */
  getRedactedView(): Record<string, unknown> {
    const SECRET_KEYS = new Set([
      "walletPassword", "anthropicApiKey", "openaiApiKey", "tenderlyApiKey",
      "oneInchApiKey", "coinbaseApiKeySecret", "embeddingApiKey",
      "telegramBotToken", "discordBotToken", "slackBotToken", "slackAppToken",
    ]);

    const view: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(this._current)) {
      view[key] = SECRET_KEYS.has(key) && value ? "***" : value;
    }
    return view;
  }
}
