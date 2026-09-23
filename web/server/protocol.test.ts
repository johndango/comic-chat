import { describe, expect, it } from "vitest";
import {
  ircCaseFold,
  nicknameFromPrefix,
  parseIrcLine,
  validateChatMessage,
  validateConnectRequest,
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
    expect(() => validateConnectRequest({ type: "connect", network: "internal", nickname: "ComicFan", channel: "#chat" })).toThrow("Unsupported");
    expect(() => validateConnectRequest({ type: "connect", network: "libera", nickname: "bad nick", channel: "#chat" })).toThrow("Nickname");
    expect(() => validateConnectRequest({ type: "connect", network: "libera", nickname: "GoodNick", channel: "not-a-channel" })).toThrow("Channel");
  });

  it("blocks command injection and oversized messages", () => {
    expect(validateChatMessage({ type: "say", message: " hello " })).toBe("hello");
    expect(() => validateChatMessage({ type: "say", message: "hello\r\nJOIN #other" })).toThrow("control");
    expect(() => validateChatMessage({ type: "say", message: "x".repeat(401) })).toThrow("too long");
  });
});
