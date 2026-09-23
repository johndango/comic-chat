import { createServer, type IncomingMessage, type Server } from "node:http";
import { readFile, stat } from "node:fs/promises";
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
  type ConnectRequest,
} from "./protocol";

type JsonObject = Record<string, unknown>;

const mimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".avb": "application/octet-stream",
  ".bgb": "application/octet-stream",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function sendJson(webSocket: WebSocket, value: JsonObject): void {
  if (webSocket.readyState === WebSocket.OPEN) webSocket.send(JSON.stringify(value));
}

function sameChannel(left: string, right: string): boolean {
  return ircCaseFold(left) === ircCaseFold(right);
}

class IrcBridge {
  private socket?: TLSSocket;
  private request?: ConnectRequest;
  private buffer = "";
  private joined = false;
  private closed = false;
  private recentMessages: number[] = [];

  constructor(private readonly webSocket: WebSocket) {}

  handleBrowserMessage(raw: Buffer | ArrayBuffer | Buffer[]): void {
    try {
      const bytes = Array.isArray(raw)
        ? Buffer.concat(raw)
        : raw instanceof ArrayBuffer
          ? Buffer.from(new Uint8Array(raw))
          : raw;
      const value = JSON.parse(bytes.toString("utf8")) as unknown;
      const type = value && typeof value === "object" ? (value as Record<string, unknown>).type : undefined;
      if (type === "connect") this.connect(validateConnectRequest(value));
      else if (type === "say") this.say(validateChatMessage(value));
      else if (type === "disconnect") this.disconnect("Disconnected");
      else throw new Error("Unknown browser message type");
    } catch (error) {
      sendJson(this.webSocket, { type: "error", message: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  connect(request: ConnectRequest): void {
    if (this.socket) throw new Error("Already connected to IRC");
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
      this.write(`JOIN ${this.request.channel}`);
      sendJson(this.webSocket, { type: "status", state: "joining", message: `Joining ${this.request.channel}…` });
      return;
    }
    if (message.command === "433") {
      sendJson(this.webSocket, { type: "error", message: "That nickname is already in use" });
      return this.disconnect("Nickname unavailable");
    }
    if (message.command === "JOIN" && ircCaseFold(nicknameFromPrefix(message.prefix)) === ircCaseFold(this.request.nickname)) {
      this.markJoined();
      return;
    }
    if (message.command === "366" && message.params.some((parameter) => sameChannel(parameter, this.request!.channel))) {
      this.markJoined();
      return;
    }
    if (message.command === "PRIVMSG") {
      const target = message.params[0];
      if (!target || !sameChannel(target, this.request.channel) || message.trailing === undefined) return;
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
    if (this.joined || !this.request) return;
    this.joined = true;
    sendJson(this.webSocket, {
      type: "status",
      state: "joined",
      message: `Live in ${this.request.channel}`,
      nickname: this.request.nickname,
      channel: this.request.channel,
    });
  }

  private say(message: string): void {
    if (!this.socket || !this.request || !this.joined) throw new Error("Join a channel before sending messages");
    const now = Date.now();
    this.recentMessages = this.recentMessages.filter((timestamp) => now - timestamp < 10_000);
    if (this.recentMessages.length >= 5) throw new Error("Slow down: IRC messages are limited to five per ten seconds");
    this.recentMessages.push(now);
    this.write(`PRIVMSG ${this.request.channel} :${message}`);
    sendJson(this.webSocket, {
      type: "message",
      nickname: this.request.nickname,
      message,
      self: true,
      timestamp: now,
    });
  }

  private write(command: string): void {
    this.socket?.write(`${command}\r\n`);
  }

  disconnect(reason = "Disconnected"): void {
    if (this.socket && !this.socket.destroyed) {
      this.write("QUIT :Comic Chat Web closing");
      this.socket.destroy();
    }
    this.socket = undefined;
    this.joined = false;
    sendJson(this.webSocket, { type: "status", state: "disconnected", message: reason });
  }

  close(): void {
    this.closed = true;
    this.disconnect("Browser disconnected");
  }
}

function originAllowed(request: IncomingMessage, publicOrigin?: string): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const url = new URL(origin);
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return true;
    if (publicOrigin && url.origin === new URL(publicOrigin).origin) return true;
    return url.host === request.headers.host;
  } catch {
    return false;
  }
}

async function serveStatic(request: IncomingMessage, response: import("node:http").ServerResponse, distDirectory: string): Promise<void> {
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
      "content-security-policy": "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
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

export function createGatewayServer(
  distDirectory = fileURLToPath(new URL("../dist", import.meta.url)),
  publicOrigin = process.env.PUBLIC_ORIGIN,
): GatewayServer {
  const webSockets = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  const bridges = new Set<IrcBridge>();
  const httpServer = createServer((request, response) => {
    void serveStatic(request, response, distDirectory);
  });

  httpServer.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname !== "/irc" || !originAllowed(request, publicOrigin) || webSockets.clients.size >= 50) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    webSockets.handleUpgrade(request, socket, head, (webSocket) => webSockets.emit("connection", webSocket, request));
  });

  webSockets.on("connection", (webSocket) => {
    const bridge = new IrcBridge(webSocket);
    bridges.add(bridge);
    sendJson(webSocket, { type: "status", state: "offline", message: "Gateway ready" });
    webSocket.on("message", (data) => bridge.handleBrowserMessage(data as Buffer));
    webSocket.on("close", () => {
      bridge.close();
      bridges.delete(bridge);
    });
  });

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
      for (const bridge of bridges) bridge.close();
      for (const client of webSockets.clients) client.terminate();
      return new Promise((resolveClose, reject) => {
        webSockets.close(() => httpServer.close((error) => error ? reject(error) : resolveClose()));
      });
    },
  };
}
