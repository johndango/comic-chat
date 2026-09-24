// Entry point: `npx tsx bot/index.ts` (configure with environment variables).
//
//   IRC_HOST          irc.libera.chat          IRC_PORT   6697
//   IRC_TLS           1 (0 for plain TCP)      BOT_NICK   BettyBot
//   BOT_CHANNELS      #webcomicchat            (comma-separated)
//   BOT_ACCOUNT / BOT_PASSWORD                 NickServ account for SASL login
//   SITE_URL          https://webcomicchat.com
//   BOT_SCHEDULE      e.g. "Chat nights are Fridays at 8pm ET."
//   BOT_IGNORE        other bots' nicks, comma-separated

import { BotBrain, type BotEvent } from "./brain";
import { IrcBot } from "./irc";

const env = process.env;
const list = (value: string | undefined) => (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const nick = env.BOT_NICK ?? "BettyBot";
const siteUrl = env.SITE_URL ?? "https://webcomicchat.com";
const channels = list(env.BOT_CHANNELS ?? "#webcomicchat");
if (!channels.every((c) => /^#[A-Za-z0-9_+\-]{1,50}$/.test(c))) {
  throw new Error("BOT_CHANNELS must be a comma-separated list of #channels");
}

const brain = new BotBrain({ nick, siteUrl, schedule: env.BOT_SCHEDULE || undefined, ignore: list(env.BOT_IGNORE) });

const log = (s: string) => console.log(`${new Date().toISOString()} ${s}`);

const bot = new IrcBot(
  {
    host: env.IRC_HOST ?? "irc.libera.chat",
    port: Number(env.IRC_PORT ?? 6697),
    tls: env.IRC_TLS !== "0",
    nick,
    realname: `webcomicchat resident bot (${siteUrl})`,
    channels,
    ...(env.BOT_ACCOUNT && env.BOT_PASSWORD ? { sasl: { account: env.BOT_ACCOUNT, password: env.BOT_PASSWORD } } : {}),
  },
  {
    onStatus: log,
    onNames: (channel, nicks) => dispatch({ type: "names", channel, nicks, at: Date.now() }),
    onJoin: (channel, who) => dispatch({ type: "join", channel, nick: who, at: Date.now() }),
    onPart: (channel, who) => dispatch({ type: "part", channel, nick: who, at: Date.now() }),
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
}

setInterval(() => dispatch({ type: "tick", at: Date.now() }), 30_000).unref();
bot.start();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    bot.stop();
    setTimeout(() => process.exit(0), 500);
  });
}
