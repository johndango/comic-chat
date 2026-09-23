# Comic Chat web prototype

This is a web-based first slice of a modern Comic Chat client. It decodes the
original version 2 `.avb` avatars and `.bgb` backdrops directly, builds a
multi-panel conversation strip on Canvas, exports the result as a PNG, and can
render a live IRC channel through a small local gateway.

The browser also ports the original 2.5 text-expression rules. Caps and repeated
exclamation marks shout, laughter cues laugh, emoticons smile or frown,
greetings wave, and first- or second-person sentences point to the appropriate
speaker. The resulting emotion is matched against metadata embedded in each
avatar to choose the closest available pose.

Room links use the page URL to prefill a supported IRC network and channel, so a
room can be shared without including anyone's nickname. Opening a link never
joins automatically: the visitor still chooses their nickname and confirms the
connection.

Browsers cannot open raw IRC sockets, so `server/` provides a same-origin
WebSocket-to-IRC bridge. It connects with verified TLS to one of two preset
public networks, handles IRC registration, joins one channel, and converts
channel messages into a narrow JSON event stream for the browser.

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
passwords or account credentials. Choose a preset network, enter a nickname and
public channel, and connect. Offline strip composition remains available without
the gateway. After entering a channel, **Copy room link** creates a link such as
`https://webcomicchat.com/?network=libera&channel=%23comic-chat`.

## Production origin

The production site is `https://webcomicchat.com`. Build and run the app behind
a TLS reverse proxy that preserves WebSocket upgrades:

```sh
npm run build
HOST=0.0.0.0 PORT=8787 PUBLIC_ORIGIN=https://webcomicchat.com npm start
```

Route both normal HTTP requests and `/irc` WebSocket upgrades from
`webcomicchat.com` to port `8787`. Keep that application port private; public TLS
should terminate at the reverse proxy or hosting platform. `PUBLIC_ORIGIN` adds
the production origin to the WebSocket origin check and does not weaken the
loopback or same-origin development paths.

A production container can be built from the repository root:

```sh
docker build -f web/Dockerfile -t webcomicchat .
docker run --rm -p 127.0.0.1:8787:8787 webcomicchat
```

The final image contains only the compiled static app, bundled gateway, and
production WebSocket dependency. It runs as an unprivileged user and exposes a
`/health` check for the hosting platform.

## Gateway safety boundary

- Listens on loopback by default.
- Connects only to the TLS endpoints compiled into `server/protocol.ts`.
- Rejects arbitrary hosts, unsafe nicknames/channels, control characters, and
  oversized payloads.
- Limits each browser session to five outgoing messages per ten seconds.
- Enforces same-origin WebSocket upgrades and a small maximum payload.
- Does not accept, log, or store IRC credentials.

## Verify it

```sh
npm test
npm run build
```

The tests exercise every avatar and backdrop offered by the UI, expression-rule
priority, pose selection, IRC parsing and validation, safe room-link parsing,
the browser transport, and the local WebSocket boundary.
