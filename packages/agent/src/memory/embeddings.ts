/**
 * Embedding provider for semantic memory.
 * Uses OpenAI's text-embedding-3-small by default.
 * Ported from OpenClaw's embedding provider pattern.
 */
import { getLogger } from "@chainclaw/core";

const logger = getLogger("embeddings");

export interface EmbeddingProvider {
  readonly id: string;
  readonly model: string;
  readonly dimensions: number;
  embedQuery(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

/**
 * OpenAI embedding provider using text-embedding-3-small.
 * Dimension: 1536 (default) or configurable.
 */
export class OpenAIEmbeddings implements EmbeddingProvider {
  readonly id = "openai";
  readonly model: string;
  readonly dimensions: number;
  private apiKey: string;

  constructor(apiKey: string, model = "text-embedding-3-small", dimensions = 1536) {
    this.apiKey = apiKey;
    this.model = model;
    this.dimensions = dimensions;
  }

  async embedQuery(text: string): Promise<number[]> {
    const result = await this.embedBatch([text]);
    return result[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        dimensions: this.dimensions,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI embeddings API error: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    // Sort by index to maintain order
    const sorted = data.data.sort((a, b) => a.index - b.index);
    return sorted.map((d) => d.embedding);
  }
}

/**
 * Create an embedding provider from config.
 * Returns null if no embedding API key is configured.
 */
export function createEmbeddingProvider(config: {
  openaiApiKey?: string;
  embeddingModel?: string;
}): EmbeddingProvider | null {
  if (config.openaiApiKey) {
    logger.info({ model: config.embeddingModel ?? "text-embedding-3-small" }, "OpenAI embeddings enabled");
    return new OpenAIEmbeddings(
      config.openaiApiKey,
      config.embeddingModel ?? "text-embedding-3-small",
    );
  }

  logger.debug("No embedding API key configured — semantic memory disabled");
  return null;
}
