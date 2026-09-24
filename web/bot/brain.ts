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
  /** The room's AI bot, if any; "about" explains how to chat with it while it's present. */
  aiFriend?: string;
  /** Shown to people who arrive in an empty room, e.g. "Chat nights are Fridays at 8pm ET". */
  schedule?: string;
  /** Nicks (lower case) never to greet or answer, e.g. other bots. */
  ignore?: string[];
  /** Human nicks that may use the bot normally but should not receive automatic greetings. */
  noGreet?: string[];
  /** Post one quiet-room conversation starter per UTC day. */
  dailySpark?: boolean;
  /** Earliest UTC hour for the daily line (default 18, late morning Pacific time). */
  dailySparkHourUtc?: number;
  /** Bots Betty may address for a single reply when they are present. */
  dailyFriends?: string[];
}

export interface BotBrainState {
  dailySparkDays?: Record<string, string>;
}

export type BotEvent =
  | { type: "join"; channel: string; nick: string; at: number }
  | { type: "part"; channel: string; nick: string; at: number }
  | { type: "quit"; nick: string; at: number }
  | { type: "nick"; oldNick: string; newNick: string; at: number }
  | { type: "disconnect"; at: number }
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
const DAILY_SPARK_HOUR_UTC = 18;

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

const DAILY_ONE_LINERS = [
  "The room is quiet, but the comic still gets a panel today :)",
  "TODAY'S PLOT TWIST: the empty room was listening the whole time!!!",
  "A blank speech balloon is just a dramatic pause waiting for dialogue.",
  "Today's tiny creative assignment: give a character one sentence they would regret saying out loud ;)",
  "No chat required for roll call: the comic is here whenever somebody needs a panel.",
];

const DAILY_BOT_PROMPTS = [
  (friend: string) => `${friend}: quick question for today's comic—speech balloons or thought balloons?`,
  (friend: string) => `${friend}: the room needs a plot twist. Give our imaginary readers one sentence.`,
  (friend: string) => `${friend}: rate today's dramatic silence from one to ten.`,
  (friend: string) => `${friend}: what should the title of today's extremely quiet comic be?`,
];

/**
 * `show <expression>`: a line crafted to trigger that expression under the
 * original Comic Chat rules (expression.ts), so Betty's character acts it out.
 * Angry, scared and bored shipped with no text rules, so only the wheel can
 * reach them.
 */
const SHOWS: [RegExp, string][] = [
  [/shout|yell|caps/, "LOOK AT ME SHOUT!!! ALL CAPS OR THREE !!! DOES IT"],
  [/laugh|lol|haha/, "LOL! Typing LOL, ROTFL or hehe makes you laugh like this"],
  [/happy|smile|grin/, "This is my happy face :) any :) or :-) does it"],
  [/sad|frown|cry/, "Aww, this is my sad face :( any :( or :-( does it"],
  [/coy|wink|flirt/, "Here's my coy look ;) a wink does it"],
  [/wave|hello|hi|greet/, "Hello! Start a line with Hi, Hello, Welcome or Howdy and you'll wave like this"],
  [/point|you/, "You get pointed at when a line starts with You, like this one"],
  [/self|me|myself/, "I point at myself whenever a line starts with I, like this one"],
];

const WHEEL_ONLY = /angry|mad|scared|afraid|bored/;

/** chat.rc IDS_TITLE1..16: the random titles Comic Chat gave each comic. */
const TITLES = [
  "EVERYONE'S A COMIC",
  "DOGGY DOGGY WAH WAH",
  "YOU SHOULDA BEEN THERE",
  "NO EXIT",
  "WISH YOU WERE HERE",
  "DEEPEST DARKEST DESIRES",
  "JUST US CHUMPS",
  "SIGHTED IN CYBERSPACE",
  "THE GANG'S ALL HERE",
  "BORN TO CHAT",
  "NETWORKED NERDS",
  "VIRTUALLY VACUOUS",
  "IF I ONLY HAD A BRAIN",
  "SLUMBER PARTY",
  "MEET MARKET",
  "MICROSOFT CHAT",
];

