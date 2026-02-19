import type Database from "better-sqlite3";
import { getLogger } from "@chainclaw/core";
import type { LLMMessage } from "../llm/types.js";

const logger = getLogger("memory");

const MAX_HISTORY = 50;

export interface ConversationEntry {
  id: number;
  userId: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

export class ConversationMemory {
  private db: Database.Database;

  private insertStmt: Database.Statement;
  private selectStmt: Database.Statement;
  private countStmt: Database.Statement;
  private pruneStmt: Database.Statement;

  constructor(db: Database.Database) {
    this.db = db;

    this.insertStmt = db.prepare(
      "INSERT INTO conversations (user_id, role, content) VALUES (?, ?, ?)",
    );
    this.selectStmt = db.prepare(
      `SELECT id, user_id as userId, role, content, created_at as createdAt
       FROM conversations
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    );
    this.countStmt = db.prepare(
      "SELECT COUNT(*) as count FROM conversations WHERE user_id = ?",
    );
    this.pruneStmt = db.prepare(
      `DELETE FROM conversations
       WHERE user_id = ? AND id NOT IN (
         SELECT id FROM conversations
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT ?
       )`,
    );
  }

  addMessage(userId: string, role: "user" | "assistant", content: string): void {
    this.insertStmt.run(userId, role, content);

    // Prune old messages if over limit
    const result = this.countStmt.get(userId) as { count: number };
    if (result.count > MAX_HISTORY) {
      this.pruneStmt.run(userId, userId, MAX_HISTORY);
      logger.debug({ userId, pruned: result.count - MAX_HISTORY }, "Pruned old messages");
    }
  }

  getHistory(userId: string, limit: number = 20): ConversationEntry[] {
    const rows = this.selectStmt.all(userId, limit) as ConversationEntry[];
    return rows.reverse(); // oldest first
  }

  getMessagesForLLM(userId: string, limit: number = 20): LLMMessage[] {
    return this.getHistory(userId, limit).map((entry) => ({
      role: entry.role,
      content: entry.content,
    }));
  }

  clear(userId: string): void {
    this.db.prepare("DELETE FROM conversations WHERE user_id = ?").run(userId);
    logger.info({ userId }, "Conversation history cleared");
  }
}
