# Comic Chat web client

This is a web-based Comic Chat client with a desktop modeled after the original
Microsoft Comic Chat 2.5 interface. It decodes all 35 bundled version 2 `.avb`
character files—including the alternate Art Pack editions—and all nine `.bgb`
backdrops directly, builds a multi-panel conversation strip on Canvas, exports
the result as a PNG, and can render a live IRC channel through a small local
gateway.

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

Room links use the page URL to prefill a supported IRC network and channel, so a
room can be shared without including anyone's nickname. Opening a link never
joins automatically: the visitor still chooses their nickname and confirms the
connection.

Browsers cannot open raw IRC sockets, so `server/` provides a same-origin
WebSocket-to-IRC bridge. It connects with verified TLS to one of two preset
public networks, handles IRC registration, retrieves a searchable public-room
directory, joins the room selected by the visitor, tracks its member list, and
converts channel messages into a narrow JSON event stream for the browser.

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
passwords or account credentials. Choose a preset network and nickname, then
browse and search its popular public rooms; entering a known channel directly
also works. Offline strip composition remains available without the gateway.
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

## Gateway safety boundary

- Listens on loopback by default.
- Connects only to the TLS endpoints compiled into `server/protocol.ts`.
- Rejects arbitrary hosts, unsafe nicknames/channels, control characters, and
  oversized payloads.
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