/** Comic Chat history, checked against the original source and archives. */
const FACTS = [
  "Comic Chat began as a Microsoft Research project by David Kurlander, and version 1.0 shipped with Internet Explorer 3 in 1996.",
  "The original characters were drawn by the cartoonist Jim Woodring. His name is in the copyright line of every character file.",
  "Later versions were renamed Microsoft Chat and came with Internet Explorer 4 and Windows 98.",
  "Microsoft's own Comic Chat servers closed for good on 21 February 2001, but fans kept chatting on other IRC networks.",
  "The rules that turn your text into expressions weren't code. They were strings like CheckWord*(\"LOL\") stored in the program's resources.",
  "A quirk in the 1998 code means only the first sentence of a message can make you wave or point.",
  "18 of the 25 original characters are built from separate heads and torsos, chosen independently, so you can wave and smile at once.",
  "The same character never speaks twice in one panel. Saying a second line always starts a new panel.",
  "Balloons are smooth Beta-spline curves around the text, and each tail is kept to a 45-degree slant.",
  "Microsoft shipped a sample bot called Betty that filled demo rooms with 16 pretend chatters. I'm named after her, but there's only one of me.",
  "Comic Chat clients told each other which character they were with a line starting \"# Appears as\".",
  "Every comic got a random title, from EVERYONE'S A COMIC to DOGGY DOGGY WAH WAH. Ask me for one with: title",
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
  private readonly noGreet: Set<string>;
  private readonly dailySparkDays = new Map<string, string>();

  private factIndex = 0;

  constructor(
    private readonly config: BotConfig,
    /** Injected for tests; returns [0, 1). */
    private readonly random: () => number = Math.random,
    state: BotBrainState = {},
  ) {
    this.ignore = new Set((config.ignore ?? []).map(fold));
    this.noGreet = new Set((config.noGreet ?? []).map(fold));
    for (const [channel, day] of Object.entries(state.dailySparkDays ?? {})) {
      if (/^#[A-Za-z0-9_+\-]{1,50}$/.test(channel) && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
        this.dailySparkDays.set(fold(channel), day);
      }
    }
  }

  snapshot(): BotBrainState {
    return { dailySparkDays: Object.fromEntries(this.dailySparkDays) };
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
        state.members = new Set(event.nicks.map((n) => n.replace(/^[~&@%+]+/, "")));
        return [];
      }
      case "join":
        return this.onJoin(event);
      case "part": {
        const state = this.channel(event.channel);
        this.deleteMember(state.members, event.nick);
        return [];
      }
      case "quit":
        for (const state of this.channels.values()) this.deleteMember(state.members, event.nick);
        return [];
      case "nick":
        for (const state of this.channels.values()) {
          const oldNick = [...state.members].find((nick) => fold(nick) === fold(event.oldNick));
          if (oldNick) {
            state.members.delete(oldNick);
            state.members.add(event.newNick);
          }
        }
        return [];
      case "disconnect":
        for (const state of this.channels.values()) state.members.clear();
        return [];
      case "message":
        return this.onMessage(event);
      case "tick":
        return this.onTick(event.at);
    }
  }

  private deleteMember(members: Set<string>, nick: string): void {
    const existing = [...members].find((member) => fold(member) === fold(nick));
    if (existing) members.delete(existing);
  }

  private onJoin(event: Extract<BotEvent, { type: "join" }>): Say[] {
    const state = this.channel(event.channel);
    state.members.add(event.nick);
    if (this.isSelf(event.nick) || looksLikeBot(event.nick, this.ignore)) return [];
    if (this.noGreet.has(fold(event.nick))) return [];
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
    const aiPresent = !!event.channel && !!this.config.aiFriend && this.aiFriendIn(event.channel);
    return [{ target: replyTo, text: this.answer(request, event.nick, aiPresent), delay: 1500 }];
  }

  private nextTip(): string {
    const tip = TIPS[this.tipIndex % TIPS.length];
    this.tipIndex += 1;
    return tip;
  }

  private show(q: string): string {
    const what = q.replace(/^show\s*(me\s+)?(a\s+|an\s+|your\s+)?/, "");
    if (!what) return "Ask me to show: shout, laugh, happy, sad, coy, wave, point, or self.";
    if (WHEEL_ONLY.test(what)) {
      return "There's no text trigger for that one. Drag the emotion wheel to it, and your next line uses it.";
    }
    const match = SHOWS.find(([pattern]) => pattern.test(what));
    return match ? match[1] : "I can show: shout, laugh, happy, sad, coy, wave, point, or self.";
  }

  /** Canned answers only: nothing the user typed is ever echoed back. */
  private aiFriendIn(channel: string): boolean {
    const friend = fold(this.config.aiFriend ?? "");
    return [...this.channel(channel).members].some((member) => fold(member) === friend);
  }

  answer(request: string, nick: string, aiPresent = false): string {
    const q = fold(request);
    if (/^(help|commands|\?)?$/.test(q)) {
      return `Hi ${nick}! Ask me for: tips, show, title, fact, link, about, or schedule. Or just chat and watch the comic draw itself :)`;
    }
    if (/^show\b/.test(q)) return this.show(q);
    if (/\btitle\b/.test(q)) {
      const title = TITLES[Math.min(TITLES.length - 1, Math.floor(this.random() * TITLES.length))];
      return `Tonight's comic is called "${title}"`;
    }
    if (/\b(fact|trivia|history)\b/.test(q)) {
      const fact = FACTS[this.factIndex % FACTS.length];
      this.factIndex += 1;
      return fact;
    }
    if (/\b(tip|how|pose|face|express|emot|smile|shout|wave)/.test(q)) return this.nextTip();
    if (/\b(link|url|invite|share|site)\b/.test(q)) return `Bring friends: ${this.config.siteUrl}`;
    if (/\b(schedule|when|busy|chat night|event)/.test(q)) {
      return this.config.schedule ?? "We'll be announcing a special weekly meetup soon! Until then the room is open any time, so bring a friend and start a comic :)";
    }
    if (/\b(bot|human|real|person|robot)\b/.test(q)) return "Yes, I'm a bot. Everyone else here is a real person :)";
    if (/\b(about|who|what|comic chat)\b/.test(q)) {
      const about = "This room is drawn live as a comic, like Microsoft Comic Chat did in 1996. The site rebuilt it from the original source code.";
      const friend = this.config.aiFriend;
      if (!aiPresent || !friend) return about;
      return `${about} ${friend} is here too, an AI you can chat with any time: start a line with "${friend}:" or pick it in the member list. Lines you address to it go to Anthropic's Claude.`;
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
    if (!this.config.dailySpark) return out;
    const now = new Date(at);
    const hour = this.config.dailySparkHourUtc ?? DAILY_SPARK_HOUR_UTC;
    if (now.getUTCHours() < hour) return out;
    const day = now.toISOString().slice(0, 10);
    for (const [key, state] of this.channels) {
      if (this.dailySparkDays.get(key) === day || state.members.size === 0) continue;
      this.dailySparkDays.set(key, day);
      const allowedFriends = new Set((this.config.dailyFriends ?? []).map(fold));
      const friends = [...state.members].filter((member) => allowedFriends.has(fold(member)));
      const talkToFriend = friends.length > 0 && this.random() < 0.5;
      const text = talkToFriend
        ? DAILY_BOT_PROMPTS[Math.floor(this.random() * DAILY_BOT_PROMPTS.length)](
          friends[Math.floor(this.random() * friends.length)],
        )
        : DAILY_ONE_LINERS[Math.floor(this.random() * DAILY_ONE_LINERS.length)];
      out.push({ target: state.name, text, delay: 0 });
    }
    return out;
  }
}
