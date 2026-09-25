// IRC-style commands typed in the message box. Comic Chat regulars and IRC
// users reach for "/me waves" out of habit; without this the line went to the
// room as literal text.

import type { BalloonMode } from "./layout/balloon";

export type SlashCommand =
  | { kind: "line"; mode: BalloonMode; text: string }
  | { kind: "whisper"; to: string[]; text: string }
  | { kind: "join"; channel: string }
  | { kind: "clear" }
  | { kind: "quit" }
  | { kind: "help" }
  | { kind: "error"; message: string };

export const SLASH_HELP =
  "Commands: /me waves · /think hmm · /say hi · /whisper Anna psst (or /msg) · /join #room · /clear · /quit. Start with // to send a line that begins with /.";

const CHANNEL = /^[#&][^\s,\u0007]{1,49}$/u;

/** Parse a message-box line. Returns null for an ordinary line. */
export function parseSlashCommand(input: string): SlashCommand | null {
  const line = input.trim();
  if (!line.startsWith("/")) return null;
  // IRC convention: "//" sends the rest literally, "/" included.
  if (line.startsWith("//")) return { kind: "line", mode: "say", text: line.slice(1) };
  const match = line.match(/^\/(\S+)\s*([\s\S]*)$/u);
  if (!match) return { kind: "help" };
  const name = match[1].toLowerCase();
  const rest = match[2].trim();
  const needsText = (mode: BalloonMode, usage: string): SlashCommand =>
    rest ? { kind: "line", mode, text: rest } : { kind: "error", message: `Usage: ${usage}` };
  switch (name) {
    case "me":
    case "action":
      return needsText("action", "/me waves hello");
    case "think":
      return needsText("think", "/think what a strange room");
    case "say":
      return needsText("say", "/say hello");
    case "whisper":
    case "msg":
    case "w":
    case "tell": {
      const whisper = rest.match(/^(\S+)\s+([\s\S]+)$/u);
      if (!whisper) return { kind: "error", message: "Usage: /whisper Anna psst (several people: /whisper Anna,Dan psst)" };
      const to = [...new Set(whisper[1].split(",").map((name) => name.trim()).filter(Boolean))];
      if (to.some((nick) => /^[#&]/u.test(nick))) return { kind: "error", message: "Whispers go to people, not rooms. Just type your line to talk to the room." };
      if (to.length > 5) return { kind: "error", message: "Choose no more than five people for one whisper" };
      return { kind: "whisper", to, text: whisper[2].trim() };
    }
    case "join":
    case "j": {
      const channel = rest.split(/\s+/u)[0] ?? "";
      const normalized = channel && !/^[#&]/u.test(channel) ? `#${channel}` : channel;
      return CHANNEL.test(normalized) ? { kind: "join", channel: normalized } : { kind: "error", message: "Usage: /join #webcomicchat" };
    }
    case "clear":
    case "cls":
      return { kind: "clear" };
    case "quit":
    case "part":
    case "leave":
    case "disconnect":
      return { kind: "quit" };
    case "help":
    case "?":
    case "commands":
      return { kind: "help" };
    default:
      return { kind: "error", message: `/${match[1]} isn't a command here. ${SLASH_HELP}` };
  }
}
