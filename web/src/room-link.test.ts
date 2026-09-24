import { describe, expect, it } from "vitest";
import {
  createLiberaWebChatUrl,
  createRoomUrl,
  DEFAULT_ROOM_SELECTION,
  normalizeRoomSelection,
  roomSelectionFromUrl,
} from "./room-link";

describe("room links", () => {
  it("defines the project room as the default", () => {
    expect(DEFAULT_ROOM_SELECTION).toEqual({ network: "libera", channel: "#webcomicchat" });
  });

  it("normalizes a channel without its sigil", () => {
    expect(normalizeRoomSelection("libera", " comic-chat ")).toEqual({
      network: "libera",
      channel: "#comic-chat",
    });
  });

  it("rejects unsupported networks and unsafe channels", () => {
    expect(normalizeRoomSelection("attacker", "#chat")).toBeUndefined();
    expect(normalizeRoomSelection("oftc", "#chat room")).toBeUndefined();
    expect(normalizeRoomSelection("oftc", "#chat\nJOIN #other")).toBeUndefined();
  });

  it("reads a valid room while defaulting the network to Libera.Chat", () => {
    const url = new URL("https://webcomicchat.com/?channel=%23comic-chat");
    expect(roomSelectionFromUrl(url)).toEqual({ network: "libera", channel: "#comic-chat" });
  });

  it("does not turn malformed URL parameters into a room", () => {
    expect(roomSelectionFromUrl(new URL("https://webcomicchat.com/?network=elsewhere&channel=%23chat"))).toBeUndefined();
    expect(roomSelectionFromUrl(new URL("https://webcomicchat.com/?network=libera&channel=%23bad%20room"))).toBeUndefined();
  });

  it("creates a same-site link without including a nickname or fragment", () => {
    const current = new URL("https://webcomicchat.com/app?nickname=ComicFan&ref=friend#editor");
    expect(createRoomUrl(current, { network: "oftc", channel: "#comics" })).toBe(
      "https://webcomicchat.com/app?network=oftc&channel=%23comics",
    );
  });

  it("refuses invalid programmatic selections", () => {
    expect(() => createRoomUrl(new URL("https://webcomicchat.com/"), {
      network: "libera",
      channel: "#not valid",
    })).toThrow("invalid IRC room");
  });

  it("creates a Libera web-chat link and safely falls back to the project room", () => {
    expect(createLiberaWebChatUrl("#another-room")).toBe("https://web.libera.chat/#another-room");
    expect(createLiberaWebChatUrl("bad room")).toBe("https://web.libera.chat/#webcomicchat");
  });
});
