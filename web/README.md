# Comic Chat web client

This is a web-based Comic Chat client with a desktop modeled after the original
Microsoft Comic Chat 2.5 interface. It decodes all 35 bundled version 2 `.avb`
characters—including the alternate Art Pack editions—plus 21 version 1 color
replacements and all nine `.bgb`
backdrops directly, builds a multi-panel conversation strip on Canvas, exports
the result as a PNG, and can render a live IRC channel through a small local
gateway.

Panels display at their original 324-pixel size by default. **Panels across**
can use automatic wrapping or fit an explicit one through seven columns, based
on settings captured from the original client. The independent zoom slider
scales the reading view from 60% to 160%; both preferences are remembered.
Panels never shrink below the original client's 2,300-twip minimum and use a
scrollable comic surface on narrow screens. Saved PNGs retain the original
resolution and add the same narrow white gutter between adjacent panel borders
and around all four outer edges. In
offline mode the selected character remains selected until the
user chooses another one.

**Open Comic Studio…** turns the offline strip into a directed editor. Each
character beat can start a guaranteed new panel, join the current panel when it
fits, or use the original automatic Comic Chat placement. Speaking and silent
characters are explicit, true backdrop-only pacing panels can be inserted,
exact expressions can be selected with a live pose preview before insertion,
and a live panel map shows a thumbnail plus the cast and dialogue actually
present in every shot. Dialogue fields show their 180-character limit, and long
unbroken text wraps inside the panel map instead of escaping its card. Editable
`.wcc.json` project files preserve the title, scene, balloon
font, cast, dialogue, poses and panel choices across browser sessions; the
Studio validates project files before replacing the current comic. Ctrl/⌘+S
saves the editable project. The latest compatible Studio edit is also kept
locally in the browser as a recovery draft; it is never uploaded, and portable
project downloads remain the durable backup. A bounded Undo/Redo history covers additions,
rewrites, reordering, duplication, removal, title changes, scenes and fonts
during the current Studio session. When an existing beat is being rewritten,
the Studio highlights it and temporarily locks the other editing commands until
**Apply changes** is chosen, so an unfinished line cannot be silently discarded.
The finished PNG can be exported directly from the Studio dialog, and keyboard
Undo/Redo leaves ordinary typing history alone while the cursor is in a text field.
Studio never edits a live room transcript: opening it during an IRC session
requires confirmation, disconnects from that session, invalidates queued room
messages, and starts with a blank local comic. Cancelling leaves the connection
and its panels untouched.

The member list and character controls have independent, clipped scroll areas,
so a long room roster cannot overlap the character preview. **Enlarge** widens
the optional character sidebar and increases both the character preview and
expression wheel; the preference is remembered in the browser.

The browser ports the original 2.5 text-expression, composite-avatar, panel,
and Woodring balloon algorithms. Faces and torsos are chosen independently;
characters face people being addressed; up to five speakers can share a panel;
and establishing shots, zoom, balloon routing, text continuation, title cards,
thought bubbles, whispers, and action boxes follow the original source. The
default balloon font is Comic Sans MS 12 pt when installed, with the OFL-licensed
Comic Neue bundled as the cross-platform fallback.

In a live room, select a member before sending to address the line to them;
Cmd-click on macOS or Ctrl-click elsewhere selects several people. The original
layout logic then brings those listeners into the panel and turns the speaker
toward them. Messages from other IRC clients also recognize a leading `Name:`
as an addressee hint.

Whisper balloons are private in live rooms. A whisper is sent by IRC private
message only to the selected room member or members (up to five), never to the
channel. Each recipient who is using WebComicChat renders it as a whisper in
their comic, and the sender sees the local copy; uninvolved channel members
receive nothing. The gateway rejects recipients who are not currently in the
room and ignores incoming private messages from outsiders.

The remembered **View → Hide BettyBot from comic & saved PNGs** option removes
the room's help bot from the title cast and rendered panels without deleting
her messages. The on-screen comic remains an exact preview of the exported PNG,
and turning the option off restores BettyBot immediately.

For highlights from a longer conversation, choose **Select Panels…** beside
Save Comic (or **File → Select panels to save…**), then tap any title or story
panels to include them. **Save selected** exports only those panels in their
original comic order. Selections follow unchanged panel content while new chat
arrives, and are discarded safely when a selected panel itself changes.

