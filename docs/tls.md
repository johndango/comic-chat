# Native TLS (SSL) support for Comic Chat over IRC

Comic Chat (1996) spoke plaintext IRC over an MFC `CAsyncSocket`. Modern IRC
networks expose TLS-only ports (e.g. `irc.libera.chat:6697`). This change adds
**native** TLS using Windows' built-in **SChannel** (SSPI) provider — no
external tunnel (stunnel/ZNC), no third-party crypto library, and no new
runtime dependency beyond `secur32.lib`, which ships with Windows.

> TL;DR: A small `CTlsClient` (in `tlssock.cpp`) wraps the SChannel handshake
> and record encrypt/decrypt. `CIrcSocket` gained a TLS state machine around the
> existing `OnConnect`/`OnReceive`/`Send`. In 2.5, a per-server **Use TLS
> encryption** checkbox turns it on and changes an untouched default port to
> 6697.

---

## 1. Why this was a good fit

All IRC traffic funnels through a single `CIrcSocket serverConn` object:

- one connect site (`InitializeServerConnection` → `serverConn.Connect`)
- ~12 `serverConn.Send(...)` call sites
- one receive path (`CIrcSocket::OnReceive` → `Receive`)

So TLS could be interposed at that choke point without touching the ~12 senders
or the line parser. `CAsyncSocket::Send` is **not** virtual, but every caller
uses the concrete `CIrcSocket` type, so a non-virtual `CIrcSocket::Send`
override is picked up everywhere.

## 2. Components

### `tlssock.h` / `tlssock.cpp` — `CTlsClient`
A minimal SChannel client that owns the credential + security context and
exposes four operations:

- `Begin(serverName, outToken)` — `AcquireCredentialsHandle` +
  first `InitializeSecurityContext` → produces the ClientHello to send.
- `Continue(in, outToken, extraAppData)` — feed received handshake bytes; drives
  `InitializeSecurityContext` to completion, returning `TLS_CONTINUE` /
  `TLS_DONE` / `TLS_ERROR` and emitting tokens to send.
- `Encrypt(plain, cipher)` — `EncryptMessage` into TLS records
  (chunked by `cbMaximumMessage`).
- `Decrypt(in, plainOut, renegotiate)` — `DecryptMessage`, handling record
  framing and leftovers.

### `ircsock.h` / `ircsock.cpp` — `CIrcSocket` TLS state machine
States: `tlsNone` / `tlsHandshaking` / `tlsConnected`.

- `OnConnect` (secure): create `CTlsClient`, `Begin`, send the ClientHello, enter
  HANDSHAKING. The IRC/IRCX probe and login are **deferred** to
  `StartIrcSession()`.
- `OnReceive`: read raw bytes with `CAsyncSocket::Receive`, then
  - HANDSHAKING → `Continue`; send tokens; on `TLS_DONE` call
    `StartIrcSession()` and
    decrypt any early app data.
  - CONNECTED → `Decrypt`, feed plaintext to `FeedPlainBytes` (the line splitter
    that was factored out of the old `OnReceive`).
- `Send`: when CONNECTED, encrypt and queue complete TLS records. `OnSend`
  flushes partial nonblocking writes without splitting or dropping records.

### Config + UI
- `CChatServer::m_bUseTLS` is persisted with the existing per-server binary
  settings.
- The multi-server connector copies the winning server's TLS setting and DNS
  name to `serverConn` before handing off its connected socket.
- A **Use TLS encryption** checkbox on the Servers preferences page toggles the
  port between 6667 and 6697 only while it still holds the other default, so a
  hand-entered port is not overwritten.

### Build
`chat.mak`: adds `"$(INTDIR)\tlssock.obj"` to `OBJS` and links `secur32.lib`.
The makefile's `.cpp{...}.obj` inference
rule compiles the new file automatically; `tlssock.cpp` includes `stdafx.h`
first to satisfy the precompiled-header build.

---

## 3. The one real gotcha: client-certificate requests

Libera's TLS listener **optionally** requests a client certificate (it supports
SASL EXTERNAL / CertFP). Two wrong turns and the right answer:

1. With `SCH_CRED_NO_DEFAULT_CREDS`, `InitializeSecurityContext` returns
   **`SEC_I_INCOMPLETE_CREDENTIALS` (0x00090320)** to let the app supply a cert.
   If you treat that as an error, the handshake fails.
2. **Removing** `SCH_CRED_NO_DEFAULT_CREDS` makes SChannel try to *satisfy* the
   request with a default credential — which on a machine with smart cards pops a
   Windows **"Select a smart card"** prompt. Not what we want.

**Correct handling:** keep `SCH_CRED_NO_DEFAULT_CREDS` (so SChannel never
auto-selects/prompts) **and** handle `SEC_I_INCOMPLETE_CREDENTIALS` by simply
**re-calling `InitializeSecurityContext`** with the same buffered handshake data.
On the retry SChannel sends an *empty* client certificate and the handshake
proceeds. A small retry guard prevents an infinite loop.

```cpp
if (ss == SEC_I_INCOMPLETE_CREDENTIALS) {
    if (++m_incompleteCredRetries > 4) return TLS_ERROR;
    continue;   // re-invoke ISC; SChannel sends an empty client cert
}
```

## 4. Other notes / limitations (spike scope)

- **Certificate validation is strict in 2.5.** SChannel performs its normal
  certificate-chain and hostname checks using the physical server name as the
  TLS target. Self-signed or mismatched certificates fail the handshake.
- **No renegotiation / no client-cert auth (CertFP).** `SEC_I_RENEGOTIATE` is
  flagged but not driven; client-cert SASL EXTERNAL is out of scope.
- **Async integration.** A single TLS record can span multiple `OnReceive`
  events or carry several IRC lines, so `Decrypt`/`Continue` buffer partial
  records (`SEC_E_INCOMPLETE_MESSAGE`) and carry `SECBUFFER_EXTRA` across calls.
- **Still ANSI.** The transport is a byte stream, so Comic Chat's `char*` world
  is unaffected.

## 5. How to verify

1. Build: `nmake /f chat.mak CFG="chat - Win32 Debug"`.
2. Run `CChat.exe`, open **View → Options → Servers**, add or select
   `irc.libera.chat`, tick
   **Use TLS encryption** (port auto-fills 6697), apply, and connect.
3. You should register normally and be able to join channels. On Libera, confirm
   user mode includes **`+Z`** (TLS) — visible in the DbgView trace as
   `:<nick> MODE <nick> :+Ziw`.
4. DbgView shows `Got message:` lines flowing (i.e. decrypt is working) with no
   smart-card prompt and no `TLS: ... failed` traces.
