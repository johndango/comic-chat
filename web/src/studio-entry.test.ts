import { describe, expect, it } from "vitest";
import { studioEntryNeedsDisconnect } from "./studio-entry";

describe("Offline Comic Studio entry", () => {
  it.each(["connecting", "browsing", "joining", "joined"] as const)(
    "requires a disconnect confirmation while %s",
    (state) => expect(studioEntryNeedsDisconnect(state)).toBe(true),
  );

  it.each(["offline", "disconnected"] as const)(
    "opens directly while %s",
    (state) => expect(studioEntryNeedsDisconnect(state)).toBe(false),
  );
});
