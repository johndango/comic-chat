# Resident bot

One friendly, openly labelled bot that lives in the lobby. It's named
**BettyBot** by default, after the sample bot Microsoft shipped with Comic
Chat. The original Betty faked a crowd of 16 users for demos; this one is a
single bot that says it's a bot.

**What it does**
- Greets newcomers ("Hi Anna! Welcome to the comic :)"), since "Hi" makes
  the character wave and ":)" makes it smile. It says "welcome back" to
  people returning after 12 hours, greets at most once every 20 seconds
  per channel, and never greets itself or other bots.
- Mentions your schedule (`BOT_SCHEDULE`) to someone who arrives in an
  empty room.
- Answers when addressed (`BettyBot: help`) or messaged privately, with
  help, tips on how poses work, expression demonstrations (`show happy`),
  original comic titles, rotating history facts, the site link, the schedule,
  and what Comic Chat was. It admits it's a bot when asked.
- Keeps company: if someone speaks in an otherwise empty room and nobody
  answers within 3 minutes, it replies once with a tip.

**What it won't do**
- Repeat anything a user typed (all answers are canned).
- Answer more than 6 times a minute per person. It gives one friendly pause
  notice before going quiet, and sends no more than one line every 2 seconds.
- Talk to other bots or services.

It marks itself with the `+B` bot mode and answers CTCP VERSION.

## Run it

```sh
cd web
BOT_CHANNELS="#webcomicchat" \
BOT_SCHEDULE="Chat nights are Fridays at 8pm ET." \
npm run bot:dev
```

| Variable | Default | |
|---|---|---|
| `IRC_HOST` / `IRC_PORT` / `IRC_TLS` | `irc.libera.chat` / `6697` / `1` | Point at your own server later |
| `BOT_NICK` | `BettyBot` | |
| `BOT_CHANNELS` | `#webcomicchat` | Comma-separated |
| `BOT_ACCOUNT` / `BOT_PASSWORD` | — | NickServ account, used with SASL |
| `BOT_AVATAR` | `Anna` | Official or custom Comic Chat character name |
| `BOT_AVATAR_URL` | — | HTTPS URL for a hosted custom `.avb` |
| `SITE_URL` | `https://webcomicchat.com` | |
| `BOT_SCHEDULE` | — | e.g. `Chat nights are Fridays at 8pm ET.` |
| `BOT_IGNORE` | — | Other bots' nicks, comma-separated |
| `BOT_NO_GREET` | — | Human nicks not to greet automatically; they can still use commands |

## On Libera.Chat

Register the bot's nick with NickServ, then run it with `BOT_ACCOUNT` and
`BOT_PASSWORD` so it signs in before joining. That stops anyone else taking
the name. Get the channel operator's approval before adding it, and keep its
administrator reachable. The bot tells anyone who asks what it is, and its
WHOIS name points to the site.

## AI room bot

`TongueTiedBot` is an optional, separately run AI participant. It stays out of
ordinary conversation: only a line that addresses it by name is sent to
Anthropic's Claude. It retains at most 12 addressed lines and its own replies
as short conversation context. `TongueTiedBot: forget me` clears that entire
short context, including replies that might paraphrase an earlier line.

Every IRC line it produces begins with `[AI]`. Libera therefore sees the AI
label in the room; WebComicChat removes only that marker while drawing the
line as a comic balloon. The one-time notice to each person also says that the
bot is AI and that addressed messages go to Anthropic.

Before running it on Libera.Chat, follow the network's current
[bot policy](https://libera.chat/policies/):

- Get explicit permission from a channel operator.
- Put an explicit invitation/disclosure for the named LLM bot in the channel
  topic or ChanServ entry message.
- Keep the named administrator (or another delegated human administrator)
  present and reachable while it operates.
- Keep `ANTHROPIC_API_KEY` and NickServ credentials private.

Run it from a private environment file:

```sh
cd web
set -a
source /path/to/cambot.env
set +a
npm run cam
```

| Variable | Default | |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Required; never commit it |
| `CAM_ADMIN` | — | Required administrator nick; the bot answers only while this nick is present |
| `CAM_MODEL` | `claude-haiku-4-5` | Anthropic model |
| `CAM_DAILY_BUDGET_USD` | `1.00` | Hard daily reply budget |
| `BOT_NICK` | `TongueTiedBot` | |
| `BOT_CHANNELS` | `#webcomicchat` | Comma-separated |
| `BOT_ACCOUNT` / `BOT_PASSWORD` | — | NickServ SASL credentials; set both or neither |
| `BOT_AVATAR` | `Tongue-Tied` | Comic Chat character |
| `SITE_URL` | `https://webcomicchat.com` | The only origin the bot may link to |
| `BOT_IGNORE` | — | Other bots' nicks, comma-separated |

Safety and cost limits are enforced in code after the model responds: at most
two short lines, no IRC/control commands, no off-site links, no mass mentions,
per-person/hourly rate limits, and the configured daily spend ceiling.

## Keeping it running

It needs a machine that stays on. Your cPanel host will stop idle Node apps,
so it's not a good home. Put it on the same small VPS as your own IRC server
when you set that up. Run `npm ci && npm run build` in `web/` first. A systemd
unit is in `bettybot.service`: copy the repo to `/opt/webcomicchat`, put
secrets in `/etc/webcomicchat/bot.env`, then:

```sh
sudo cp web/bot/bettybot.service /etc/systemd/system/
sudo systemctl enable --now bettybot
journalctl -u bettybot -f   # watch what it says
```

It reconnects on its own (5 s, 10 s, 20 s… up to 5 minutes), so network
blips and server restarts need no attention.

## Appearing as a Comic Chat character

After joining, the bot announces `# Appears as <Name>.<url>` using the original
1998 convention. The web client consumes that line instead of drawing it as a
speech balloon. The default `Anna` needs no URL; set both avatar variables once
the approved custom-art host is available.

## n00bBot: the nostalgic gremlin

The same AI bot with `BOT_PERSONA=gremlin` becomes **n00bBot** (as a random pick of Tux,
Tiki, Xeno, Hugh, Lance, Kirby or Armando each time it starts; $0.50/day by default): a nostalgically annoying 1998 chat-room kid. ALL CAPS,
"brb mom needs the phone line", 56k-modem bragging, GeoCities plugs, and snide
remarks about the other bots. It is told, and checked in code, never to put
down real people.

- It answers when addressed, exactly like TongueTiedBot (same `[AI]` marking,
  disclosure, admin-presence rule, filters and limits).
- It also blurts out a one-liner on its own at most every 12 minutes, only
  while people are chatting, and only on half of those chances.
- Those unprompted lines never read the room: the model is told only which
  bots are present. Any unprompted line that names a real person is dropped.
- Anyone can say `n00bBot: go away` to mute it for an hour; operators can
  still use sleep and wake.

Run it with its own settings file (its own NickServ account):

```
BOT_PERSONA=gremlin
BOT_NICK=n00bBot
BOT_ACCOUNT=n00bBot
BOT_PASSWORD=...
ANTHROPIC_API_KEY=...
CAM_ADMIN=johndango
```
