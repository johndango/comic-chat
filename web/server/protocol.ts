export const IRC_NETWORKS = {
  libera: { id: "libera", label: "Libera.Chat", host: "irc.libera.chat", port: 6697 },
  oftc: { id: "oftc", label: "OFTC", host: "irc.oftc.net", port: 6697 },
} as const;

export type NetworkId = keyof typeof IRC_NETWORKS;

export interface ConnectRequest {
  type: "connect";
  network: NetworkId;
  nickname: string;
  channel?: string;
}

export interface IrcMessage {
  tags: Record<string, string | true>;
  prefix?: string;
  command: string;
  params: string[];
  trailing?: string;
}

const nicknamePattern = /^[A-Za-z][A-Za-z0-9_\-[\]\\`^{}]{0,15}$/;
const channelPattern = /^#[A-Za-z0-9_+\-]{1,50}$/;

export function validateConnectRequest(value: unknown): ConnectRequest {
  if (!value || typeof value !== "object") throw new Error("Invalid connection request");
  const candidate = value as Record<string, unknown>;
  if (candidate.type !== "connect") throw new Error("Invalid connection request");
  if (typeof candidate.network !== "string" || !(candidate.network in IRC_NETWORKS)) {
    throw new Error("Unsupported IRC network");
  }
  if (typeof candidate.nickname !== "string" || !nicknamePattern.test(candidate.nickname)) {
    throw new Error("Nickname must start with a letter and use 1–16 IRC-safe characters");
  }
  if (candidate.channel !== undefined && (typeof candidate.channel !== "string" || !channelPattern.test(candidate.channel))) {
    throw new Error("Channel must start with # and use IRC-safe characters");
  }
  return {
    type: "connect",
    network: candidate.network as NetworkId,
    nickname: candidate.nickname,
    ...(typeof candidate.channel === "string" ? { channel: candidate.channel } : {}),
  };
}

export function validateJoinRequest(value: unknown): string {
  if (!value || typeof value !== "object") throw new Error("Invalid room request");
  const candidate = value as Record<string, unknown>;
  if (candidate.type !== "join" || typeof candidate.channel !== "string" || !channelPattern.test(candidate.channel)) {
    throw new Error("Channel must start with # and use IRC-safe characters");
  }
  return candidate.channel;
}

export function validateChatMessage(value: unknown): { message: string; action: boolean } {
  if (!value || typeof value !== "object") throw new Error("Invalid chat message");
  const candidate = value as Record<string, unknown>;
  if (candidate.type !== "say" || typeof candidate.message !== "string") {
    throw new Error("Invalid chat message");
  }
  return messageBody(candidate);
}

/**
 * A whisper is a private message to one member of the room, as Comic Chat
 * sent them: `PRIVMSG <nick> :text`. The recipient draws it in the comic of
 * the room they share with the sender.
 */
export function validateWhisperMessage(value: unknown): { to: string[]; message: string; action: boolean } {
  if (!value || typeof value !== "object") throw new Error("Invalid whisper");
  const candidate = value as Record<string, unknown>;
  if (candidate.type !== "whisper" || typeof candidate.message !== "string") throw new Error("Invalid whisper");
  const requested = typeof candidate.to === "string" ? [candidate.to] : candidate.to;
  if (!Array.isArray(requested) || requested.length < 1 || requested.length > 5) {
    throw new Error("Choose one to five room members to whisper to");
  }
  const recipients: string[] = [];
  const seen = new Set<string>();
  for (const recipient of requested) {
    if (typeof recipient !== "string" || !nicknamePattern.test(recipient)) {
      throw new Error("Choose one to five room members to whisper to");
    }
    const folded = ircCaseFold(recipient);
    if (!seen.has(folded)) {
      seen.add(folded);
      recipients.push(recipient);
    }
  }
  return { to: recipients, ...messageBody(candidate) };
}

function messageBody(candidate: Record<string, unknown>): { message: string; action: boolean } {
  const message = String(candidate.message).trim();
  if (!message) throw new Error("Message cannot be empty");
  if (/[\r\n\0]/.test(message)) throw new Error("Message contains invalid control characters");
  if (Buffer.byteLength(message, "utf8") > 400) throw new Error("Message is too long for IRC");
  if (candidate.action !== undefined && typeof candidate.action !== "boolean") {
    throw new Error("Invalid action flag");
  }
  return { message, action: candidate.action === true };
}

function decodeTag(value: string): string {
  return value.replace(/\\([:\\rn])/g, (_, character: string) => {
    if (character === ":") return ";";
    if (character === "r") return "\r";
    if (character === "n") return "\n";
    return character;
  });
}

export function parseIrcLine(input: string): IrcMessage {
  let line = input.replace(/[\r\n]+$/, "");
  const tags: Record<string, string | true> = {};
  if (line.startsWith("@")) {
    const separator = line.indexOf(" ");
    if (separator < 0) throw new Error("Malformed IRC message tags");
    for (const entry of line.slice(1, separator).split(";")) {
      const [key, rawValue] = entry.split("=", 2);
      tags[key] = rawValue === undefined ? true : decodeTag(rawValue);
    }
    line = line.slice(separator + 1);
  }

  let prefix: string | undefined;
  if (line.startsWith(":")) {
    const separator = line.indexOf(" ");
    if (separator < 0) throw new Error("Malformed IRC prefix");
    prefix = line.slice(1, separator);
    line = line.slice(separator + 1);
  }

  let trailing: string | undefined;
  const trailingIndex = line.indexOf(" :");
  if (trailingIndex >= 0) {
    trailing = line.slice(trailingIndex + 2);
    line = line.slice(0, trailingIndex);
  } else if (line.startsWith(":")) {
    trailing = line.slice(1);
    line = "";
  }

  const tokens = line.trim().split(/ +/).filter(Boolean);
  const command = tokens.shift()?.toUpperCase();
  if (!command) throw new Error("IRC message has no command");
  return { tags, prefix, command, params: tokens, trailing };
}

export function nicknameFromPrefix(prefix = ""): string {
  return prefix.split("!", 1)[0];
}

export function ircCaseFold(value: string): string {
  return value.toLowerCase().replace(/[{}|~]/g, (character) => ({
    "{": "[",
    "}": "]",
    "|": "\\",
    "~": "^",
  })[character] ?? character);
}
