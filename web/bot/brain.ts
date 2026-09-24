// The resident bot's behaviour, kept free of networking so every rule can be
// tested. Events go in; lines to send come out.
//
// Ground rules: it's one openly-labelled bot (unlike 1998's Betty Bot, which
// faked a crowd of users for demos). It greets people, explains how the comic
// works, keeps a lone visitor company once, and never floods, repeats user
// text, or answers other bots.

export interface BotConfig {
  nick: string;
  siteUrl: string;
  /** Shown to people who arrive in an empty room, e.g. "Chat nights are Fridays at 8pm ET". */
  schedule?: string;
  /** Nicks (lower case) never to greet or answer, e.g. other bots. */
  ignore?: string[];
}

export type BotEvent =
  | { type: "join"; channel: string; nick: string; at: number }
  | { type: "part"; channel: string; nick: string; at: number }
  | { type: "names"; channel: string; nicks: string[]; at: number }
  | { type: "message"; channel: string | null; nick: string; text: string; at: number }
  | { type: "tick"; at: number };

export interface Say {
  /** Channel name, or a nick for a private reply. */
  target: string;
  text: string;
  /** Milliseconds to wait before sending, so replies don't feel instant. */
  delay: number;
}

const HOUR = 3_600_000;
const MINUTE = 60_000;

/** How long someone counts as "recently greeted". */
const GREET_MEMORY = 12 * HOUR;
/** Minimum spacing between greetings in one channel. */
const GREET_SPACING = 20_000;
/** A lone visitor who speaks and gets no answer for this long hears from the bot once. */
const LONELY_AFTER = 3 * MINUTE;
/** Answers per person per minute; enough to explore every command, too few to spam. */
const ANSWERS_PER_MINUTE = 6;

const fold = (s: string) => s.toLowerCase();

/** Rough bot detection: names ending in bot/serv, or ones we were told to ignore. */
function looksLikeBot(nick: string, ignore: Set<string>): boolean {
  const n = fold(nick);
  return ignore.has(n) || /(bot|serv)[_\d]*$/.test(n) || n === "chanserv" || n === "nickserv";
}

const TIPS = [
  "Your character's face follows what you type: :) smiles, :( frowns, ;) winks, and LOL or hehe laughs.",
  "Typing in ALL CAPS (or adding !!!) makes you shout.",
  "Start a line with Hi, Hello or Welcome and you'll wave. Start with I and you'll point at yourself; start with You and you'll point at someone.",
  "Pick someone in the member list before you talk and your character turns to face them.",
  "Use /me for a narration box, like /me waves at everyone.",
  "Drag the emotion wheel (bottom right) to choose a mood by hand; it's used for your next line.",
  "Long messages continue across panels with ... like the original.",
];

interface ChannelState {
  name: string;
  members: Set<string>;
  lastGreetAt: number;
  lastHumanLineAt: number;
  /** A lone visitor spoke at this time and nobody has answered yet. */
  loneLineAt: number | null;
  lonelyNudged: Set<string>;
}

export class BotBrain {
  private channels = new Map<string, ChannelState>();
  private greeted = new Map<string, number>();
  private answers = new Map<string, number[]>();
  /** People already told the bot is catching its breath (cleared when their minute resets). */
  private throttled = new Set<string>();
  private tipIndex = 0;
  private readonly ignore: Set<string>;

  constructor(private readonly config: BotConfig) {
    this.ignore = new Set((config.ignore ?? []).map(fold));
  }

  private channel(name: string): ChannelState {
    const key = fold(name);
    let state = this.channels.get(key);
    if (!state) {
      state = { name, members: new Set(), lastGreetAt: 0, lastHumanLineAt: 0, loneLineAt: null, lonelyNudged: new Set() };
      this.channels.set(key, state);
    }
    return state;
  }

  private isSelf(nick: string): boolean {
    return fold(nick) === fold(this.config.nick);
  }

  /** Humans in the channel other than the bot. */
  private humans(state: ChannelState): string[] {
    return [...state.members].filter((n) => !this.isSelf(n) && !looksLikeBot(n, this.ignore));
  }

  handle(event: BotEvent): Say[] {
    switch (event.type) {
      case "names": {
        const state = this.channel(event.channel);
        for (const n of event.nicks) state.members.add(n.replace(/^[~&@%+]+/, ""));
        return [];
      }
      case "join":
        return this.onJoin(event);
      case "part": {
        const state = this.channel(event.channel);
        state.members.delete(event.nick);
        return [];
      }
      case "message":
        return this.onMessage(event);
      case "tick":
        return this.onTick(event.at);
    }
  }

