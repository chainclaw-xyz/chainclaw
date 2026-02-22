/**
 * SQLite-backed vector store for semantic memory.
 * Uses in-memory cosine similarity (no sqlite-vec native extension needed).
 */
import type Database from "better-sqlite3";
import { getLogger } from "@chainclaw/core";
import { randomUUID } from "node:crypto";

const logger = getLogger("vector-store");

export interface MemoryChunk {
  id: string;
  userId: string;
  source: string;
  text: string;
  embedding: number[];
  model: string;
  createdAt: number;
}

export interface SearchResult {
  chunk: MemoryChunk;
  score: number;
}

const MIGRATION = `
  CREATE TABLE IF NOT EXISTS memory_chunks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'conversation',
    text TEXT NOT NULL,
    embedding TEXT NOT NULL,
    model TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_memory_chunks_user ON memory_chunks(user_id);
  CREATE INDEX IF NOT EXISTS idx_memory_chunks_source ON memory_chunks(user_id, source);
`;

export class VectorStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.db.exec(MIGRATION);
  }

  /** Store a text chunk with its embedding. */
  insert(params: {
    userId: string;
    source: string;
    text: string;
    embedding: number[];
    model: string;
  }): string {
    const id = randomUUID();
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO memory_chunks (id, user_id, source, text, embedding, model, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      params.userId,
      params.source,
      params.text,
      JSON.stringify(params.embedding),
      params.model,
      now,
    );

    return id;
  }

  /**
   * Search for the top-k most similar chunks for a user.
   * Uses in-memory cosine similarity computation.
   */
  search(userId: string, queryEmbedding: number[], topK = 5): SearchResult[] {
    const rows = this.db.prepare(
      "SELECT id, user_id, source, text, embedding, model, created_at FROM memory_chunks WHERE user_id = ?",
    ).all(userId) as ChunkRow[];

    if (rows.length === 0) return [];

    const scored: SearchResult[] = [];
    for (const row of rows) {
      const embedding = JSON.parse(row.embedding) as number[];
      const score = cosineSimilarity(queryEmbedding, embedding);
      scored.push({
        chunk: {
          id: row.id,
          userId: row.user_id,
          source: row.source,
          text: row.text,
          embedding,
          model: row.model,
          createdAt: row.created_at,
        },
        score,
      });
    }

    // Sort by score descending, take top K
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  /** Count chunks for a user. */
  count(userId: string): number {
    const result = this.db.prepare(
      "SELECT COUNT(*) as count FROM memory_chunks WHERE user_id = ?",
    ).get(userId) as { count: number };
    return result.count;
  }

  /** Delete all chunks for a user. */
  clearUser(userId: string): void {
    this.db.prepare("DELETE FROM memory_chunks WHERE user_id = ?").run(userId);
    logger.info({ userId }, "Cleared memory chunks");
  }

  /** Prune old chunks if user exceeds the limit. */
  prune(userId: string, maxChunks: number): void {
    const count = this.count(userId);
    if (count <= maxChunks) return;

    this.db.prepare(`
      DELETE FROM memory_chunks
      WHERE user_id = ? AND id NOT IN (
        SELECT id FROM memory_chunks
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      )
    `).run(userId, userId, maxChunks);

    logger.debug({ userId, pruned: count - maxChunks }, "Pruned old memory chunks");
  }
}

interface ChunkRow {
  id: string;
  user_id: string;
  source: string;
  text: string;
  embedding: string;
  model: string;
  created_at: number;
}

/** Compute cosine similarity between two vectors. */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dotProduct / denominator;
}
