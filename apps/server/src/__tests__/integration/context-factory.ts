/**
 * TestChannelContext factory.
 * Creates a ChannelContext that captures all sendReply and requestConfirmation calls.
 */
import { vi } from "vitest";
import type { ChannelContext } from "@chainclaw/gateway";

export interface TestChannelContext extends ChannelContext {
  replies: string[];
  confirmationPrompts: string[];
}

export function createTestCtx(overrides?: Partial<ChannelContext>): TestChannelContext {
  const replies: string[] = [];
  const confirmationPrompts: string[] = [];

  return {
    userId: overrides?.userId ?? "test-user",
    channelId: overrides?.channelId ?? "test-channel",
    platform: overrides?.platform ?? "web",
    sendReply: overrides?.sendReply ?? vi.fn(async (text: string) => {
      replies.push(text);
    }),
    requestConfirmation: overrides?.requestConfirmation ?? vi.fn(async (prompt: string) => {
      confirmationPrompts.push(prompt);
      return true;
    }),
    replies,
    confirmationPrompts,
  };
}
