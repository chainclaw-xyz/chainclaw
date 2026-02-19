import { describe, it, expect } from "vitest";
import { formatMessage } from "../formatter.js";

describe("formatMessage", () => {
  it("returns identity for telegram (no transformation)", () => {
    const text = "*bold* _italic_ `code`";
    expect(formatMessage(text, "telegram")).toBe(text);
  });

  it("converts *bold* to **bold** for discord", () => {
    expect(formatMessage("Hello *world*", "discord")).toBe("Hello **world**");
  });

  it("does not double-wrap already bold text for discord", () => {
    expect(formatMessage("**already bold**", "discord")).toBe("**already bold**");
  });

  it("escapes HTML entities for web", () => {
    const result = formatMessage("a & b < c > d", "web");
    expect(result).toContain("&amp;");
    expect(result).toContain("&lt;");
    expect(result).toContain("&gt;");
  });

  it("converts markdown to HTML tags for web", () => {
    const result = formatMessage("*bold* `code` _italic_", "web");
    expect(result).toContain("<strong>bold</strong>");
    expect(result).toContain("<code>code</code>");
    expect(result).toContain("<em>italic</em>");
  });

  it("converts newlines to <br> for web", () => {
    expect(formatMessage("line1\nline2", "web")).toBe("line1<br>line2");
  });

  it("handles empty string", () => {
    expect(formatMessage("", "telegram")).toBe("");
    expect(formatMessage("", "discord")).toBe("");
    expect(formatMessage("", "web")).toBe("");
  });
});
