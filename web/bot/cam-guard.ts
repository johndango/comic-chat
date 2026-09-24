// CamBot's hard safety layer. The model is never trusted to behave: whatever
// it writes passes through cleanReply() before it reaches IRC, and whatever
// people write reaches the model only as escaped transcript data.

const MAX_LINE_CHARS = 280;
const MAX_REPLY_LINES = 2;
const MAX_MENTIONS = 2;

/** Strip IRC formatting (bold, colour, etc.) and control characters. */
export function stripIrcFormatting(text: string): string {
  return text
    .replace(/\u0003(\d{1,2}(,\d{1,2})?)?/g, "") // colour codes
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "") // other control characters, incl. CTCP \u0001
    .trim();
}

export interface TranscriptLine {
  nick: string;
  text: string;
}

/**
 * Render room lines as data the model can't mistake for instructions: one
 * JSON object per line, with "<" escaped so nobody can forge the closing tag.
 */
export function formatTranscript(lines: TranscriptLine[]): string {
  const body = lines
    .map((line) => JSON.stringify({ nick: line.nick, text: line.text }).replace(/</g, "\\u003c"))
    .join("\n");
  return `<room_transcript>\n${body}\n</room_transcript>`;
}

export interface CleanOptions {
  /** The only site links the bot may post. */
  allowedLinkPrefix: string;
  /** Nicks currently in the room, for limiting mentions. */
  roomNicks: string[];
}

/**
 * Turn raw model output into at most two safe IRC lines, or null if nothing
 * safe is left. Enforced in code, so a successful prompt injection can at
 * worst make CamBot say something short and link-free.
 */
export function cleanReply(raw: string, options: CleanOptions): string[] | null {
  let text = stripIrcFormatting(raw.replace(/\r?\n+/g, " "));
  // Markdown doesn't render on IRC.
  text = text.replace(/```[\s\S]*?```/g, " ").replace(/[*_`]{1,3}([^*_`]+)[*_`]{1,3}/g, "$1");
  // Links: only the site's own.
  text = text.replace(/\b(?:https?:\/\/|www\.)\S+/gi, (url) => (url.startsWith(options.allowedLinkPrefix) ? url : "[link removed]"));
  // Mentions: no mass-pinging the room.
  let mentions = 0;
  const lower = new Map(options.roomNicks.map((n) => [n.toLowerCase(), n]));
  text = text.replace(/[A-Za-z][A-Za-z0-9_\-[\]\\`^{}|]{1,15}/g, (word) => {
    if (!lower.has(word.toLowerCase())) return word;
    mentions += 1;
    return mentions > MAX_MENTIONS ? "someone" : word;
  });
  text = text.replace(/\s+/g, " ").trim();
  // Never start with something a Comic Chat client or IRC user would treat as a command.
  text = text.replace(/^[#/!.\s]+/, "");
  if (!text) return null;

  const lines: string[] = [];
  let rest = text;
  while (rest && lines.length < MAX_REPLY_LINES) {
    if (rest.length <= MAX_LINE_CHARS) {
      lines.push(rest);
      rest = "";
      break;
    }
    const cut = rest.lastIndexOf(" ", MAX_LINE_CHARS);
    const at = cut > MAX_LINE_CHARS / 2 ? cut : MAX_LINE_CHARS;
    lines.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[.,;:!?]*$/, "")}…`;
  // Belt and braces: no line may look like a Comic Chat data line.
  return lines.map((line) => line.replace(/^[#/]+\s*/, "")).filter(Boolean);
}
