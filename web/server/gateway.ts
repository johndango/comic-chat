import { createServer, type IncomingMessage, type Server } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { isIP } from "node:net";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { connect as connectTls, type TLSSocket } from "node:tls";
import { WebSocket, WebSocketServer } from "ws";
import {
  IRC_NETWORKS,
  ircCaseFold,
  nicknameFromPrefix,
  parseIrcLine,
  validateChatMessage,
  validateConnectRequest,
  validateJoinRequest,
  type ConnectRequest,
} from "./protocol";

type JsonObject = Record<string, unknown>;
interface ListedRoom { channel: string; users: number; topic: string }

const mimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".avb": "application/octet-stream",
  ".bgb": "application/octet-stream",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function sendJson(webSocket: WebSocket, value: JsonObject): void {
  if (webSocket.readyState !== WebSocket.OPEN) return;
  if (webSocket.bufferedAmount > 1024 * 1024) {
    webSocket.close(1013, "Browser connection is too slow");
    return;
  }
  webSocket.send(JSON.stringify(value));
}

function sameChannel(left: string, right: string): boolean {
  return ircCaseFold(left) === ircCaseFold(right);
}

export class IrcBridge {
  private socket?: TLSSocket;
  private request?: ConnectRequest;
  private buffer = "";
  private registered = false;
  private joined = false;
  private activeChannel?: string;
  private closed = false;
  private recentMessages: number[] = [];
  private members = new Set<string>();
  private listingRooms = false;
  private listedRooms = 0;
  private roomResults: ListedRoom[] = [];
  private lastRoomListAt = 0;
  private ircConnects = 0;
  private registrationTimer?: NodeJS.Timeout;
  private idleTimer?: NodeJS.Timeout;
  private lifetimeTimer?: NodeJS.Timeout;

