// CamBot entry point: `npm run cam:dev` (configure with environment variables).
//
//   ANTHROPIC_API_KEY                           required; keep it in a private env file
//   CAM_MODEL          claude-haiku-4-5
//   CAM_DAILY_BUDGET_USD  1.00                  replies stop for the day past this spend
//   CAM_ADMIN                                   required; your nick. CamBot only chats while you're in the room
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
const nick = env.BOT_NICK ?? "TongueTiedBot";
const siteUrl = env.SITE_URL ?? "https://webcomicchat.com";
const channels = list(env.BOT_CHANNELS ?? "#webcomicchat");
if (!channels.every((c) => /^#[A-Za-z0-9_+\-]{1,50}$/.test(c))) throw new Error("BOT_CHANNELS must list #channels");
const character = env.BOT_AVATAR ?? "Tongue-Tied";
if (!/^[A-Za-z0-9_-]{1,60}$/.test(character)) throw new Error("BOT_AVATAR is not a valid Comic Chat character name");
const model = env.CAM_MODEL ?? "claude-haiku-4-5";
const dailyBudgetUsd = Number(env.CAM_DAILY_BUDGET_USD ?? "1");
const admin = env.CAM_ADMIN ?? "";
if (!/^[A-Za-z][A-Za-z0-9_\-[\]\\`^{}|]{0,15}$/.test(admin)) throw new Error("Set CAM_ADMIN to your IRC nick (Libera.Chat requires LLM bots to be accompanied by their admin)");
if (!(dailyBudgetUsd > 0)) throw new Error("CAM_DAILY_BUDGET_USD must be a positive number");

const log = (s: string) => console.log(`${new Date().toISOString()} ${s}`);

const brain = new CamBrain(
  { nick, siteUrl, character, dailyBudgetUsd, admin, ignore: list(env.BOT_IGNORE) },
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
    onOperator: (channel, who, isOperator) => brain.operator(channel, who, isOperator),
    onMessage: (channel, who, text) => {
      void brain.message(channel, who, text).then((lines) => {
        for (const line of lines) {
          log(`→ ${channel ?? who}: ${line} (spent today $${brain.spent.toFixed(4)})`);
          bot.say(channel ?? who, line);
        }
      });
    },
  },
);

log(`${nick} using ${model}, daily budget $${dailyBudgetUsd.toFixed(2)}`);
bot.start();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    bot.stop();
    setTimeout(() => process.exit(0), 500);
  });
}
