export type NotifyMode = "off" | "wake" | "mentions";

export interface NotifySettings {
  /** "wake" includes mentions and whispers; "mentions" includes mentions and whispers only. */
  mode: NotifyMode;
  sound: boolean;
  /** Original Comic Chat-style logon watch list. */
  watch: string[];
  /** Alerts are suppressed until this Unix timestamp; unread counting continues. */
  sleepUntil: number;
}

export const DEFAULT_NOTIFY_SETTINGS: NotifySettings = {
  mode: "off",
  sound: false,
  watch: [],
  sleepUntil: 0,
};

export const NOTIFY_STORAGE_KEY = "webcomicchat.notifications";
const NICK = /^[A-Za-z[\]\\`_^{|}][A-Za-z0-9[\]\\`_^{|}-]{0,29}$/u;

export function loadNotifySettings(storage: Pick<Storage, "getItem"> | undefined): NotifySettings {
  try {
    const value = JSON.parse(storage?.getItem(NOTIFY_STORAGE_KEY) ?? "null") as Partial<NotifySettings> | null;
    if (!value || typeof value !== "object") return { ...DEFAULT_NOTIFY_SETTINGS, watch: [] };
    const mode = value.mode === "wake" || value.mode === "mentions" ? value.mode : "off";
    const watch = Array.isArray(value.watch)
      ? value.watch.filter((name): name is string => typeof name === "string" && NICK.test(name)).slice(0, 50)
      : [];
    const sleepUntil = typeof value.sleepUntil === "number" && Number.isFinite(value.sleepUntil) && value.sleepUntil > 0
      ? value.sleepUntil
      : 0;
    return { mode, sound: value.sound === true, watch, sleepUntil };
  } catch {
    return { ...DEFAULT_NOTIFY_SETTINGS, watch: [] };
  }
}

export function saveNotifySettings(storage: Pick<Storage, "setItem"> | undefined, settings: NotifySettings): void {
  try {
    storage?.setItem(NOTIFY_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private windows and blocked storage simply do not remember the setting.
  }
}

export function parseWatchList(text: string): { watch: string[]; rejected: string[] } {
  const names = text.split(/[\s,;]+/u).map((name) => name.trim()).filter(Boolean);
  const watch: string[] = [];
  const rejected: string[] = [];
  for (const name of names) {
    if (!NICK.test(name)) rejected.push(name);
    else if (!watch.some((existing) => existing.toLocaleLowerCase() === name.toLocaleLowerCase())) watch.push(name);
  }
  return { watch: watch.slice(0, 50), rejected };
}

export function notificationsSleeping(settings: NotifySettings, at = Date.now()): boolean {
  return settings.sleepUntil > at;
}

export interface Alert {
  kind: "wake" | "mention" | "whisper" | "logon";
  title: string;
  body: string;
}

const QUIET_BEFORE_WAKE = 5 * 60_000;
const MIN_GAP = 15_000;

export const isBotNickname = (nickname: string): boolean => /(bot|serv)[_\d]*$/iu.test(nickname);

function mentions(text: string, nickname: string): boolean {
  if (!nickname) return false;
  const escaped = nickname.replace(/[.*+?^${}()|[\]\\-]/gu, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_\\-[\\]\\\\\`^{}|])${escaped}(?=$|[^A-Za-z0-9_\\-[\\]\\\\\`^{}|])`, "iu").test(text);
}

const clip = (text: string, maximum = 120): string => text.length > maximum ? `${text.slice(0, maximum - 1)}…` : text;

export class NotifyPolicy {
  private lastHumanActivity = -Infinity;
  private lastAlert = -Infinity;
  private unreadCount = 0;
  private members: Set<string> | null = null;

  constructor(public settings: NotifySettings) {}

  get unread(): number {
    return this.unreadCount;
  }

  seen(): void {
    this.unreadCount = 0;
  }

  resetRoom(): void {
    this.members = null;
    this.lastHumanActivity = -Infinity;
    this.unreadCount = 0;
  }

  private alertAllowed(at: number, urgent: boolean): boolean {
    if (this.settings.mode === "off" || notificationsSleeping(this.settings, at)) return false;
    if (!urgent && at - this.lastAlert < MIN_GAP) return false;
    this.lastAlert = at;
    return true;
  }

  message(event: {
    nick: string;
    text: string;
    myNick: string;
    self: boolean;
    whisper?: boolean;
    channel: string;
    hidden: boolean;
    at: number;
  }): Alert | null {
    if (event.self || isBotNickname(event.nick)) return null;
    const quietFor = event.at - this.lastHumanActivity;
    this.lastHumanActivity = event.at;
    if (!event.hidden || this.settings.mode === "off") return null;
    this.unreadCount += 1;
    const said = clip(event.text.trim());
    if (event.whisper) {
      return this.alertAllowed(event.at, true)
        ? { kind: "whisper", title: `${event.nick} whispered to you`, body: said }
        : null;
    }
    if (mentions(event.text, event.myNick)) {
      return this.alertAllowed(event.at, true)
        ? { kind: "mention", title: `${event.nick} mentioned you in ${event.channel}`, body: said }
        : null;
    }
    if (this.settings.mode === "wake" && quietFor >= QUIET_BEFORE_WAKE) {
      return this.alertAllowed(event.at, false)
        ? { kind: "wake", title: `Someone's talking in ${event.channel}`, body: `${event.nick}: ${said}` }
        : null;
    }
    return null;
  }

  roster(members: Iterable<string>, channel: string, at: number): Alert[] {
    const next = new Set([...members].map((name) => name.toLocaleLowerCase()));
    const previous = this.members;
    this.members = next;
    if (!previous) return [];
    const arrivals = this.settings.watch.filter((name) =>
      next.has(name.toLocaleLowerCase()) && !previous.has(name.toLocaleLowerCase()));
    return arrivals.flatMap((name) => this.alertAllowed(at, true)
      ? [{ kind: "logon" as const, title: `${name} is here`, body: `${name} just joined ${channel}` }]
      : []);
  }
}