  constructor(
    private readonly webSocket: WebSocket,
    private readonly onConnect: () => void,
    private readonly onOutboundMessage: () => void = () => {},
    private readonly limits: {
      maxConnects?: number;
      registrationTimeoutMs?: number;
      idleTimeoutMs?: number;
      maxLifetimeMs?: number;
    } = {},
  ) {
    this.touch();
    this.lifetimeTimer = setTimeout(() => {
      sendJson(this.webSocket, { type: "status", state: "disconnected", message: "Session lifetime reached; reconnect to continue" });
      this.webSocket.close(1000, "Session lifetime reached");
    }, limits.maxLifetimeMs ?? 12 * 60 * 60_000);
    this.lifetimeTimer.unref();
  }

  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      sendJson(this.webSocket, { type: "status", state: "disconnected", message: "Session closed after being idle" });
      this.webSocket.close(1000, "Session idle timeout");
    }, this.limits.idleTimeoutMs ?? 45 * 60_000);
    this.idleTimer.unref();
  }

  handleBrowserMessage(raw: Buffer | ArrayBuffer | Buffer[]): void {
    try {
      this.touch();
      const bytes = Array.isArray(raw)
        ? Buffer.concat(raw)
        : raw instanceof ArrayBuffer
          ? Buffer.from(new Uint8Array(raw))
          : raw;
      const value = JSON.parse(bytes.toString("utf8")) as unknown;
      const type = value && typeof value === "object" ? (value as Record<string, unknown>).type : undefined;
      if (type === "connect") this.connect(validateConnectRequest(value));
      else if (type === "join") this.joinChannel(validateJoinRequest(value));
      else if (type === "list") this.requestRooms();
      else if (type === "say") {
        const chat = validateChatMessage(value);
        this.say(chat.message, chat.action);
      }
      else if (type === "disconnect") this.disconnect("Disconnected");
      else throw new Error("Unknown browser message type");
    } catch (error) {
      sendJson(this.webSocket, { type: "error", message: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  connect(request: ConnectRequest): void {
    if (this.socket) throw new Error("Already connected to IRC");
    if (this.ircConnects >= (this.limits.maxConnects ?? 3)) throw new Error("Reconnect limit reached; reload the page to continue");
    this.onConnect();
    this.ircConnects += 1;
    this.request = request;
    const network = IRC_NETWORKS[request.network];
    sendJson(this.webSocket, { type: "status", state: "connecting", message: `Connecting securely to ${network.label}…` });

    this.socket = connectTls({
      host: network.host,
      port: network.port,
      servername: network.host,
      rejectUnauthorized: true,
    });
    this.socket.setEncoding("utf8");
    this.socket.setTimeout(30_000, () => this.disconnect("IRC connection timed out"));
    this.registrationTimer = setTimeout(() => this.disconnect("IRC registration timed out"), this.limits.registrationTimeoutMs ?? 30_000);
    this.registrationTimer.unref();
    this.socket.on("secureConnect", () => {
      this.socket?.setTimeout(0);
      this.write(`NICK ${request.nickname}`);
      this.write(`USER comicweb 0 * :Comic Chat Web`);
    });
    this.socket.on("data", (chunk: string) => this.handleIrcData(chunk));
    this.socket.on("error", (error) => {
      sendJson(this.webSocket, { type: "error", message: `IRC connection failed: ${error.message}` });
    });
    this.socket.on("close", () => {
      this.socket = undefined;
      this.joined = false;
      if (!this.closed) sendJson(this.webSocket, { type: "status", state: "disconnected", message: "IRC disconnected" });
    });
  }

  private handleIrcData(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > 128 * 1024) return this.disconnect("IRC receive buffer exceeded its limit");
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.handleIrcLine(line);
      newline = this.buffer.indexOf("\n");
    }
  }

  private handleIrcLine(line: string): void {
    let message;
    try {
      message = parseIrcLine(line);
    } catch {
      return;
    }
    if (message.command === "PING") {
      this.write(`PONG :${message.trailing ?? message.params[0] ?? "ping"}`);
      return;
    }
    if (!this.request) return;

    if (message.command === "001") {
      if (this.registrationTimer) clearTimeout(this.registrationTimer);
      this.registrationTimer = undefined;
      this.registered = true;
      if (this.request.channel) this.joinChannel(this.request.channel);
      else this.requestRooms();
      return;
    }
    if (message.command === "433") {
      sendJson(this.webSocket, { type: "error", message: "That nickname is already in use" });
      return this.disconnect("Nickname unavailable");
    }
    if (message.command === "432" || message.command === "437") {
      sendJson(this.webSocket, { type: "error", message: message.trailing ?? "That nickname is unavailable" });
      return this.disconnect("Nickname unavailable");
    }
    if (message.command === "470" && this.activeChannel) {
      const forwarded = [...message.params].reverse().find((parameter) => parameter.startsWith("#"));
      if (forwarded) {
        this.activeChannel = forwarded;
        sendJson(this.webSocket, {
          type: "status",
          state: "joining",
          message: `The network forwarded this connection to ${forwarded}…`,
          channel: forwarded,
        });
      }
      return;
    }
    if (["403", "405", "471", "473", "474", "475", "476", "477", "479", "489"].includes(message.command)) {
      const channel = message.params.find((parameter) => parameter.startsWith("#"));
      if (this.activeChannel && (!channel || sameChannel(channel, this.activeChannel))) {
        return this.returnToBrowsing(message.trailing ?? `Could not join ${this.activeChannel}`);
      }
    }
    if (message.command === "322" && this.listingRooms) {
      const channel = message.params[1];
      const users = Number.parseInt(message.params[2] ?? "0", 10);
      if (channel?.startsWith("#") && Number.isFinite(users)) {
        this.listedRooms += 1;
        this.roomResults.push({ channel, users, topic: message.trailing ?? "" });
        if (this.roomResults.length > 400) {
          this.roomResults.sort((left, right) => right.users - left.users);
          this.roomResults.length = 200;
        }
      }
      return;
    }
    if (message.command === "323" && this.listingRooms) {
      this.listingRooms = false;
      const rooms = this.roomResults
        .sort((left, right) => right.users - left.users || left.channel.localeCompare(right.channel))
        .slice(0, 200);
      for (const room of rooms) sendJson(this.webSocket, { type: "room", ...room });
      sendJson(this.webSocket, { type: "rooms", count: rooms.length, total: this.listedRooms });
      if (!this.joined) {
        sendJson(this.webSocket, {
          type: "status",
          state: "browsing",
          message: `${rooms.length} popular public rooms available`,
          nickname: this.request.nickname,
        });
      }
      return;
    }
    if (message.command === "353" && this.activeChannel && message.params.some((parameter) => sameChannel(parameter, this.activeChannel!))) {
      for (const nickname of (message.trailing ?? "").split(/ +/)) {
        const cleanNickname = nickname.replace(/^[~&@%+]+/, "");
        if (cleanNickname) this.members.add(cleanNickname);
      }
      return;
    }
    if (message.command === "JOIN") {
      const nickname = nicknameFromPrefix(message.prefix);
      const joinedChannel = message.trailing ?? message.params[0];
      if (!joinedChannel || !this.activeChannel || !sameChannel(joinedChannel, this.activeChannel)) return;
      this.members.add(nickname);
      if (ircCaseFold(nickname) === ircCaseFold(this.request.nickname)) this.markJoined();
      else this.sendMembers();
      return;
    }
    if (message.command === "366" && this.activeChannel && message.params.some((parameter) => sameChannel(parameter, this.activeChannel!))) {
      this.sendMembers();
      this.markJoined();
      return;
    }
    if (message.command === "PART" && this.activeChannel && message.params[0] && sameChannel(message.params[0], this.activeChannel)) {
      this.members.delete(nicknameFromPrefix(message.prefix));
      this.sendMembers();
      return;
    }
    if (message.command === "KICK" && this.activeChannel && message.params[0] && sameChannel(message.params[0], this.activeChannel)) {
      const target = message.params[1];
      if (target && ircCaseFold(target) === ircCaseFold(this.request.nickname)) {
        return this.returnToBrowsing(message.trailing ? `Removed from ${this.activeChannel}: ${message.trailing}` : `Removed from ${this.activeChannel}`);
      }
      if (target) {
        this.members.delete(target);
        this.sendMembers();
      }
      return;
    }
    if (message.command === "QUIT") {
      this.members.delete(nicknameFromPrefix(message.prefix));
      this.sendMembers();
      return;
    }
    if (message.command === "NICK") {
      const previous = nicknameFromPrefix(message.prefix);
      const ownNickname = ircCaseFold(previous) === ircCaseFold(this.request.nickname);
      if (this.members.delete(previous)) {
        const next = message.trailing ?? message.params[0];
        if (next) this.members.add(next);
        this.sendMembers();
      }
      if (ownNickname) {
        const next = message.trailing ?? message.params[0];
        if (next) {
          this.request.nickname = next;
          const state = this.joined ? "joined" : this.activeChannel ? "joining" : "browsing";
          sendJson(this.webSocket, {
            type: "status",
            state,
            message: this.joined && this.activeChannel
              ? `Live in ${this.activeChannel}`
              : this.activeChannel
                ? `Joining ${this.activeChannel} as ${next}…`
                : `Connected as ${next}`,
            nickname: next,
            ...(this.activeChannel ? { channel: this.activeChannel } : {}),
          });
        }
      }
      return;
    }
    if (message.command === "PRIVMSG") {
      const target = message.params[0];
      if (!target || !this.activeChannel || !sameChannel(target, this.activeChannel) || message.trailing === undefined) return;
      const nickname = nicknameFromPrefix(message.prefix);
      if (ircCaseFold(nickname) === ircCaseFold(this.request.nickname)) return;
      sendJson(this.webSocket, {
        type: "message",
        nickname,
        message: message.trailing,
        self: false,
        timestamp: Date.now(),
      });
    }
  }

  private markJoined(): void {
    if (this.joined || !this.request || !this.activeChannel) return;
    this.joined = true;
    sendJson(this.webSocket, {
      type: "status",
      state: "joined",
      message: `Live in ${this.activeChannel}`,
      nickname: this.request.nickname,
      channel: this.activeChannel,
    });
  }

  private sendMembers(): void {
    sendJson(this.webSocket, {
      type: "members",
      members: [...this.members].sort((left, right) => left.localeCompare(right)).slice(0, 500),
    });
  }

  private returnToBrowsing(reason: string): void {
    const needsList = this.lastRoomListAt === 0;
    this.joined = false;
    this.activeChannel = undefined;
    this.members.clear();
    this.sendMembers();
    sendJson(this.webSocket, { type: "error", message: reason });
    if (needsList && this.registered && this.socket) {
      this.requestRooms();
      return;
    }
    sendJson(this.webSocket, {
      type: "status",
      state: "browsing",
      message: `${this.roomResults.length} popular public rooms available`,
      nickname: this.request?.nickname,
    });
  }

  private requestRooms(): void {
    if (!this.socket || !this.request || !this.registered) throw new Error("Connect to IRC before browsing rooms");
    const now = Date.now();
    if (this.listingRooms) throw new Error("The room list is already loading");
    if (now - this.lastRoomListAt < 30_000) throw new Error("Wait before refreshing the room list again");
    this.lastRoomListAt = now;
    this.listingRooms = true;
    this.listedRooms = 0;
    this.roomResults = [];
    sendJson(this.webSocket, { type: "rooms", count: 0, reset: true });
    sendJson(this.webSocket, { type: "status", state: "browsing", message: "Loading public rooms…", nickname: this.request.nickname });
    this.write("LIST >20");
  }

  private joinChannel(channel: string): void {
    if (!this.socket || !this.request || !this.registered) throw new Error("Connect to IRC before joining a room");
    if (this.activeChannel && sameChannel(this.activeChannel, channel) && this.joined) return;
    if (this.activeChannel) this.write(`PART ${this.activeChannel} :Switching rooms`);
    this.activeChannel = channel;
    this.joined = false;
    this.members.clear();
    this.write(`JOIN ${channel}`);
    sendJson(this.webSocket, { type: "status", state: "joining", message: `Joining ${channel}…`, channel });
  }

  private say(message: string, action = false): void {
    if (!this.socket || !this.request || !this.activeChannel || !this.joined) throw new Error("Join a channel before sending messages");
    const now = Date.now();
    this.recentMessages = this.recentMessages.filter((timestamp) => now - timestamp < 10_000);
    if (this.recentMessages.length >= 5) throw new Error("Slow down: IRC messages are limited to five per ten seconds");
    this.recentMessages.push(now);
    this.onOutboundMessage();
    const ircMessage = action ? `\u0001ACTION ${message}\u0001` : message;
    this.write(`PRIVMSG ${this.activeChannel} :${ircMessage}`);
    sendJson(this.webSocket, {
      type: "message",
      nickname: this.request.nickname,
      message: ircMessage,
      self: true,
      timestamp: now,
    });
  }

  private write(command: string): void {
    this.socket?.write(`${command}\r\n`);
  }

  disconnect(reason = "Disconnected"): void {
    if (this.registrationTimer) clearTimeout(this.registrationTimer);
    this.registrationTimer = undefined;
    if (this.socket && !this.socket.destroyed) {
      this.write("QUIT :Comic Chat Web closing");
      this.socket.destroy();
    }
    this.socket = undefined;
    this.registered = false;
    this.joined = false;
    this.activeChannel = undefined;
    this.listingRooms = false;
    this.roomResults = [];
    this.members.clear();
    sendJson(this.webSocket, { type: "status", state: "disconnected", message: reason });
  }

  close(): void {
    this.closed = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.lifetimeTimer) clearTimeout(this.lifetimeTimer);
    this.disconnect("Browser disconnected");
  }
}

