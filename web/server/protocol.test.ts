import { describe, expect, it } from "vitest";
import {
  ircCaseFold,
  nicknameFromPrefix,
  parseIrcLine,
  validateChatMessage,
  validateWhisperMessage,
  validateConnectRequest,
  validateJoinRequest,
} from "./protocol";

describe("IRC protocol boundary", () => {
  it("parses tagged channel messages", () => {
    const message = parseIrcLine("@time=2026-09-22T12:00:00Z :jane!u@example PRIVMSG #comic-chat :Hello there!");
    expect(message.command).toBe("PRIVMSG");
    expect(message.params).toEqual(["#comic-chat"]);
    expect(message.trailing).toBe("Hello there!");
    expect(message.tags.time).toBe("2026-09-22T12:00:00Z");
    expect(nicknameFromPrefix(message.prefix)).toBe("jane");
  });

  it("parses server pings", () => {
    expect(parseIrcLine("PING :irc.example")).toMatchObject({ command: "PING", trailing: "irc.example" });
  });

  it("applies IRC nickname case folding", () => {
    expect(ircCaseFold("Nick{Name|~")).toBe("nick[name\\^");
  });

  it("allows only preset networks and safe identity fields", () => {
    expect(validateConnectRequest({ type: "connect", network: "libera", nickname: "ComicFan", channel: "#comic-chat" })).toMatchObject({ network: "libera" });
    expect(validateConnectRequest({ type: "connect", network: "oftc", nickname: "ComicFan" })).toEqual({ type: "connect", network: "oftc", nickname: "ComicFan" });
    expect(() => validateConnectRequest({ type: "connect", network: "internal", nickname: "ComicFan", channel: "#chat" })).toThrow("Unsupported");
    expect(() => validateConnectRequest({ type: "connect", network: "libera", nickname: "bad nick", channel: "#chat" })).toThrow("Nickname");
    expect(() => validateConnectRequest({ type: "connect", network: "libera", nickname: "GoodNick", channel: "not-a-channel" })).toThrow("Channel");
  });

  it("validates room joins independently from registration", () => {
    expect(validateJoinRequest({ type: "join", channel: "#comic-chat" })).toBe("#comic-chat");
    expect(() => validateJoinRequest({ type: "join", channel: "bad room" })).toThrow("Channel");
  });

  it("blocks command injection and oversized messages", () => {
    expect(validateChatMessage({ type: "say", message: " hello " })).toEqual({ message: "hello", action: false });
    expect(validateChatMessage({ type: "say", message: "waves", action: true })).toEqual({ message: "waves", action: true });
    expect(() => validateChatMessage({ type: "say", message: "hello", action: "yes" })).toThrow("action");
    expect(() => validateChatMessage({ type: "say", message: "hello\r\nJOIN #other" })).toThrow("control");
    expect(() => validateChatMessage({ type: "say", message: "x".repeat(401) })).toThrow("too long");
  });

  it("validates whispers: an IRC-safe nickname and the usual message rules", () => {
    expect(validateWhisperMessage({ type: "whisper", to: "Dan", message: " psst " })).toEqual({ to: ["Dan"], message: "psst", action: false });
    expect(validateWhisperMessage({ type: "whisper", to: ["Dan", "dan", "Eve"], message: "group" })).toEqual({ to: ["Dan", "Eve"], message: "group", action: false });
    expect(() => validateWhisperMessage({ type: "whisper", to: "#comics", message: "hi" })).toThrow("room member");
    expect(() => validateWhisperMessage({ type: "whisper", to: ["A", "B", "C", "D", "E", "F"], message: "hi" })).toThrow("one to five");
    expect(() => validateWhisperMessage({ type: "whisper", to: "Dan", message: "hi\r\nQUIT" })).toThrow("control");
    expect(() => validateWhisperMessage({ type: "whisper", message: "hi" })).toThrow("room member");
  });
});
