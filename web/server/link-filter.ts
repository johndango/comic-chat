import {
  blockedMessageLink,
  messageLinks,
  normalizeBlockedHosts,
  type BlockedMessageLink,
} from "../src/message-links";

const DEFAULT_OPENPHISH_FEED = "https://raw.githubusercontent.com/openphish/public_feed/refs/heads/main/feed.txt";
const MAX_FEED_BYTES = 2 * 1024 * 1024;

export interface UnsafeMessageLink {
  hostname: string;
  source: "built-in" | "openphish";
}

function canonicalUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.hash = "";
    return url.href;
  } catch {
    return undefined;
  }
}

/**
 * A fail-open phishing feed layered over the deterministic built-in rules.
 * Feed failure never prevents the gateway from starting or ordinary chat from
 * working. The exact-URL match avoids blocking an entire compromised host.
 */
export class MessageLinkFilter {
  private openPhishUrls = new Set<string>();
  private refreshTimer?: NodeJS.Timeout;
  private readonly configuredHosts: Set<string>;

  constructor(
    blockedHosts = process.env.BLOCKED_LINK_HOSTS ?? "",
    private readonly feedUrl = process.env.OPENPHISH_FEED_URL ?? DEFAULT_OPENPHISH_FEED,
  ) {
    this.configuredHosts = normalizeBlockedHosts(blockedHosts.split(","));
  }

  check(text: string): UnsafeMessageLink | undefined {
    const builtIn: BlockedMessageLink | undefined = blockedMessageLink(text, this.configuredHosts);
    if (builtIn) return { hostname: builtIn.hostname, source: "built-in" };
    for (const link of messageLinks(text)) {
      const canonical = canonicalUrl(link.href);
      if (canonical && this.openPhishUrls.has(canonical)) return { hostname: link.hostname, source: "openphish" };
    }
    return undefined;
  }

  loadOpenPhishText(text: string): number {
    const next = new Set<string>();
    for (const line of text.split(/\r?\n/gu)) {
      const canonical = canonicalUrl(line.trim());
      if (canonical) next.add(canonical);
    }
    this.openPhishUrls = next;
    return next.size;
  }

  async refresh(): Promise<number> {
    const response = await fetch(this.feedUrl, {
      headers: { "user-agent": "WebComicChat/0.14 link safety" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`OpenPhish feed returned ${response.status}`);
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > MAX_FEED_BYTES) throw new Error("OpenPhish feed is unexpectedly large");
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_FEED_BYTES) throw new Error("OpenPhish feed is unexpectedly large");
    return this.loadOpenPhishText(text);
  }

  start(): void {
    if (process.env.NODE_ENV === "test" || process.env.OPENPHISH_FEED_ENABLED === "0") return;
    const refresh = () => void this.refresh().catch((error) => {
      console.warn("OpenPhish link feed refresh failed; keeping the last good list:", error instanceof Error ? error.message : error);
    });
    refresh();
    this.refreshTimer = setInterval(refresh, 12 * 60 * 60_000);
    this.refreshTimer.unref();
  }

  close(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = undefined;
  }
}
