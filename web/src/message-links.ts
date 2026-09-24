/** A web link found in visible chat text. Offsets use JavaScript string indexes. */
export interface MessageLink {
  href: string;
  label: string;
  hostname: string;
  start: number;
  end: number;
}

export interface BlockedMessageLink extends MessageLink {
  reason: "credentials" | "direct-address" | "local-address" | "tracking-service" | "configured";
}

export interface DisplayMessage {
  text: string;
  links: MessageLink[];
}

// These services are specifically built to conceal a destination while logging
// the visitor's address. We deliberately do not block ordinary shorteners such
// as bit.ly or tinyurl.com: doing that would reject too many legitimate links.
export const TRACKING_LINK_HOSTS = new Set([
  "2no.co",
  "ed.tc",
  "grabify.link",
  "ipgrabber.ru",
  "ipgraber.ru",
  "iplogger.co",
  "iplogger.com",
  "iplogger.info",
  "iplogger.org",
  "iplogger.ru",
  "maper.info",
  "mapper.info",
  "wl.gl",
  "yip.su",
]);

const LINK_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/giu;
const TRAILING_PUNCTUATION = /[.,!?;:]+$/u;
const LOCAL_SUFFIXES = [".home", ".internal", ".lan", ".local", ".localhost"];

function trimLinkEnd(candidate: string): string {
  let value = candidate.replace(TRAILING_PUNCTUATION, "");
  const pairs: Array<[string, string]> = [["(", ")"], ["[", "]"], ["{", "}"]];
  for (const [open, close] of pairs) {
    while (value.endsWith(close) && value.split(close).length > value.split(open).length) value = value.slice(0, -1);
  }
  return value;
}

function isDirectAddress(hostname: string): boolean {
  if (hostname.startsWith("[") && hostname.endsWith("]")) return true;
  const pieces = hostname.split(".");
  return pieces.length === 4 && pieces.every((piece) => /^\d{1,3}$/u.test(piece) && Number(piece) <= 255);
}

function hostMatches(hostname: string, blockedHost: string): boolean {
  return hostname === blockedHost || hostname.endsWith(`.${blockedHost}`);
}

export function normalizeBlockedHosts(hosts: Iterable<string>): Set<string> {
  const normalized = new Set<string>();
  for (const host of hosts) {
    const value = host.trim().toLocaleLowerCase().replace(/^\.+|\.+$/gu, "");
    if (/^[a-z0-9.-]+$/u.test(value) && value.includes(".")) normalized.add(value);
  }
  return normalized;
}

/** Extract only HTTP(S) links. `www.` links are opened through HTTPS. */
export function messageLinks(text: string): MessageLink[] {
  const links: MessageLink[] = [];
  for (const match of text.matchAll(LINK_PATTERN)) {
    const label = trimLinkEnd(match[0]);
    if (!label) continue;
    try {
      const parsed = new URL(/^www\./iu.test(label) ? `https://${label}` : label);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
      links.push({
        href: parsed.href,
        label,
        hostname: parsed.hostname.toLocaleLowerCase(),
        start: match.index,
        end: match.index + label.length,
      });
    } catch {
      // Text that only resembles a URL remains ordinary balloon text.
    }
  }
  return links;
}

function shortenedLinkLabel(label: string, maximum: number): string {
  if (label.length <= maximum) return label;
  const tailLength = Math.min(12, Math.floor((maximum - 1) / 3));
  return `${label.slice(0, maximum - tailLength - 1)}…${label.slice(-tailLength)}`;
}

/**
 * Prepare public chat for a balloon without changing where links lead. Long
 * visible URLs use a middle ellipsis; the returned href remains complete.
 */
export function displayMessageLinks(text: string, maximumLinkLength = 52, maximumMessageLength = 180): DisplayMessage {
  let visible = "";
  let cursor = 0;
  const links: MessageLink[] = [];
  for (const link of messageLinks(text)) {
    visible += text.slice(cursor, link.start);
    const label = shortenedLinkLabel(link.label, maximumLinkLength);
    const start = visible.length;
    visible += label;
    links.push({ ...link, label, start, end: visible.length });
    cursor = link.end;
  }
  visible += text.slice(cursor);
  if (visible.length <= maximumMessageLength) return { text: visible, links };

  const cutoff = maximumMessageLength - 1;
  return {
    text: `${visible.slice(0, cutoff)}…`,
    links: links
      .filter((link) => link.start < cutoff)
      .map((link) => ({ ...link, end: Math.min(link.end, cutoff) }))
      .filter((link) => link.start < link.end),
  };
}

export function blockedMessageLink(text: string, additionalHosts: Iterable<string> = []): BlockedMessageLink | undefined {
  const configured = normalizeBlockedHosts(additionalHosts);
  for (const link of messageLinks(text)) {
    let reason: BlockedMessageLink["reason"] | undefined;
    const parsed = new URL(link.href);
    if (parsed.username || parsed.password) reason = "credentials";
    else if (isDirectAddress(link.hostname)) reason = "direct-address";
    else if (link.hostname === "localhost" || LOCAL_SUFFIXES.some((suffix) => link.hostname.endsWith(suffix))) reason = "local-address";
    else if ([...TRACKING_LINK_HOSTS].some((host) => hostMatches(link.hostname, host))) reason = "tracking-service";
    else if ([...configured].some((host) => hostMatches(link.hostname, host))) reason = "configured";
    if (reason) return { ...link, reason };
  }
  return undefined;
}

export function blockedLinkMessage(link: Pick<BlockedMessageLink, "hostname">): string {
  return `That message was blocked because it contains an unsafe link to ${link.hostname}.`;
}