  private onJoin(event: Extract<BotEvent, { type: "join" }>): Say[] {
    const state = this.channel(event.channel);
    state.members.add(event.nick);
    if (this.isSelf(event.nick) || looksLikeBot(event.nick, this.ignore)) return [];
    const last = this.greeted.get(fold(event.nick));
    if (last !== undefined && event.at - last < GREET_MEMORY) return [];
    if (event.at - state.lastGreetAt < GREET_SPACING) return [];
    this.greeted.set(fold(event.nick), event.at);
    state.lastGreetAt = event.at;

    const returning = last !== undefined;
    const lines: Say[] = [
      {
        target: event.channel,
        text: returning
          ? `Hi ${event.nick}, welcome back :)`
          : `Hi ${event.nick}! Welcome to the comic :) I'm ${this.config.nick}, the resident bot. Say "${this.config.nick}: help" any time.`,
        delay: 2500,
      },
    ];
    if (this.humans(state).length <= 1 && this.config.schedule) {
      lines.push({ target: event.channel, text: `It's quiet right now. ${this.config.schedule}`, delay: 6000 });
    }
    return lines;
  }

  private addressed(text: string): string | null {
    const nick = this.config.nick.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = text.match(new RegExp(`^\\s*@?${nick}\\b[\\s,:]*(.*)$`, "i"));
    return match ? match[1].trim() : null;
  }

  /** "answer", "notice" (say once that it's pausing), or "quiet". */
  private allowAnswer(nick: string, at: number): "answer" | "notice" | "quiet" {
    const key = fold(nick);
    const recent = (this.answers.get(key) ?? []).filter((t) => at - t < MINUTE);
    this.answers.set(key, recent);
    if (recent.length >= ANSWERS_PER_MINUTE) {
      if (this.throttled.has(key)) return "quiet";
      this.throttled.add(key);
      return "notice";
    }
    this.throttled.delete(key);
    recent.push(at);
    return "answer";
  }

  private onMessage(event: Extract<BotEvent, { type: "message" }>): Say[] {
    if (this.isSelf(event.nick) || looksLikeBot(event.nick, this.ignore)) return [];
    const replyTo = event.channel ?? event.nick;
    if (event.channel) {
      const state = this.channel(event.channel);
      state.members.add(event.nick);
      const alone = this.humans(state).length <= 1;
      if (alone && !state.lonelyNudged.has(fold(event.nick))) state.loneLineAt = event.at;
      else state.loneLineAt = null;
      state.lastHumanLineAt = event.at;
    }
    const request = event.channel ? this.addressed(event.text) : event.text.trim();
    if (request === null) return [];
    const allowed = this.allowAnswer(event.nick, event.at);
    if (allowed === "quiet") return [];
    if (event.channel) this.channel(event.channel).loneLineAt = null;
    if (allowed === "notice") {
      return [{ target: replyTo, text: `Catching my breath, ${event.nick}. Ask me again in a minute :)`, delay: 1500 }];
    }
    return [{ target: replyTo, text: this.answer(request, event.nick), delay: 1500 }];
  }

  private nextTip(): string {
    const tip = TIPS[this.tipIndex % TIPS.length];
    this.tipIndex += 1;
    return tip;
  }

  /** Canned answers only: nothing the user typed is ever echoed back. */
  answer(request: string, nick: string): string {
    const q = fold(request);
    if (/^(help|commands|\?)?$/.test(q)) {
      return `Hi ${nick}! Ask me for: tips, link, about, or schedule. Or just chat and watch the comic draw itself :)`;
    }
    if (/\b(tip|how|pose|face|express|emot|smile|shout|wave)/.test(q)) return this.nextTip();
    if (/\b(link|url|invite|share|site)\b/.test(q)) return `Bring friends: ${this.config.siteUrl}`;
    if (/\b(schedule|when|busy|chat night|event)/.test(q)) {
      return this.config.schedule ?? "Nothing's scheduled yet: the room is open any time, so bring a friend and start a comic :)";
    }
    if (/\b(bot|human|real|person|robot)\b/.test(q)) return "Yes, I'm a bot. Everyone else here is a real person :)";
    if (/\b(about|who|what|comic chat)\b/.test(q)) {
      return "This room is drawn live as a comic, like Microsoft Comic Chat did in 1996. The site rebuilt it from the original source code.";
    }
    if (/\b(hi|hello|hey|howdy)\b/.test(q)) return `Hi ${nick} :)`;
    if (/\b(thanks|thank you|thx|ty)\b/.test(q)) return "Any time :)";
    return `I only know a few tricks. Try "${this.config.nick}: tips" :)`;
  }

  private onTick(at: number): Say[] {
    const out: Say[] = [];
    for (const state of this.channels.values()) {
      if (state.loneLineAt === null || at - state.loneLineAt < LONELY_AFTER) continue;
      const humans = this.humans(state);
      state.loneLineAt = null;
      if (humans.length !== 1) continue;
      const [lone] = humans;
      if (state.lonelyNudged.has(fold(lone))) continue;
      state.lonelyNudged.add(fold(lone));
      out.push({
        target: state.name,
        text: `Nobody else is around just now, ${lone}, but I'm here! ${this.nextTip()}`,
        delay: 0,
      });
    }
    return out;
  }
}
