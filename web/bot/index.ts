// Entry point: `npx tsx bot/index.ts` (configure with environment variables).
//
//   IRC_HOST          irc.libera.chat          IRC_PORT   6697
//   IRC_TLS           1 (0 for plain TCP)      BOT_NICK   BettyBot
//   BOT_CHANNELS      #webcomicchat            (comma-separated)
//   BOT_ACCOUNT / BOT_PASSWORD                 NickServ account for SASL login
//   BOT_AVATAR        Anna                      official or custom character name
//   BOT_AVATAR_URL                              optional hosted HTTPS .avb URL
//   SITE_URL          https://webcomicchat.com
//   BOT_SCHEDULE      e.g. "Chat nights are Fridays at 8pm ET."
//   BOT_IGNORE        other bots' nicks, comma-separated
//   BOT_NO_GREET      human nicks not to greet automatically (they can still use commands)
//   BOT_AI_FRIEND     TongueTiedBot             the room's AI bot, explained by "about" while present
//   BOT_DAILY_SPARK   1                          one quiet-room line per day (0 disables)
//   BOT_DAILY_FRIENDS TongueTiedBot,n00bBot      bots the daily line may address
//   BOT_STATE_FILE    .bettybot-state.json       remembers the last daily line across restarts

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { BotBrain, type BotBrainState, type BotEvent } from "./brain";
import { IrcBot } from "./irc";

const env = process.env;
const list = (value: string | undefined) => (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const nick = env.BOT_NICK ?? "BettyBot";
const siteUrl = env.SITE_URL ?? "https://webcomicchat.com";
const channels = list(env.BOT_CHANNELS ?? "#webcomicchat");
if (!channels.every((c) => /^#[A-Za-z0-9_+\-]{1,50}$/.test(c))) {
  throw new Error("BOT_CHANNELS must be a comma-separated list of #channels");
}
const avatarName = env.BOT_AVATAR ?? "Anna";
if (!/^[A-Za-z0-9_-]{1,60}$/.test(avatarName)) throw new Error("BOT_AVATAR is not a valid Comic Chat character name");
const avatarUrl = env.BOT_AVATAR_URL || undefined;
if (avatarUrl && (!avatarUrl.startsWith("https://") || avatarUrl.length > 2048)) {
  throw new Error("BOT_AVATAR_URL must be an HTTPS URL");
}
const dailySparkHourUtc = Number(env.BOT_DAILY_SPARK_HOUR_UTC ?? 18);
if (!Number.isInteger(dailySparkHourUtc) || dailySparkHourUtc < 0 || dailySparkHourUtc > 23) {
  throw new Error("BOT_DAILY_SPARK_HOUR_UTC must be an integer from 0 through 23");
}
const stateFile = resolve(env.BOT_STATE_FILE ?? ".bettybot-state.json");

function loadState(): BotBrainState {
  try {
    return JSON.parse(readFileSync(stateFile, "utf8")) as BotBrainState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`${new Date().toISOString()} Could not read bot state: ${error instanceof Error ? error.message : String(error)}`);
    }
    return {};
  }
}

const brain = new BotBrain({
  nick,
  siteUrl,
  schedule: env.BOT_SCHEDULE || undefined,
  ignore: list(env.BOT_IGNORE),
  noGreet: list(env.BOT_NO_GREET),
  aiFriend: env.BOT_AI_FRIEND ?? "TongueTiedBot",
  dailySpark: env.BOT_DAILY_SPARK !== "0",
  dailySparkHourUtc,
  dailyFriends: list(env.BOT_DAILY_FRIENDS ?? "TongueTiedBot,n00bBot"),
}, Math.random, loadState());

const log = (s: string) => console.log(`${new Date().toISOString()} ${s}`);
let savedState = JSON.stringify(brain.snapshot());

function persistState(): void {
  const state = JSON.stringify(brain.snapshot());
  if (state === savedState) return;
  try {
    mkdirSync(dirname(stateFile), { recursive: true });
    const temporary = `${stateFile}.${process.pid}.tmp`;
    writeFileSync(temporary, `${state}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, stateFile);
    savedState = state;
  } catch (error) {
    log(`Could not save bot state: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const bot = new IrcBot(
  {
    host: env.IRC_HOST ?? "irc.libera.chat",
    port: Number(env.IRC_PORT ?? 6697),
    tls: env.IRC_TLS !== "0",
    nick,
    realname: `webcomicchat resident bot (${siteUrl})`,
    channels,
    avatar: { name: avatarName, ...(avatarUrl ? { url: avatarUrl } : {}) },
    ...(env.BOT_ACCOUNT && env.BOT_PASSWORD ? { sasl: { account: env.BOT_ACCOUNT, password: env.BOT_PASSWORD } } : {}),
  },
  {
    onStatus: log,
    onNames: (channel, nicks) => dispatch({ type: "names", channel, nicks, at: Date.now() }),
    onJoin: (channel, who) => dispatch({ type: "join", channel, nick: who, at: Date.now() }),
    onPart: (channel, who) => dispatch({ type: "part", channel, nick: who, at: Date.now() }),
    onQuit: (who) => dispatch({ type: "quit", nick: who, at: Date.now() }),
    onNick: (oldNick, newNick) => dispatch({ type: "nick", oldNick, newNick, at: Date.now() }),
    onDisconnect: () => dispatch({ type: "disconnect", at: Date.now() }),
    onMessage: (channel, who, text) => dispatch({ type: "message", channel, nick: who, text, at: Date.now() }),
  },
);

function dispatch(event: BotEvent): void {
  for (const say of brain.handle(event)) {
    setTimeout(() => {
      log(`→ ${say.target}: ${say.text}`);
      bot.say(say.target, say.text);
    }, say.delay);
  }
  if (event.type === "tick") persistState();
}

setInterval(() => dispatch({ type: "tick", at: Date.now() }), 30_000).unref();
bot.start();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    bot.stop();
    setTimeout(() => process.exit(0), 500);
  });
}