function originAllowed(request: IncomingMessage, publicOrigin?: string): boolean {
  const origin = request.headers.origin;
  if (!origin) return publicOrigin === undefined;
  try {
    const url = new URL(origin);
    const requestHost = request.headers.host?.split(":")[0];
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    if (loopback && (requestHost === "127.0.0.1" || requestHost === "localhost")) return true;
    if (publicOrigin) return url.origin === new URL(publicOrigin).origin;
    return url.host === request.headers.host;
  } catch {
    return false;
  }
}

function normalizeAddress(address: string): string {
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}

function clientAddress(request: IncomingMessage, trustProxyHops: number): string {
  const directAddress = normalizeAddress(request.socket.remoteAddress ?? "unknown");
  if (trustProxyHops < 1) return directAddress;
  const forwarded = request.headers["x-forwarded-for"];
  const addresses = (Array.isArray(forwarded) ? forwarded.join(",") : forwarded ?? "")
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);
  const candidate = addresses[addresses.length - trustProxyHops];
  return candidate && isIP(candidate) ? normalizeAddress(candidate) : directAddress;
}

function rejectUpgrade(
  socket: { write(chunk: string): unknown; destroy(): unknown },
  status: 403 | 429 | 503,
  message: string,
): void {
  const statusText = status === 403 ? "Forbidden" : status === 429 ? "Too Many Requests" : "Service Unavailable";
  socket.write(`HTTP/1.1 ${status} ${statusText}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`);
  socket.destroy();
}

