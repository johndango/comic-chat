// CamBot entry point: `npm run cam:dev` (configure with environment variables).
//
//   ANTHROPIC_API_KEY                           required; keep it in a private env file
//   CAM_MODEL          claude-haiku-4-5
//   CAM_DAILY_BUDGET_USD  1.00                  replies stop for the day past this spend
//   CAM_ADMIN                                   required; your nick. CamBot only chats while you're in the room
//   BOT_PERSONA        friendly                 or "gremlin": a nostalgically annoying 1998 kid who
//                                               also blurts out one-liners (defaults CapsLockBot as Kirby, $0.50/day)
//   BOT_NICK           TongueTiedBot            BOT_CHANNELS  #webcomicchat
//   BOT_ACCOUNT / BOT_PASSWORD                  NickServ account for SASL login
//   BOT_AVATAR         Tongue-Tied              each viewer's colour setting picks the edition
//   SITE_URL           https://webcomicchat.com
//   BOT_IGNORE         other bots' nicks, comma-separated
//   IRC_HOST / IRC_PORT / IRC_TLS               default irc.libera.chat / 6697 / 1

import { CamBrain } from "./cam-brain";
import { claudeResponder } from "./cam-claude";
import { IrcBot } from "./irc";

const env = process.env;
const list = (value: string | undefined) => (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);

if (!env.ANTHROPIC_API_KEY) throw new Error("Set ANTHROPIC_API_KEY (in a private env file) before starting the AI bot");
const persona = env.BOT_PERSONA === "gremlin" ? "gremlin" : "friendly";
if (env.BOT_PERSONA && env.BOT_PERSONA !== persona) throw new Error('BOT_PERSONA must be "friendly" or "gremlin"');
const gremlin = persona === "gremlin";
const nick = env.BOT_NICK ?? (gremlin ? "CapsLockBot" : "TongueTiedBot");
const siteUrl = env.SITE_URL ?? "https://webcomicchat.com";
const channels = list(env.BOT_CHANNELS ?? "#webcomicchat");
if (!channels.length || !channels.every((c) => /^#[A-Za-z0-9_+\-]{1,50}$/.test(c))) throw new Error("BOT_CHANNELS must list at least one #channel");
const character = env.BOT_AVATAR ?? (gremlin ? "Kirby" : "Tongue-Tied");
if (!/^[A-Za-z0-9_-]{1,60}$/.test(character)) throw new Error("BOT_AVATAR is not a valid Comic Chat character name");
const model = env.CAM_MODEL ?? "claude-haiku-4-5";
const dailyBudgetUsd = Number(env.CAM_DAILY_BUDGET_USD ?? (gremlin ? "0.5" : "1"));
const admin = env.CAM_ADMIN ?? "";
if (!/^[A-Za-z][A-Za-z0-9_\-[\]\\`^{}|]{0,15}$/.test(admin)) throw new Error("Set CAM_ADMIN to your IRC nick (Libera.Chat requires LLM bots to be accompanied by their admin)");
if (!Number.isFinite(dailyBudgetUsd) || !(dailyBudgetUsd > 0)) throw new Error("CAM_DAILY_BUDGET_USD must be a finite positive number");
if (!/^[A-Za-z0-9._-]{1,120}$/.test(model)) throw new Error("CAM_MODEL contains invalid characters");
const parsedSiteUrl = new URL(siteUrl);
if (parsedSiteUrl.protocol !== "https:" || parsedSiteUrl.username || parsedSiteUrl.password) throw new Error("SITE_URL must be a public HTTPS URL");
if (!!env.BOT_ACCOUNT !== !!env.BOT_PASSWORD) throw new Error("Set BOT_ACCOUNT and BOT_PASSWORD together");

const log = (s: string) => console.log(`${new Date().toISOString()} ${s}`);
let messageQueue = Promise.resolve();

const brain = new CamBrain(
  { nick, siteUrl, character, dailyBudgetUsd, admin, persona, ignore: list(env.BOT_IGNORE) },
  claudeResponder(model),
  log,
);

const bot = new IrcBot(
  {
    host: env.IRC_HOST ?? "irc.libera.chat",
    port: Number(env.IRC_PORT ?? 6697),
    tls: env.IRC_TLS !== "0",
    nick,
    realname: `AI bot for ${siteUrl.replace(/^https?:\/\//, "")}, admin ${admin}`,
    channels,
    avatar: { name: character },
    ...(env.BOT_ACCOUNT && env.BOT_PASSWORD ? { sasl: { account: env.BOT_ACCOUNT, password: env.BOT_PASSWORD } } : {}),
  },
  {
    onStatus: log,
    onNames: (channel, nicks) => brain.names(channel, nicks),
    onJoin: (channel, who) => brain.join(channel, who),
    onPart: (channel, who) => brain.part(channel, who),
    onQuit: (who) => brain.quit(who),
    onNick: (oldNick, newNick) => brain.rename(oldNick, newNick),
    onDisconnect: () => brain.disconnected(),
    onOperator: (channel, who, isOperator) => brain.operator(channel, who, isOperator),
    onMessage: (channel, who, text) => {
      const receivedAt = Date.now();
      messageQueue = messageQueue.then(async () => {
        const lines = await brain.message(channel, who, text, receivedAt);
        for (const line of lines) {
          log(`→ ${channel ?? who}: ${line} (spent today $${brain.spent.toFixed(4)})`);
          bot.say(channel ?? who, line);
        }
      }).catch((error) => log(`message handling failed: ${error instanceof Error ? error.message : String(error)}`));
    },
  },
);

// The gremlin gets a chance to blurt something out once a minute; the brain
// decides (at most every 12 minutes, only while people are chatting).
if (gremlin) {
  setInterval(() => {
    for (const channel of channels) {
      messageQueue = messageQueue.then(async () => {
        for (const line of await brain.interject(channel)) {
          log(`→ ${channel}: ${line} (unprompted; spent today $${brain.spent.toFixed(4)})`);
          bot.say(channel, line);
        }
      }).catch((error) => log(`interjection failed: ${error instanceof Error ? error.message : String(error)}`));
    }
  }, 60_000).unref();
}

log(`${nick} using ${model}, daily budget $${dailyBudgetUsd.toFixed(2)}`);
bot.start();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    bot.stop();
    setTimeout(() => process.exit(0), 500);
  });
}
