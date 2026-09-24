// A small, polite IRC client for the resident bot: TLS, optional SASL PLAIN
// login, the +B bot mode, PING handling, reconnect with backoff and a paced
// send queue so the bot can never flood a channel.

import { connect as connectTls, type TLSSocket } from "node:tls";
import { connect as connectTcp, type Socket } from "node:net";
import { ircCaseFold, nicknameFromPrefix, parseIrcLine, type IrcMessage } from "../server/protocol";

export interface IrcOptions {
  host: string;
  port: number;
  tls: boolean;
  nick: string;
  /** Shown in WHOIS; say what the bot is and who runs it. */
  realname: string;
  channels: string[];
  /** Character announced using Comic Chat's original # Appears as convention. */
  avatar?: { name: string; url?: string };
  sasl?: { account: string; password: string };
  /** Minimum milliseconds between lines sent (default 1500). */
  pace?: number;
  /** For tests: accept self-signed certificates. */
  insecure?: boolean;
}

export interface IrcHandlers {
  onJoin?(channel: string, nick: string): void;
  onPart?(channel: string, nick: string): void;
  onNames?(channel: string, nicks: string[]): void;
  onMessage?(target: string | null, nick: string, text: string): void;
  onStatus?(status: string): void;
}

const MAX_LINE_BYTES = 400;
const MAX_QUEUED_LINES = 40;

/** Strip control characters that could break out of a PRIVMSG. */
export function sanitize(text: string): string {
  return text.replace(/[\r\n\0]/g, " ");
}

/** Split text into PRIVMSG-sized pieces on word boundaries. */
export function splitForIrc(text: string, max = MAX_LINE_BYTES): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of sanitize(text).split(" ")) {
    const candidate = line ? `${line} ${word}` : word;
    if (Buffer.byteLength(candidate) > max && line) {
      out.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) out.push(line);
  return out;
}

export function appearanceLine(name: string, url?: string): string {
  if (!/^[A-Za-z0-9_-]{1,60}$/.test(name)) throw new Error("Invalid Comic Chat avatar name");
  if (url && (!url.startsWith("https://") || url.length > 2048)) throw new Error("Avatar URL must use HTTPS");
  return `# Appears as ${name}${url ? `.${url}` : ""}`;
}

export class IrcBot {
  private socket?: Socket | TLSSocket;
  private buffer = "";
  private queue: string[] = [];
  private lastSent = 0;
  private pump?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private attempt = 0;
  private currentNick: string;
  private names = new Map<string, string[]>();

  constructor(
    private readonly options: IrcOptions,
    private readonly handlers: IrcHandlers = {},
  ) {
    this.currentNick = options.nick;
  }

  get nick(): string {
    return this.currentNick;
  }

  start(): void {
    this.stopped = false;
    this.open();
  }

  stop(reason = "Bot shutting down"): void {
    this.stopped = true;
    if (this.pump) clearTimeout(this.pump);
    if (this.socket && !this.socket.destroyed) {
      this.socket.write(`QUIT :${sanitize(reason)}\r\n`);
      this.socket.end();
    }
  }

  /** Queue a PRIVMSG; it's paced and split to stay within IRC limits. */
  say(target: string, text: string): void {
    for (const piece of splitForIrc(text)) this.enqueue(`PRIVMSG ${target} :${piece}`);
  }

  private status(s: string): void {
    this.handlers.onStatus?.(s);
  }

  private open(): void {
    const { host, port } = this.options;
    this.status(`Connecting to ${host}:${port}${this.options.tls ? " (TLS)" : ""}`);
    this.buffer = "";
    const socket = this.options.tls
      ? connectTls({ host, port, servername: host, rejectUnauthorized: !this.options.insecure })
      : connectTcp({ host, port });
    this.socket = socket;
    socket.setEncoding("utf8");
    socket.setTimeout(300_000, () => socket.destroy(new Error("Connection went quiet")));
    socket.once(this.options.tls ? "secureConnect" : "connect", () => this.register());
    socket.on("data", (chunk: string) => this.onData(chunk));
    socket.on("error", (error) => this.status(`Connection error: ${error.message}`));
    socket.on("close", () => this.onClose());
  }

  private register(): void {
    this.attempt = 0;
    if (this.options.sasl) this.raw("CAP REQ :sasl");
    this.raw(`NICK ${this.currentNick}`);
    this.raw(`USER ${this.options.nick.toLowerCase()} 0 * :${sanitize(this.options.realname)}`);
  }

  private onClose(): void {
    this.socket = undefined;
    this.queue = [];
    if (this.pump) clearTimeout(this.pump);
    this.pump = undefined;
    this.names.clear();
    if (this.stopped) return;
    // 5 s, 10 s, 20 s ... capped at 5 minutes, so a ban or outage isn't hammered.
    const delay = Math.min(300_000, 5_000 * 2 ** this.attempt);
    this.attempt += 1;
    this.status(`Disconnected; retrying in ${Math.round(delay / 1000)} s`);
    setTimeout(() => !this.stopped && this.open(), delay).unref?.();
  }