async function serveStatic(request: IncomingMessage, response: import("node:http").ServerResponse, distDirectory: string): Promise<void> {
  response.setHeader("content-security-policy", "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-content-type-options", "nosniff");
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname === "/health") {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400).end("Bad request");
    return;
  }
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  let filePath = resolve(distDirectory, `.${requestedPath}`);
  if (filePath !== distDirectory && !filePath.startsWith(`${distDirectory}${sep}`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const fileStats = await stat(filePath);
    if (fileStats.isDirectory()) filePath = resolve(filePath, "index.html");
    const body = await readFile(filePath);
    response.writeHead(200, {
      "content-type": mimeTypes[extname(filePath).toLowerCase()] ?? "application/octet-stream",
      "cache-control": filePath.endsWith("index.html") ? "no-cache" : "public, max-age=3600",
    });
    response.end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
}

export interface GatewayServer {
  httpServer: Server;
  listen(port?: number, host?: string): Promise<number>;
  close(): Promise<void>;
}

export interface GatewaySecurityOptions {
  trustProxy?: boolean;
  trustProxyHops?: number;
  maxClients?: number;
  maxClientsPerAddress?: number;
  maxUpgradesPerWindow?: number;
  upgradeWindowMs?: number;
  connectDeadlineMs?: number;
  maxIrcConnectsPerWindow?: number;
  maxOutboundMessagesPerWindow?: number;
  registrationTimeoutMs?: number;
  idleTimeoutMs?: number;
  maxLifetimeMs?: number;
  keepaliveMs?: number;
}

export function createGatewayServer(
  distDirectory = fileURLToPath(new URL("../dist", import.meta.url)),
  publicOrigin = process.env.PUBLIC_ORIGIN,
  security: GatewaySecurityOptions = {},
): GatewayServer {
  const configuredProxyHops = Number.parseInt(process.env.TRUST_PROXY_HOPS ?? "0", 10);
  const trustProxyHops = security.trustProxyHops
    ?? (security.trustProxy ? 1 : Number.isSafeInteger(configuredProxyHops) && configuredProxyHops > 0 ? configuredProxyHops : 0);
  const maxClients = security.maxClients ?? 50;
  const maxClientsPerAddress = security.maxClientsPerAddress ?? 3;
  const maxUpgradesPerWindow = security.maxUpgradesPerWindow ?? 10;
  const upgradeWindowMs = security.upgradeWindowMs ?? 60_000;
  const connectDeadlineMs = security.connectDeadlineMs ?? 15_000;
  const maxIrcConnectsPerWindow = security.maxIrcConnectsPerWindow ?? 30;
  const maxOutboundMessagesPerWindow = security.maxOutboundMessagesPerWindow ?? 120;
  const keepaliveMs = security.keepaliveMs ?? 30_000;
  const webSockets = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  const bridges = new Set<IrcBridge>();
  const clientsByAddress = new Map<string, number>();
  const upgradesByAddress = new Map<string, number[]>();
  let ircConnects: number[] = [];
  let outboundMessages: number[] = [];
  const httpServer = createServer((request, response) => {
    void serveStatic(request, response, distDirectory);
  });

  httpServer.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname !== "/irc" || !originAllowed(request, publicOrigin)) return rejectUpgrade(socket, 403, "WebSocket origin rejected");

    const address = clientAddress(request, trustProxyHops);
    const now = Date.now();
    const recentUpgrades = (upgradesByAddress.get(address) ?? []).filter((timestamp) => now - timestamp < upgradeWindowMs);
    if (recentUpgrades.length >= maxUpgradesPerWindow) return rejectUpgrade(socket, 429, "Too many connection attempts");
    recentUpgrades.push(now);
    upgradesByAddress.set(address, recentUpgrades);

    if (webSockets.clients.size >= maxClients) return rejectUpgrade(socket, 503, "Gateway connection limit reached");
    if ((clientsByAddress.get(address) ?? 0) >= maxClientsPerAddress) {
      return rejectUpgrade(socket, 429, "Too many connections from this address");
    }
    webSockets.handleUpgrade(request, socket, head, (webSocket) => webSockets.emit("connection", webSocket, request));
  });

  webSockets.on("connection", (webSocket, request) => {
    const address = clientAddress(request, trustProxyHops);
    clientsByAddress.set(address, (clientsByAddress.get(address) ?? 0) + 1);
    const connectDeadline = setTimeout(() => {
      sendJson(webSocket, { type: "error", message: "Connection setup timed out" });
      webSocket.close(1008, "Connection setup timed out");
    }, connectDeadlineMs);
    connectDeadline.unref();
    const bridge = new IrcBridge(
      webSocket,
      () => {
        const now = Date.now();
        ircConnects = ircConnects.filter((timestamp) => now - timestamp < upgradeWindowMs);
        if (ircConnects.length >= maxIrcConnectsPerWindow) throw new Error("Gateway reconnect limit reached; try again shortly");
        ircConnects.push(now);
        clearTimeout(connectDeadline);
      },
      () => {
        const now = Date.now();
        outboundMessages = outboundMessages.filter((timestamp) => now - timestamp < 10_000);
        if (outboundMessages.length >= maxOutboundMessagesPerWindow) throw new Error("Gateway message limit reached; try again shortly");
        outboundMessages.push(now);
      },
      {
        registrationTimeoutMs: security.registrationTimeoutMs,
        idleTimeoutMs: security.idleTimeoutMs,
        maxLifetimeMs: security.maxLifetimeMs,
      },
    );
    bridges.add(bridge);
    sendJson(webSocket, { type: "status", state: "offline", message: "Gateway ready" });
    webSocket.on("message", (data) => bridge.handleBrowserMessage(data as Buffer));
    webSocket.on("close", () => {
      clearTimeout(connectDeadline);
      bridge.close();
      bridges.delete(bridge);
      const remaining = (clientsByAddress.get(address) ?? 1) - 1;
      if (remaining > 0) clientsByAddress.set(address, remaining);
      else clientsByAddress.delete(address);
    });
  });

  const rateLimitSweep = setInterval(() => {
    const cutoff = Date.now() - upgradeWindowMs;
    for (const [address, timestamps] of upgradesByAddress) {
      const recent = timestamps.filter((timestamp) => timestamp > cutoff);
      if (recent.length > 0) upgradesByAddress.set(address, recent);
      else upgradesByAddress.delete(address);
    }
  }, upgradeWindowMs);
  rateLimitSweep.unref();

  const alive = new WeakMap<WebSocket, boolean>();
  webSockets.on("connection", (webSocket) => {
    alive.set(webSocket, true);
    webSocket.on("pong", () => alive.set(webSocket, true));
  });
  const keepalive = setInterval(() => {
    for (const client of webSockets.clients) {
      if (alive.get(client) === false) {
        client.terminate();
        continue;
      }
      alive.set(client, false);
      client.ping();
    }
  }, keepaliveMs);
  keepalive.unref();

  return {
    httpServer,
    listen(port = 8787, host = "127.0.0.1") {
      return new Promise((resolveListen, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(port, host, () => {
          httpServer.off("error", reject);
          const address = httpServer.address();
          resolveListen(typeof address === "object" && address ? address.port : port);
        });
      });
    },
    close() {
      clearInterval(rateLimitSweep);
      clearInterval(keepalive);
      for (const bridge of bridges) bridge.close();
      for (const client of webSockets.clients) client.terminate();
      return new Promise((resolveClose, reject) => {
        webSockets.close(() => httpServer.close((error) => error ? reject(error) : resolveClose()));
      });
    },
  };
}
