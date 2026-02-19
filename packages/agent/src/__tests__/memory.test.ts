import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { ConversationMemory } from "../memory/conversation.js";
import { PreferencesStore } from "../memory/preferences.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(user_id, created_at);

    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id TEXT PRIMARY KEY,
      default_chain_id INTEGER DEFAULT 1,
      slippage_tolerance REAL DEFAULT 1.0,
      confirmation_threshold REAL DEFAULT 100.0,
      max_tx_per_day INTEGER DEFAULT 50,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

describe("ConversationMemory", () => {
  let db: Database.Database;
  let memory: ConversationMemory;

  beforeEach(() => {
    db = createTestDb();
    memory = new ConversationMemory(db);
  });

  afterEach(() => {
    db.close();
  });

  it("starts with empty history", () => {
    expect(memory.getHistory("user1")).toHaveLength(0);
  });

  it("stores and retrieves messages", () => {
    memory.addMessage("user1", "user", "Hello");
    memory.addMessage("user1", "assistant", "Hi there!");

    const history = memory.getHistory("user1");
    expect(history).toHaveLength(2);
    expect(history[0].content).toBe("Hello");
    expect(history[0].role).toBe("user");
    expect(history[1].content).toBe("Hi there!");
    expect(history[1].role).toBe("assistant");
  });

  it("keeps messages separated by user", () => {
    memory.addMessage("user1", "user", "Hello from user1");
    memory.addMessage("user2", "user", "Hello from user2");

    expect(memory.getHistory("user1")).toHaveLength(1);
    expect(memory.getHistory("user2")).toHaveLength(1);
    expect(memory.getHistory("user1")[0].content).toBe("Hello from user1");
  });

  it("limits history retrieval", () => {
    for (let i = 0; i < 10; i++) {
      memory.addMessage("user1", "user", `Message ${i}`);
    }

    const history = memory.getHistory("user1", 5);
    expect(history).toHaveLength(5);
    // Should get the most recent 5, returned oldest first
    expect(history[0].content).toBe("Message 5");
    expect(history[4].content).toBe("Message 9");
  });

  it("formats messages for LLM", () => {
    memory.addMessage("user1", "user", "Check my balance");
    memory.addMessage("user1", "assistant", "Your balance is 1.5 ETH");

    const messages = memory.getMessagesForLLM("user1");
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ role: "user", content: "Check my balance" });
    expect(messages[1]).toEqual({ role: "assistant", content: "Your balance is 1.5 ETH" });
  });

  it("clears history for a user", () => {
    memory.addMessage("user1", "user", "Hello");
    memory.addMessage("user1", "assistant", "Hi");
    memory.addMessage("user2", "user", "Other user");

    memory.clear("user1");

    expect(memory.getHistory("user1")).toHaveLength(0);
    expect(memory.getHistory("user2")).toHaveLength(1);
  });
});

describe("PreferencesStore", () => {
  let db: Database.Database;
  let store: PreferencesStore;

  beforeEach(() => {
    db = createTestDb();
    store = new PreferencesStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it("returns defaults for unknown user", () => {
    const prefs = store.get("newuser");
    expect(prefs.userId).toBe("newuser");
    expect(prefs.defaultChainId).toBe(1);
    expect(prefs.slippageTolerance).toBe(1.0);
    expect(prefs.confirmationThreshold).toBe(100.0);
    expect(prefs.maxTxPerDay).toBe(50);
  });

  it("saves and retrieves preferences", () => {
    store.set("user1", { defaultChainId: 8453, slippageTolerance: 0.5 });

    const prefs = store.get("user1");
    expect(prefs.defaultChainId).toBe(8453);
    expect(prefs.slippageTolerance).toBe(0.5);
    // Defaults preserved for unset fields
    expect(prefs.confirmationThreshold).toBe(100.0);
  });

  it("updates existing preferences", () => {
    store.set("user1", { defaultChainId: 8453 });
    store.set("user1", { slippageTolerance: 2.0 });

    const prefs = store.get("user1");
    expect(prefs.defaultChainId).toBe(8453);
    expect(prefs.slippageTolerance).toBe(2.0);
  });

  it("keeps preferences separated by user", () => {
    store.set("user1", { defaultChainId: 1 });
    store.set("user2", { defaultChainId: 8453 });

    expect(store.get("user1").defaultChainId).toBe(1);
    expect(store.get("user2").defaultChainId).toBe(8453);
  });
});
