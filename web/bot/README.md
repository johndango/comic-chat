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
  help, tips on how poses work, the site link, the schedule, and what
  Comic Chat was. It admits it's a bot when asked.
- Keeps company: if someone speaks in an otherwise empty room and nobody
  answers within 3 minutes, it replies once with a tip.

**What it won't do**
- Repeat anything a user typed (all answers are canned).
- Answer more than 3 times a minute per person, or send more than one line
  every 1.5 seconds.
- Talk to other bots or services.

It marks itself with the `+B` bot mode and answers CTCP VERSION.

## Run it

```sh
cd web
BOT_CHANNELS="#webcomicchat" \
BOT_SCHEDULE="Chat nights are Fridays at 8pm ET." \
npx tsx bot/index.ts
```

| Variable | Default | |
|---|---|---|
| `IRC_HOST` / `IRC_PORT` / `IRC_TLS` | `irc.libera.chat` / `6697` / `1` | Point at your own server later |
| `BOT_NICK` | `BettyBot` | |
| `BOT_CHANNELS` | `#webcomicchat` | Comma-separated |
| `BOT_ACCOUNT` / `BOT_PASSWORD` | — | NickServ account, used with SASL |
| `SITE_URL` | `https://webcomicchat.com` | |
| `BOT_SCHEDULE` | — | e.g. `Chat nights are Fridays at 8pm ET.` |
| `BOT_IGNORE` | — | Other bots' nicks, comma-separated |

## On Libera.Chat

Register the bot's nick with NickServ, then run it with `BOT_ACCOUNT` and
`BOT_PASSWORD` so it signs in before joining. That stops anyone else taking
the name. Make sure the channel's founder (you) is happy to have it there;
it's your own channel, so you are. The bot tells anyone who asks what it is,
and its WHOIS name points to the site.

## Keeping it running

It needs a machine that stays on. Your cPanel host will stop idle Node apps,
so it's not a good home. Put it on the same small VPS as your own IRC server
when you set that up. A systemd unit is in `bettybot.service`: copy the repo
to `/opt/webcomicchat`, put secrets in `/etc/webcomicchat/bot.env`, then:

```sh
sudo cp web/bot/bettybot.service /etc/systemd/system/
sudo systemctl enable --now bettybot
journalctl -u bettybot -f   # watch what it says
```

It reconnects on its own (5 s, 10 s, 20 s… up to 5 minutes), so network
blips and server restarts need no attention.

## Later: appearing as a Comic Chat character

The 1998 client announced its character with a channel line
`# Appears as <Name>.<url>`. The web client doesn't recognise that line yet,
so it would draw it as a speech balloon. Once the web client hides and uses
it, the bot can announce a character too; that's a small change here.
