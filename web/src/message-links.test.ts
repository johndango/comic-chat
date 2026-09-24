import { describe, expect, it } from "vitest";
import { blockedMessageLink, displayMessageLinks, messageLinks, normalizeBlockedHosts } from "./message-links";

describe("message links", () => {
  it("extracts HTTP(S) and www links without sentence punctuation", () => {
    expect(messageLinks("Try https://Example.com/A?q=Yes, then www.example.org/test."))
      .toEqual([
        expect.objectContaining({ href: "https://example.com/A?q=Yes", label: "https://Example.com/A?q=Yes" }),
        expect.objectContaining({ href: "https://www.example.org/test", label: "www.example.org/test" }),
      ]);
  });

  it("keeps balanced URL punctuation but trims prose punctuation", () => {
    expect(messageLinks("See https://example.com/a_(b)." )[0]?.href).toBe("https://example.com/a_(b)");
  });

  it("ignores non-web schemes and text that only resembles a link", () => {
    expect(messageLinks("javascript:alert(1) example.com ftp://example.com")).toEqual([]);
  });

  it("shortens only the visible label while preserving the complete destination", () => {
    const href = `https://example.com/${"long-path/".repeat(10)}final`;
    const display = displayMessageLinks(`See ${href} please`, 40);
    expect(display.text).toMatch(/^See https:\/\/example\.com\/.*….*final please$/u);
    expect(display.links).toEqual([
      expect.objectContaining({ href, hostname: "example.com", start: 4, end: 44 }),
    ]);
    expect(display.text.slice(display.links[0].start, display.links[0].end)).toHaveLength(40);
  });

  it("blocks tracking, direct-address, local, credential, and configured hosts", () => {
    expect(blockedMessageLink("look https://x.grabify.link/abc")?.reason).toBe("tracking-service");
    expect(blockedMessageLink("look http://127.0.0.1/a")?.reason).toBe("direct-address");
    expect(blockedMessageLink("look http://printer.local/a")?.reason).toBe("local-address");
    expect(blockedMessageLink("look https://user:pass@example.com/a")?.reason).toBe("credentials");
    expect(blockedMessageLink("look https://sub.spam.example/a", ["spam.example"])?.reason).toBe("configured");
    expect(blockedMessageLink("look https://example.com/a")).toBeUndefined();
  });

  it("normalizes only plausible configured hostnames", () => {
    expect([...normalizeBlockedHosts([" Spam.Example. ", "nope", "bad host.example"])]).toEqual(["spam.example"]);
  });
});
