import { describe, expect, it } from "vitest";
import {
  addRoomBookmark,
  isDefaultRoomBookmark,
  parseRoomBookmarks,
  removeRoomBookmark,
  serializeRoomBookmarks,
} from "./room-bookmarks";

describe("room bookmarks", () => {
  it("always pins Libera.Chat #webcomicchat first", () => {
    const bookmarks = parseRoomBookmarks(null);
    expect(bookmarks).toEqual([{ network: "libera", channel: "#webcomicchat" }]);
    expect(isDefaultRoomBookmark(bookmarks[0])).toBe(true);
    expect(removeRoomBookmark(bookmarks, bookmarks[0])).toEqual(bookmarks);
  });

  it("validates, deduplicates, and round-trips custom rooms", () => {
    let bookmarks = parseRoomBookmarks('[{"network":"libera","channel":"#webcomicchat"},{"network":"nope","channel":"#bad"}]');
    bookmarks = addRoomBookmark(bookmarks, { network: "oftc", channel: "comics" });
    bookmarks = addRoomBookmark(bookmarks, { network: "oftc", channel: "#COMICS" });
    expect(bookmarks).toEqual([
      { network: "libera", channel: "#webcomicchat" },
      { network: "oftc", channel: "#comics" },
    ]);
    expect(parseRoomBookmarks(serializeRoomBookmarks(bookmarks))).toEqual(bookmarks);
  });

  it("removes custom rooms but recovers safely from malformed storage", () => {
    const custom = { network: "libera" as const, channel: "#another-room" };
    const bookmarks = addRoomBookmark(parseRoomBookmarks("not json"), custom);
    expect(removeRoomBookmark(bookmarks, custom)).toEqual([{ network: "libera", channel: "#webcomicchat" }]);
  });
});
