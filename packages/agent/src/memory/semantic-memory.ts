/**
 * High-level semantic memory for the agent runtime.
 * Stores and retrieves contextually relevant memories using embeddings.
 */
import { getLogger } from "@chainclaw/core";
import type { EmbeddingProvider } from "./embeddings.js";
import { VectorStore } from "./vector-store.js";
import type Database from "better-sqlite3";

const logger = getLogger("semantic-memory");

const MAX_CHUNKS_PER_USER = 500;
const MIN_RELEVANCE_SCORE = 0.3;

export class SemanticMemory {
  private store: VectorStore;
  private embeddings: EmbeddingProvider;

  constructor(db: Database.Database, embeddings: EmbeddingProvider) {
    this.store = new VectorStore(db);
    this.embeddings = embeddings;
  }

  /**
   * Store a message pair (user + assistant) as a memory chunk.
   * The chunk text includes both sides for richer context.
   */
  async remember(
    userId: string,
    text: string,
    source: string = "conversation",
  ): Promise<void> {
    try {
      const embedding = await this.embeddings.embedQuery(text);

      this.store.insert({
        userId,
        source,
        text,
        embedding,
        model: this.embeddings.model,
      });

      // Prune if over limit
      this.store.prune(userId, MAX_CHUNKS_PER_USER);

      logger.debug({ userId, source, textLen: text.length }, "Memory stored");
    } catch (err) {
      logger.warn({ err, userId }, "Failed to store memory — continuing without it");
    }
  }

  /**
   * Recall relevant memories for a query.
   * Returns formatted text snippets suitable for LLM context injection.
   */
  async recall(userId: string, query: string, topK = 3): Promise<string[]> {
    try {
      const queryEmbedding = await this.embeddings.embedQuery(query);
      const results = this.store.search(userId, queryEmbedding, topK);

      return results
        .filter((r) => r.score >= MIN_RELEVANCE_SCORE)
        .map((r) => r.chunk.text);
    } catch (err) {
      logger.warn({ err, userId }, "Failed to recall memories — continuing without them");
      return [];
    }
  }

  /** Clear all memories for a user. */
  clear(userId: string): void {
    this.store.clearUser(userId);
  }

  /** Get the underlying vector store. */
  getStore(): VectorStore {
    return this.store;
  }
}
