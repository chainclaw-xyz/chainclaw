/**
 * Converts messages between platform-specific markdown dialects.
 *
 * ChainClaw uses a Telegram-style markdown as the "canonical" format
 * (bold = *text*, italic = _text_, code = `text`).
 * This module converts to the correct format for each platform.
 */

export type Platform = string;

export function formatMessage(text: string, platform: Platform): string {
  switch (platform) {
    case "telegram":
      // Already in Telegram markdown format
      return text;

    case "discord":
      return toDiscordMarkdown(text);

    case "slack":
      return toSlackMrkdwn(text);

    case "whatsapp":
      // WhatsApp uses same bold/italic as Telegram (*bold*, _italic_)
      return text;

    case "web":
      return toHtml(text);

    default:
      // Unknown platforms get plain text (strip markdown)
      return text;
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
 * Telegram markdown → Slack mrkdwn.
 * Slack uses *bold* (same), _italic_ (same), `code` (same), but links are <url|text>.
 */
function toSlackMrkdwn(text: string): string {
  // Telegram and Slack use the same basic markdown. Main difference is links,
  // but ChainClaw doesn't generate links in responses, so pass through.
  return text;
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
