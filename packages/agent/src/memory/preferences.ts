import type Database from "better-sqlite3";

export interface UserPreferences {
  userId: string;
  defaultChainId: number;
  slippageTolerance: number;
  confirmationThreshold: number;
  maxTxPerDay: number;
}

const DEFAULTS: Omit<UserPreferences, "userId"> = {
  defaultChainId: 1,
  slippageTolerance: 1.0,
  confirmationThreshold: 100.0,
  maxTxPerDay: 50,
};

export class PreferencesStore {
  private getStmt: Database.Statement;
  private upsertStmt: Database.Statement;

  constructor(db: Database.Database) {
    this.getStmt = db.prepare(
      `SELECT user_id as userId, default_chain_id as defaultChainId,
              slippage_tolerance as slippageTolerance,
              confirmation_threshold as confirmationThreshold,
              max_tx_per_day as maxTxPerDay
       FROM user_preferences WHERE user_id = ?`,
    );
    this.upsertStmt = db.prepare(
      `INSERT INTO user_preferences (user_id, default_chain_id, slippage_tolerance, confirmation_threshold, max_tx_per_day, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         default_chain_id = excluded.default_chain_id,
         slippage_tolerance = excluded.slippage_tolerance,
         confirmation_threshold = excluded.confirmation_threshold,
         max_tx_per_day = excluded.max_tx_per_day,
         updated_at = datetime('now')`,
    );
  }

  get(userId: string): UserPreferences {
    const row = this.getStmt.get(userId) as UserPreferences | undefined;
    return row ?? { userId, ...DEFAULTS };
  }

  set(userId: string, prefs: Partial<Omit<UserPreferences, "userId">>): UserPreferences {
    const current = this.get(userId);
    const updated = { ...current, ...prefs };

    this.upsertStmt.run(
      userId,
      updated.defaultChainId,
      updated.slippageTolerance,
      updated.confirmationThreshold,
      updated.maxTxPerDay,
    );

    return updated;
  }
}
