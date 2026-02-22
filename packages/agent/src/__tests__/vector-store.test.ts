import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { VectorStore } from "../memory/vector-store.js";

describe("VectorStore", () => {
  let db: Database.Database;
  let store: VectorStore;

  beforeEach(() => {
    db = new Database(":memory:");
    store = new VectorStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it("inserts and retrieves chunks", () => {
    const embedding = [0.1, 0.2, 0.3, 0.4];
    const id = store.insert({
      userId: "user1",
      source: "conversation",
      text: "I prefer trading on Base chain",
      embedding,
      model: "test-model",
    });

    expect(id).toBeDefined();
    expect(store.count("user1")).toBe(1);
  });

  it("searches by cosine similarity", () => {
    // Insert two chunks with different embeddings
    store.insert({
      userId: "user1",
      source: "conversation",
      text: "I like trading ETH on Base",
      embedding: [1, 0, 0, 0], // Points in x direction
      model: "test",
    });

    store.insert({
      userId: "user1",
      source: "conversation",
      text: "Set up a DCA for USDC weekly",
      embedding: [0, 1, 0, 0], // Points in y direction
      model: "test",
    });

    store.insert({
      userId: "user1",
      source: "conversation",
      text: "My risk tolerance is low",
      embedding: [0.9, 0.1, 0, 0], // Mostly x direction
      model: "test",
    });

    // Query similar to x direction — should match ETH and risk tolerance
    const results = store.search("user1", [1, 0, 0, 0], 2);

    expect(results).toHaveLength(2);
    expect(results[0].chunk.text).toContain("ETH");
    expect(results[0].score).toBeCloseTo(1.0);
    expect(results[1].chunk.text).toContain("risk tolerance");
  });

  it("isolates users", () => {
    store.insert({
      userId: "user1",
      source: "conversation",
      text: "User 1 data",
      embedding: [1, 0, 0],
      model: "test",
    });

    store.insert({
      userId: "user2",
      source: "conversation",
      text: "User 2 data",
      embedding: [1, 0, 0],
      model: "test",
    });

    const results = store.search("user1", [1, 0, 0], 10);
    expect(results).toHaveLength(1);
    expect(results[0].chunk.text).toBe("User 1 data");
  });

  it("clears user data", () => {
    store.insert({
      userId: "user1",
      source: "conversation",
      text: "To be cleared",
      embedding: [1, 0],
      model: "test",
    });

    expect(store.count("user1")).toBe(1);
    store.clearUser("user1");
    expect(store.count("user1")).toBe(0);
  });

  it("prunes old chunks over limit", () => {
    for (let i = 0; i < 5; i++) {
      store.insert({
        userId: "user1",
        source: "conversation",
        text: `Chunk ${i}`,
        embedding: [i, 0],
        model: "test",
      });
    }

    expect(store.count("user1")).toBe(5);
    store.prune("user1", 3);
    expect(store.count("user1")).toBe(3);
  });

  it("returns empty results for unknown user", () => {
    const results = store.search("nobody", [1, 0, 0], 5);
    expect(results).toHaveLength(0);
  });
});
