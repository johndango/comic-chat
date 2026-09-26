import { describe, expect, it } from "vitest";
import { titleWithCount } from "./attention";
import {
  loadNotifySettings,
  notificationsSleeping,
  NotifyPolicy,
  parseWatchList,
  saveNotifySettings,
  type NotifySettings,
} from "./notifications";

const T0 = 1_800_000_000_000;
const MINUTE = 60_000;
const base = { myNick: "johndango", self: false, channel: "#webcomicchat", hidden: true };
const policy = (settings: Partial<NotifySettings> = {}) => new NotifyPolicy({
  mode: "wake",
  sound: false,
  watch: [],
  sleepUntil: 0,
  ...settings,
});

describe("room wake-up alerts", () => {
  it("alerts once when a quiet room wakes, not for every line", () => {
    const notifications = policy();
    expect(notifications.message({ ...base, nick: "Anna", text: "anyone here?", at: T0 }))
      .toMatchObject({ kind: "wake", title: "Someone's talking in #webcomicchat" });
    expect(notifications.message({ ...base, nick: "Dan", text: "hi", at: T0 + 20_000 })).toBeNull();
    expect(notifications.message({ ...base, nick: "Dan", text: "back", at: T0 + 8 * MINUTE })?.kind).toBe("wake");
  });

  it("ignores bot activity and does not count it unread", () => {
    const notifications = policy();
    expect(notifications.message({ ...base, nick: "n00bBot", text: "OMG MY MODEM", at: T0 })).toBeNull();
    expect(notifications.message({ ...base, nick: "BettyBot", text: "Hello", at: T0 })).toBeNull();
    expect(notifications.unread).toBe(0);
  });

  it("does not alert while visible or for the user's own lines", () => {
    const notifications = policy();
    expect(notifications.message({ ...base, hidden: false, nick: "Anna", text: "hi johndango", at: T0 })).toBeNull();
    expect(notifications.message({ ...base, self: true, nick: "johndango", text: "hi", at: T0 })).toBeNull();
    expect(notifications.unread).toBe(0);
  });
});

describe("mentions, whispers, and sleep", () => {
  it("alerts for whole-nickname mentions and whispers", () => {
    const notifications = policy({ mode: "mentions" });
    expect(notifications.message({ ...base, nick: "Anna", text: "johndango2 is here", at: T0 })).toBeNull();
    expect(notifications.message({ ...base, nick: "Dan", text: "has anyone seen JohnDango?", at: T0 + 1 })?.kind).toBe("mention");
    expect(notifications.message({ ...base, nick: "Anna", text: "psst", whisper: true, at: T0 + 2 })?.kind).toBe("whisper");
  });

  it("fully disables attention while off, but preserves unread counts while sleeping", () => {
    const off = policy({ mode: "off" });
    expect(off.message({ ...base, nick: "Anna", text: "hi johndango", at: T0 })).toBeNull();
    expect(off.unread).toBe(0);
    off.seen();
    expect(off.unread).toBe(0);

    const asleep = policy({ mode: "mentions", sleepUntil: T0 + 60_000 });
    expect(notificationsSleeping(asleep.settings, T0)).toBe(true);
    expect(asleep.message({ ...base, nick: "Anna", text: "hi johndango", at: T0 })).toBeNull();
    expect(asleep.message({ ...base, nick: "Anna", text: "hi johndango", at: T0 + 60_001 })?.kind).toBe("mention");
  });
});

describe("Logon Notifications", () => {
  it("alerts for watched arrivals after the initial roster", () => {
    const notifications = policy({ watch: ["Anna", "dan"] });
    expect(notifications.roster(["johndango", "Anna"], "#webcomicchat", T0)).toEqual([]);
    expect(notifications.roster(["johndango", "Anna", "Dan"], "#webcomicchat", T0 + MINUTE))
      .toEqual([{ kind: "logon", title: "dan is here", body: "dan just joined #webcomicchat" }]);
  });

  it("starts with a fresh roster in each room", () => {
    const notifications = policy({ watch: ["Anna"] });
    notifications.roster(["johndango"], "#a", T0);
    notifications.resetRoom();
    expect(notifications.roster(["johndango", "Anna"], "#b", T0 + MINUTE)).toEqual([]);
  });
});

describe("notification settings", () => {
  it("round-trips settings and rejects malformed stored values", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };
    const settings: NotifySettings = { mode: "mentions", sound: true, watch: ["Anna"], sleepUntil: T0 };
    saveNotifySettings(storage, settings);
    expect(loadNotifySettings(storage)).toEqual(settings);
    values.set("webcomicchat.notifications", '{"mode":"loud","watch":["ok","<script>",42],"sleepUntil":"later"}');
    expect(loadNotifySettings(storage)).toEqual({ mode: "off", sound: false, watch: ["ok"], sleepUntil: 0 });
  });

  it("parses and deduplicates an IRC nickname watch list", () => {
    expect(parseWatchList("Anna, Dan\nanna bad!name")).toEqual({ watch: ["Anna", "Dan"], rejected: ["bad!name"] });
  });
});

describe("tab attention", () => {
  it("adds, replaces, and removes an unread count", () => {
    expect(titleWithCount("WebComicChat", 3)).toBe("(3) WebComicChat");
    expect(titleWithCount("(3) WebComicChat", 250)).toBe("(99+) WebComicChat");
    expect(titleWithCount("(3) WebComicChat", 0)).toBe("WebComicChat");
  });
});