  private raw(line: string): void {
    this.socket?.write(`${line}\r\n`);
  }

  private enqueue(line: string): void {
    if (this.queue.length >= MAX_QUEUED_LINES) {
      this.status("Outgoing queue full; dropping a bot response");
      return;
    }
    this.queue.push(line);
    this.flush();
  }

  private flush(): void {
    if (this.pump || !this.queue.length) return;
    const pace = this.options.pace ?? 1500;
    const wait = Math.max(0, this.lastSent + pace - Date.now());
    this.pump = setTimeout(() => {
      this.pump = undefined;
      const line = this.queue.shift();
      if (line && this.socket) {
        this.raw(line);
        this.lastSent = Date.now();
      }
      this.flush();
    }, wait);
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > 256 * 1024) {
      this.socket?.destroy(new Error("Receive buffer overflow"));
      return;
    }
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newline + 1);
      if (line) {
        try {
          this.onLine(parseIrcLine(line));
        } catch {
          // Ignore malformed lines.
        }
      }
      newline = this.buffer.indexOf("\n");
    }
  }

  private isMe(nick: string): boolean {
    return ircCaseFold(nick) === ircCaseFold(this.currentNick);
  }

  private onLine(m: IrcMessage): void {
    const arg = (i: number) => m.params[i] ?? (i === m.params.length ? m.trailing : undefined);
    switch (m.command) {
      case "PING":
        this.raw(`PONG :${m.trailing ?? m.params[0] ?? ""}`);
        return;
      case "CAP":
        if (m.params[1] === "ACK" && /\bsasl\b/.test(m.trailing ?? "")) this.raw("AUTHENTICATE PLAIN");
        else if (m.params[1] === "NAK") this.raw("CAP END");
        return;
      case "AUTHENTICATE":
        if (this.options.sasl && (m.params[0] === "+" || m.trailing === "+")) {
          const { account, password } = this.options.sasl;
          this.raw(`AUTHENTICATE ${Buffer.from(`${account}\0${account}\0${password}`).toString("base64")}`);
        }
        return;
      case "903": // SASL success
      case "904": // SASL failure: carry on unauthenticated
      case "905":
      case "906":
        if (m.command !== "903") this.status("SASL login failed; continuing without an account");
        this.raw("CAP END");
        return;
      case "001":
        this.currentNick = m.params[0] ?? this.currentNick;
        this.status(`Registered as ${this.currentNick}`);
        this.raw(`MODE ${this.currentNick} +B`); // mark as a bot where supported
        for (const channel of this.options.channels) this.raw(`JOIN ${channel}`);
        return;
      case "433": // nickname in use
      case "432":
        this.currentNick = `${this.options.nick}_${Math.floor(Math.random() * 90 + 10)}`;
        this.raw(`NICK ${this.currentNick}`);
        return;
      case "NICK":
        if (this.isMe(nicknameFromPrefix(m.prefix))) this.currentNick = arg(0) ?? this.currentNick;
        return;
      case "JOIN": {
        const channel = m.params[0] ?? m.trailing;
        const who = nicknameFromPrefix(m.prefix);
        if (channel) {
          this.handlers.onJoin?.(channel, who);
          if (this.options.avatar && this.isMe(who)) {
            this.say(channel, appearanceLine(this.options.avatar.name, this.options.avatar.url));
          }
        }
        return;
      }
      case "PART":
      case "KICK": {
        const channel = m.params[0];
        const who = m.command === "KICK" ? m.params[1] : nicknameFromPrefix(m.prefix);
        if (channel && who) this.handlers.onPart?.(channel, who);
        if (m.command === "KICK" && who && this.isMe(who) && channel) {
          this.status(`Kicked from ${channel}: ${m.trailing ?? ""}`);
        }
        return;
      }
      case "353": {
        const channel = m.params[2];
        if (channel) this.names.set(channel, [...(this.names.get(channel) ?? []), ...(m.trailing ?? "").split(/ +/).filter(Boolean)]);
        return;
      }
      case "366": {
        const channel = m.params[1];
        if (channel) {
          this.handlers.onNames?.(channel, this.names.get(channel) ?? []);
          this.names.delete(channel);
        }
        return;
      }
      case "PRIVMSG": {
        const target = m.params[0];
        const text = m.trailing ?? "";
        const nick = nicknameFromPrefix(m.prefix);
        if (!target || this.isMe(nick)) return;
        if (text.startsWith("\u0001")) {
          // CTCP: answer VERSION so people can see what this is; ignore the rest.
          if (/^\u0001VERSION\u0001?$/.test(text)) {
            this.enqueue(`NOTICE ${nick} :\u0001VERSION webcomicchat resident bot\u0001`);
          }
          return;
        }
        const channel = /^[#&]/.test(target) ? target : null;
        this.handlers.onMessage?.(channel, nick, text);
        return;
      }
      default:
    }
  }
}
