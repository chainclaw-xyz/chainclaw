/**
 * Converts messages between platform-specific markdown dialects.
 *
 * ChainClaw uses a Telegram-style markdown as the "canonical" format
 * (bold = *text*, italic = _text_, code = `text`).
 * This module converts to the correct format for each platform.
 */

export type Platform = "telegram" | "discord" | "web";

export function formatMessage(text: string, platform: Platform): string {
  switch (platform) {
    case "telegram":
      // Already in Telegram markdown format
      return text;

    case "discord":
      return toDiscordMarkdown(text);

    case "web":
      return toHtml(text);
  }
}

/**
 * Telegram markdown → Discord markdown.
 * Discord uses **bold** instead of *bold*, and _italic_ is the same.
 */
function toDiscordMarkdown(text: string): string {
  // Convert *bold* → **bold** (but not **already bold**)
  return text.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "**$1**");
}

/**
 * Telegram markdown → simple HTML for web chat.
 */
function toHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<strong>$1</strong>")
    .replace(/_(.+?)_/g, "<em>$1</em>")
    .replace(/\n/g, "<br>");
}
