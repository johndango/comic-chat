# Gateway security review — 2026-09-23

This review covers `web/server/gateway.ts`, `web/server/protocol.ts`,
`web/server/index.ts`, `web/app.js`, `web/Dockerfile`, and how the browser
displays gateway data (`web/src/main.ts`, `web/src/irc-client.ts`). The
baseline is commit `e7930bf`. I read the code only; nothing was run against
the live site or the IRC networks.

## Summary

The basics are solid. The gateway only reaches two hard-coded TLS endpoints
and verifies their certificates. Browser input is validated with tight
patterns, and IRC command injection through CR, LF or NUL is blocked. Remote
text reaches the page only through `textContent`; the `innerHTML` templates
are static. Static file serving is protected against path traversal, and
WebSocket payloads are capped.

The real risks are about **capacity and the shared server IP**, not code
execution. The top three findings interact on the cPanel deployment.

| # | Severity | Finding |
|---|---|---|
| 1 | High | Per-address limits either apply to every visitor at once, or can be bypassed |
| 2 | High | A connected session never expires |
| 3 | High | One WebSocket can open unlimited IRC connections, from an IP every user shares |
| 4 | Medium | No backpressure toward slow browsers |
| 5 | Medium | No WebSocket keepalive |
| 6 | Low | CSP allows WebSockets to any host |
| 7 | Low | Error responses lack security headers |
| 8 | Info | Confirm that WebSockets work under cPanel/Passenger |

## Findings

### 1. Per-address limits: shared by everyone, or spoofable (High)

`clientAddress()` (gateway.ts:336) has two modes, and neither is right
behind the cPanel web server:

