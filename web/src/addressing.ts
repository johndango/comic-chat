// Directed chat over plain IRC. Comic Chat turned your character toward the
// people you picked; on IRC the universal way to say who a line is for is a
// "Name:" prefix. We send that prefix, and when drawing a line we take it back
// off the balloon and use it to aim the speaker instead.

/** Prefix a line with the people it's for ("Anna, Dan: hi"), unless it already names them. */
export function addressedText(message: string, to: readonly string[]): string {
  if (to.length === 0) return message;
  const already = parseAddressing(message, to);
  if (already.to.length > 0) return message;
  return `${to.join(", ")}: ${message}`;
}

/**
 * Split "Anna, Dan: hello" into the people addressed and the words said. Only
 * names of people actually in the room count, so "Note: lunch at 12" stays as
 * it is.
 */
export function parseAddressing(text: string, members: Iterable<string>): { to: string[]; text: string } {
  // "Anna, Dan: hi" (a list needs the colon) or "Anna, hi" (one name, comma).
  const match = text.match(/^\s*@?([^:]{1,120}?)\s*:\s+(\S[\s\S]*)$/u) ?? text.match(/^\s*@?([^\s,:]{1,32}),\s+(\S[\s\S]*)$/u);
  if (!match) return { to: [], text };
  const byName = new Map([...members].map((name) => [name.toLocaleLowerCase(), name]));
  const names = match[1].split(/\s*,\s*|\s+and\s+/u).map((name) => name.replace(/^@/, ""));
  const to = names.map((name) => byName.get(name.toLocaleLowerCase()));
  if (to.length === 0 || to.some((name) => name === undefined)) return { to: [], text };
  return { to: [...new Set(to as string[])], text: match[2] };
}

/**
 * AI bots on Libera.Chat must mark their lines, which they do with a leading
 * "[AI]". The marker stays on IRC; the comic draws the balloon without it.
 * Only nicknames that present as bots are unmarked.
 */
export function withoutAiMarker(nickname: string, text: string): string {
  return /bot[_\d]*$/iu.test(nickname) ? text.replace(/^\[AI\]\s+/u, "") : text;
}