**Avatars…** opens local display controls for room members. Official-only mode
is enabled by default, original `# Appears as …` character announcements are
recognized, and any member can be forced to a particular bundled or Art Pack
character. Forced mappings are saved per IRC network and nickname and take
precedence over announcements and automatic assignment. A global display
preference can automatically swap 21 paired characters between their classic
black-and-white and color editions; forced mappings intentionally remain exact.
The color files come from
[The Unofficial MS Chat Add-On Site](https://www.phoenix-online-nexus.com/Nexus_21/index.htm#instructionsavb).
Users can import a
custom `.avb` for their own character without uploading it; the file is fully
validated, stays in the current browser tab, and is clearly marked as local.
**Gallery…** opens a separately credited set of curated community avatars
bundled from `community-avatars/catalog.json`. Gallery files are served from
WebComicChat's own origin, fully decoded and validated before use, and can be
announced to other WebComicChat clients with their approved hosted URL. The
gallery includes an email contribution path, and its repository instructions
require redistribution permission plus creator/source credit for every entry.
The built-in **Create…** dialog can also turn up to 16 PNG, WebP or JPEG pose
images into a classic monochrome or color version 2 `.avb`, assign an
emotion and intensity to each pose, use the result immediately, and download it.
When official-only mode is switched off, room announcements may load validated
custom avatars from the same HTTPS webcomicchat.com origin. Arbitrary external
art hosts remain blocked. The client announces official character changes using
the original convention. General public uploads and moderation remain separate
follow-up work.

Room links use the page URL to prefill a supported IRC network and channel, so a
room can be shared without including anyone's nickname. Opening a link never
joins automatically: the visitor still chooses their nickname and confirms the
connection.

The connection bar defaults to Libera.Chat's `#webcomicchat` community room.
**Browse channels…** stays available whether disconnected or already in a
channel. Visitors can also type any supported `#channel` and choose
**Join channel** or **Switch channel**, copy a direct WebComicChat link, or open
that channel in [Libera's web client](https://web.libera.chat/#webcomicchat).
The **Room** menu keeps Libera.Chat `#webcomicchat` pinned as a permanent home
room and can bookmark up to 20 additional Libera.Chat or OFTC channels. Custom
bookmarks stay only in that browser, can be opened directly from the menu, and
can be removed from **Manage room bookmarks…**. Opening a bookmark on another
network disconnects cleanly before reconnecting to the saved room.

The classic menu bar and title bar are functional rather than decorative.
File, Edit, View, Format, Room, Character and Help expose the corresponding
actions already available in the interface. Favorites links to Comic Chat
community resources, add-ons and Libera.Chat. The title-bar buttons provide a
full-screen comic reader, a reversible Windows-style minimize and a harmless
fake shutdown dialog; double-clicking the title bar maximizes and Escape
restores it. The icon opens the classic system menu. All surprise panels are
local only, the recurring jokes are restrained, and motion honors the browser's
reduced-motion preference.

The source-authentic hidden message commands are also supported: `<Brk>` makes
the next entry begin a new panel and `<Chr>` adds the selected character as a
balloon-free reaction shot. F1 adds local expression tips. The original
creators' credits sequence remains hidden behind the same input phrase and
Ctrl+Shift Favorites gesture used by the 1998 source.

WebComicChat is crafted using
[Microsoft's open-source Comic Chat release](https://opensource.microsoft.com/blog/2026/07/16/microsoft-comic-chat-is-now-open-source/)
with support from other online communities. Project questions and offers of
help can be sent to [admin@webcomicchat.com](mailto:admin@webcomicchat.com).

Browsers cannot open raw IRC sockets, so `server/` provides a same-origin
WebSocket-to-IRC bridge. It connects with verified TLS to one of two preset
public networks, handles IRC registration, retrieves a searchable public-room
directory, joins the room selected by the visitor, tracks its member list, and
converts channel messages into a narrow JSON event stream for the browser.

An optional, openly labelled resident lobby bot lives in `bot/`. It can greet
visitors, explain Comic Chat, publish a room schedule, and announce an official
or hosted custom avatar using the original `# Appears as` convention. It is a
separate long-running service, not part of the cPanel web application; see
[`bot/README.md`](bot/README.md) for setup and behavior.

## Run it

Node.js 20 or newer is required.

```sh
cd web
npm install
npm run dev
```

This starts both Vite and the local gateway; open the URL printed by Vite. The
art files stay in
`v2.5-beta-1-modern/comicart`; Vite serves them as static assets without changing
or duplicating them.

To run the built bundle and gateway together:

```sh
npm run build
npm start
```

Then open `http://127.0.0.1:8787`. Live mode intentionally supports no IRC
passwords or account credentials. Choose a nickname to join the default
`#webcomicchat` room, browse and search popular public channels, or replace the
channel with a known one. Offline strip composition remains available without
the gateway.
After entering or joining a channel, **Copy room link** creates a link such as
`https://webcomicchat.com/?network=libera&channel=%23comic-chat`.

## Production origin

The production site is `https://webcomicchat.com`. Build and run the app behind
a TLS reverse proxy that preserves WebSocket upgrades:

```sh
npm run build
HOST=0.0.0.0 PORT=8787 PUBLIC_ORIGIN=https://webcomicchat.com TRUST_PROXY_HOPS=1 npm start
```

Route both normal HTTP requests and `/irc` WebSocket upgrades from
`webcomicchat.com` to port `8787`. Keep that application port private; public TLS
should terminate at the reverse proxy or hosting platform. `PUBLIC_ORIGIN` adds
the production origin to the WebSocket origin check and does not weaken the
loopback development path.

Set `TRUST_PROXY_HOPS` only when the application is private behind known reverse
proxies. A value of `1` trusts the rightmost `X-Forwarded-For` address supplied
by the directly connected proxy, ignoring any client-prepended value; increase
it only for a verified multi-proxy chain. Leave it unset when exposing the Node
process directly. This lets the gateway apply per-address limits to visitors
without accepting a spoofed leftmost address.

A production container can be built from the repository root:

```sh
docker build -f web/Dockerfile -t webcomicchat .
docker run --rm -p 127.0.0.1:8787:8787 webcomicchat
```

The final image contains only the compiled static app, bundled gateway, and
production WebSocket dependency. It runs as an unprivileged user and exposes a
`/health` check for the hosting platform.

## cPanel / Passenger deployment

For a CloudLinux **Setup Node.js App** deployment, build locally and upload the
prebuilt application rather than compiling the repository on shared hosting.
Create the application with:

- Application mode: `Production`
- Application root: `webcomicchat-app`
- Application URL: the root of `webcomicchat.com`
- Application startup file: `app.js`
- Node.js: the newest available version that is 20 or later

Upload `app.js`, `package.json`, `package-lock.json`, `dist/`, and
`dist-server/` into the application root. Run npm install from the application
screen, then set `NODE_ENV=production` and
`PUBLIC_ORIGIN=https://webcomicchat.com`. Set `TRUST_PROXY_HOPS=1` after
confirming that cPanel's front end appends the visitor address once. Restart the
application after each upload or environment change.

The comic view includes a persistent balloon-font selector. Comic Sans MS—the
font used by the original client—is the default when it is installed, with
bundled Comic Neue as its cross-platform fallback and as a separate explicit
choice. Arial, Verdana, Trebuchet MS, Georgia, and Courier New are also
available. Changing the selection remeasures and reflows the whole strip, and
saved PNG comics use the selected face.

## Gateway safety boundary

- Listens on loopback by default.
- Connects only to the TLS endpoints compiled into `server/protocol.ts`.
- Rejects arbitrary hosts, unsafe nicknames/channels, control characters, and
  oversized payloads.
- Rejects direct-IP/local-network links and a conservative built-in list of IP
  logging services. Public-room HTTP(S) links are underlined and open in a new
  tab/window; whisper links remain plain text.
- Refreshes the [OpenPhish community feed](https://openphish.com/phishing_feeds.html)
  every 12 hours and blocks exact matching phishing URLs. Feed errors fail open
  while retaining the last good list, so a third-party outage cannot stop chat.

Add site-specific domain blocks with a comma-separated environment variable,
for example `BLOCKED_LINK_HOSTS=spam.example,other.example`. Subdomains are
included. Set `OPENPHISH_FEED_ENABLED=0` to disable feed refreshes; an alternate
compatible text feed can be selected with `OPENPHISH_FEED_URL`. Ordinary URL
shorteners are intentionally not blocked wholesale because they also carry
legitimate links. A future reputation-provider integration should use a
properly licensed domain list such as [Spamhaus DBL](https://www.spamhaus.org/blocklists/domain-blocklist/)
rather than copying a stale blacklist into the repository.

- Limits each browser session to five outgoing messages per ten seconds.
- Requires the exact production origin and rejects originless WebSocket clients.
- Allows at most three simultaneous sessions and ten upgrade attempts per minute
  from one address, with a 50-session global ceiling.
- Closes clients that do not start IRC setup within 15 seconds.
- Limits IRC reconnects per tab and across the gateway, and applies a global
  outbound-message budget to protect the hosting IP.
- Times out stalled IRC registration, 45-minute idle sessions, and 12-hour
  sessions; WebSocket ping/pong removes half-open clients.
- Closes slow browser connections before their outgoing buffer can grow without
  bound.
- Enforces a small maximum WebSocket payload.
- Does not accept, log, or store IRC credentials.

## Verify it

```sh
npm test
npm run build
```

The tests exercise every avatar and backdrop offered by the UI, composite
character assembly, the original expression and emotion-wheel behavior, panel
and balloon layout, pose selection, IRC parsing and validation, safe room-link
parsing, the browser transport, and the local WebSocket boundary.