- **`TRUST_PROXY` unset (the README's current advice).** Every request reaches
  Node from the local proxy, so `remoteAddress` is the same loopback address
  for every visitor. `maxClientsPerAddress = 3` and `maxUpgradesPerWindow = 10`
  then apply to **the whole site**. Only three people can be connected at
  once, and ten connection attempts per minute lock everyone out. One person
  can do that by reloading the page.
- **`TRUST_PROXY=1`.** The code takes the **leftmost** `X-Forwarded-For`
  entry. Apache's `mod_proxy` and LiteSpeed *append* the real client address
  rather than replacing the header. The leftmost value is therefore whatever
  the client sent, so any client can dodge every per-address limit by sending
  a random `X-Forwarded-For`.

**Fix:** trust a configured number of proxy hops and take the address that
many entries from the **right**: `TRUST_PROXY_HOPS=1`, take the last entry.
Add a test showing that a client-supplied `X-Forwarded-For` is ignored. Then
confirm on the host what the proxy actually sends, for example by logging the
header once.

### 2. A connected session never expires (High)

The 15-second `connectDeadline` is cleared as soon as `connect` is sent
(gateway.ts:453). After that nothing ever closes the session: there's no
idle timeout, no maximum lifetime, and no registration timeout. Once TLS is
up, `setTimeout(0)` removes the socket timeout (gateway.ts:97), so a server
that never sends `001` also holds the slot forever.

With a global cap of 50, about 17 addresses at 3 sessions each hold every
slot indefinitely. Under finding 1, a single visitor can do it. This also
happens without any attacker: abandoned tabs accumulate.

**Fix:** add a registration deadline (for example 30 s from TLS connect to
`001`), an idle timeout based on browser activity (for example 30–60 min
without a `say`, `join` or `list`), and a hard maximum lifetime (for example
12 h). Report them to the client as normal `status` events.

### 3. Unlimited IRC connections from one WebSocket, on a shared IP (High)

`disconnect()` clears `this.socket`, and then `connect()` is allowed again
(gateway.ts:82 only checks `this.socket`). A client can loop
`connect` → `disconnect` over one WebSocket as fast as it likes. The upgrade
rate limit never sees this, because it only counts new WebSockets.

Every IRC connection comes from the **server's IP**. Rapid reconnects, or
spam at the per-session limit of five messages per ten seconds multiplied
across 50 sessions, look like abuse *from that IP*. If Libera.Chat or OFTC
throttles or bans it, **every user of the site loses access at once**. Even
without abuse, networks limit simultaneous connections per IP, so the
site's capacity is capped by the networks' limits as well as its own.

**Fix:**
- Limit IRC connects per WebSocket (for example 3 per session) and globally
  (for example N per minute across the whole gateway).
- Add a global outbound-message budget alongside the per-session one.
- Before promoting the site, email the networks (Libera: support@libera.chat,
  which its FAQ names for exemption requests; OFTC: its support channel).
  Describe the gateway and ask about **WEBIRC**, which forwards each visitor's
  real IP so network bans target the individual, or about a connection-limit
  exemption. WEBIRC needs a password configured by the network; keep it in
  an environment variable, never in the repo.
- Send an identifiable `USER` ident or realname, as `Comic Chat Web` already
  does, and give the networks a contact address.

### 4. No backpressure toward slow browsers (Medium)

`sendJson()` writes every IRC message to the WebSocket without looking at
`webSocket.bufferedAmount`. A browser that stops reading — a background tab,
a slow link, or a deliberately stalled client — in a busy channel makes the
server buffer indefinitely. With 50 sessions, that's a memory-exhaustion
path.

**Fix:** if `bufferedAmount` exceeds a limit (for example 1 MB), drop
low-priority events (room list, member updates) or close the session with a
clear status.

### 5. No WebSocket keepalive (Medium, reliability)

Neither side pings. Reverse proxies commonly close idle upgraded
connections after 60–120 s, so a quiet channel will drop users for no
visible reason.

**Fix:** have the server ping every 25–30 s using `ws`'s built-in
`ping`/`pong`, and terminate clients that miss two in a row. This also
cleans up half-open connections, which feeds into finding 2.

### 6. CSP allows WebSockets to any host (Low)

`connect-src 'self' ws: wss:` lets injected script, if any ever appeared,
exfiltrate to any WebSocket host. Current browsers let `'self'` cover
same-origin `ws:`/`wss:`, so this can be tightened to
`connect-src 'self'`. If older browsers must be supported, use
`connect-src 'self' wss://webcomicchat.com`.

### 7. Error responses lack security headers (Low)

The CSP, `nosniff` and `referrer-policy` headers are only sent on successful
static responses. The 400, 403 and 404 responses and `/health` have none.
Set them once for every response. HSTS belongs at the TLS terminator; confirm
it's enabled there.

### 8. Confirm WebSockets work under cPanel/Passenger (Info)

`server/index.ts` parses `PORT` as a number and binds `127.0.0.1`. Passenger
normally overrides `listen()`, so this probably works, but whether the
host's front-end proxy forwards `Upgrade: websocket` for Passenger apps
depends on the host. Check the live site with a real room before relying on
it. If it fails, the Docker image behind a normal reverse proxy is the
fallback.

## Things checked that are fine

- **IRC command injection:** messages reject `\r`, `\n` and `\0` and are
  capped at 400 bytes. Nicknames and channels use strict patterns (no commas,
  so no multi-channel joins, and no keys).
- **Server-side request forgery:** there's no user-controlled host or port;
  only `IRC_NETWORKS` is reachable.
- **TLS:** `rejectUnauthorized: true`, with SNI set.
- **XSS:** the room list, topics, member list and messages all go through
  `textContent`. The `innerHTML` templates interpolate only constant lists.
- **Path traversal:** requests are resolved and checked against the `dist`
  prefix.
- **Input size:** `maxPayload: 4096`, a 128 KB IRC receive buffer, and
  bounded room-list results.
- **Cross-site WebSocket hijacking:** the Origin check is exact in
  production. Non-browser clients can spoof Origin, which the per-address
  limits are meant to cover (see finding 1).
- **Credentials:** none are accepted, stored or logged.

## Suggested order

Fix 1 and 2 first; they are small changes in `gateway.ts` with clear tests.
Then fix 3, and contact Libera/OFTC before announcing the site publicly.
4 and 5 can ship together. 6–8 are quick cleanups.
