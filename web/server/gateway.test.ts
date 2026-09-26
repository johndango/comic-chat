import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createGatewayServer, IrcBridge } from "./gateway";
import type { ConnectRequest } from "./protocol";

interface BridgeHarness {
  request: ConnectRequest;
  registered: boolean;
  joined: boolean;
  activeChannel?: string;
  lastRoomListAt: number;
  roomResults: { channel: string; users: number; topic: string }[];
  socket: { destroyed: boolean; write(command: string): void };
  handleIrcLine(line: string): void;
  handleBrowserMessage(raw: Buffer): void;
  joinChannel(channel: string): void;
  requestRooms(): void;
}

function bridgeHarness() {
  const events: Record<string, unknown>[] = [];
  const writes: string[] = [];
  const webSocket = {
    readyState: WebSocket.OPEN,
    send(value: string) { events.push(JSON.parse(value)); },
  } as unknown as WebSocket;
  const bridge = new IrcBridge(webSocket, () => {}) as unknown as BridgeHarness;
  bridge.request = { type: "connect", network: "libera", nickname: "ComicFan" };
  bridge.registered = true;
  bridge.socket = { destroyed: false, write(command: string) { writes.push(command); } };
  return { bridge, events, writes };
}

function rejectedStatus(webSocket: WebSocket): Promise<number> {
  return new Promise((resolve, reject) => {
    webSocket.once("open", () => reject(new Error("WebSocket unexpectedly opened")));
    webSocket.once("unexpected-response", (_request, response) => {
      const status = response.statusCode ?? 0;
      response.resume();
      resolve(status);
    });
    webSocket.once("error", () => {});
  });
}

describe("local web gateway", () => {
  it("serves health and rejects unsupported network requests", async () => {
    const gateway = createGatewayServer();
    const port = await gateway.listen(0);
    try {
      const health = await fetch(`http://127.0.0.1:${port}/health`);
      expect(await health.json()).toEqual({ ok: true });
      expect(health.headers.get("content-security-policy")).toContain("connect-src 'self'");
      expect(health.headers.get("x-content-type-options")).toBe("nosniff");

      const webSocket = new WebSocket(`ws://127.0.0.1:${port}/irc`, { origin: `http://127.0.0.1:${port}` });
      const readyMessage = once(webSocket, "message");
      await once(webSocket, "open");
      await readyMessage;
      const errorMessage = once(webSocket, "message");
      webSocket.send(JSON.stringify({ type: "connect", network: "not-allowed", nickname: "ComicFan", channel: "#chat" }));
      const [raw] = await errorMessage;
      expect(JSON.parse(raw.toString())).toMatchObject({ type: "error", message: "Unsupported IRC network" });
      webSocket.close();
      await once(webSocket, "close");
    } finally {
      await gateway.close();
    }
  });

  it("publishes validated community avatars and supports reports and admin removal", async () => {
    const directory = await mkdtemp(join(tmpdir(), "webcomicchat-community-"));
    const token = "test-admin-token-that-is-at-least-32-characters";
    const gateway = createGatewayServer(undefined, undefined, { communityDataDirectory: directory, communityAdminToken: token });
    const port = await gateway.listen(0);
    const origin = `http://127.0.0.1:${port}`;
    const avatar = await readFile(new URL("../../v2.5-beta-1-modern/comicart/connor.avb", import.meta.url));
    try {
      const uploaded = await fetch(`${origin}/api/community-avatars`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          name: "Test Connor",
          creator: "Test Artist",
          description: "A test upload",
          filename: "connor.avb",
          fileBase64: avatar.toString("base64"),
          rightsConfirmed: true,
          rulesConfirmed: true,
        }),
      });
      expect(uploaded.status).toBe(201);
      const entry = (await uploaded.json() as { avatar: { id: string; file: string } }).avatar;

      const catalog = await (await fetch(`${origin}/api/community-avatars`)).json() as { avatars: { id: string }[] };
      expect(catalog.avatars.map(({ id }) => id)).toContain(entry.id);
      expect((await fetch(`${origin}/community-avatars/${entry.file}`)).status).toBe(200);

      const reported = await fetch(`${origin}/api/community-avatars/${entry.id}/reports`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ reason: "spam", details: "Test report" }),
      });
      expect(reported.status).toBe(201);

      const admin = await fetch(`${origin}/api/community-admin`, { headers: { origin, authorization: `Bearer ${token}` } });
      expect(admin.status).toBe(200);
      expect((await admin.json() as { reports: unknown[] }).reports).toHaveLength(1);

      const removed = await fetch(`${origin}/api/community-admin/avatars/${entry.id}`, {
        method: "DELETE",
        headers: { origin, authorization: `Bearer ${token}` },
      });
      expect(removed.status).toBe(200);
      expect((await fetch(`${origin}/community-avatars/${entry.file}`)).status).toBe(404);

      const republished = await fetch(`${origin}/api/community-avatars`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          name: "Renamed Connor",
          filename: "connor.avb",
          fileBase64: avatar.toString("base64"),
          rightsConfirmed: true,
          rulesConfirmed: true,
        }),
      });
      expect(republished.status).toBe(409);
      expect((await republished.json() as { error: string }).error).toContain("cannot be republished");
    } finally {
      await gateway.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects malformed community avatar uploads", async () => {
    const directory = await mkdtemp(join(tmpdir(), "webcomicchat-community-"));
    const gateway = createGatewayServer(undefined, undefined, { communityDataDirectory: directory });
    const port = await gateway.listen(0);
    const origin = `http://127.0.0.1:${port}`;
    try {
      const response = await fetch(`${origin}/api/community-avatars`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ name: "Fake", filename: "fake.avb", fileBase64: Buffer.from("not an avatar").toString("base64"), rightsConfirmed: true, rulesConfirmed: true }),
      });
      expect(response.status).toBe(400);
      expect((await response.json() as { error: string }).error).toMatch(/Comic Chat|record|avatar/iu);
    } finally {
      await gateway.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("accepts the configured webcomicchat.com production origin", async () => {
    const gateway = createGatewayServer(undefined, "https://webcomicchat.com");
    const port = await gateway.listen(0);
    try {
      const webSocket = new WebSocket(`ws://127.0.0.1:${port}/irc`, { origin: "https://webcomicchat.com" });
      const readyMessage = once(webSocket, "message");
      await once(webSocket, "open");
      const [raw] = await readyMessage;
      expect(JSON.parse(raw.toString())).toMatchObject({ type: "status", state: "offline" });
      webSocket.close();
      await once(webSocket, "close");
    } finally {
      await gateway.close();
    }
  });

  it("requires the exact configured origin in production", async () => {
    const gateway = createGatewayServer(undefined, "https://webcomicchat.com");
    const port = await gateway.listen(0);
    try {
      const missingOrigin = new WebSocket(`ws://127.0.0.1:${port}/irc`);
      expect(await rejectedStatus(missingOrigin)).toBe(403);

      const wrongOrigin = new WebSocket(`ws://127.0.0.1:${port}/irc`, { origin: "https://example.com" });
      expect(await rejectedStatus(wrongOrigin)).toBe(403);
    } finally {
      await gateway.close();
    }
  });

  it("limits concurrent clients by direct address and ignores spoofed forwarding headers", async () => {
    const gateway = createGatewayServer(undefined, undefined, { maxClientsPerAddress: 1 });
    const port = await gateway.listen(0);
    const first = new WebSocket(`ws://127.0.0.1:${port}/irc`, {
      origin: `http://127.0.0.1:${port}`,
      headers: { "x-forwarded-for": "203.0.113.10" },
    });
    try {
      await once(first, "open");
      const second = new WebSocket(`ws://127.0.0.1:${port}/irc`, {
        origin: `http://127.0.0.1:${port}`,
        headers: { "x-forwarded-for": "203.0.113.11" },
      });
      expect(await rejectedStatus(second)).toBe(429);
    } finally {
      first.close();
      await once(first, "close");
      await gateway.close();
    }
  });

  it("uses validated forwarded addresses only when proxy trust is enabled", async () => {
    const gateway = createGatewayServer(undefined, undefined, { trustProxy: true, maxClientsPerAddress: 1 });
    const port = await gateway.listen(0);
    const clients = ["203.0.113.10", "203.0.113.11"].map((address) => new WebSocket(`ws://127.0.0.1:${port}/irc`, {
      origin: `http://127.0.0.1:${port}`,
      headers: { "x-forwarded-for": address },
    }));
    try {
      await Promise.all(clients.map((client) => once(client, "open")));
      expect(clients.every((client) => client.readyState === WebSocket.OPEN)).toBe(true);
    } finally {
      for (const client of clients) client.close();
      await Promise.all(clients.map((client) => once(client, "close")));
      await gateway.close();
    }
  });

  it("uses the right side of a trusted proxy chain instead of a client-spoofed address", async () => {
    const gateway = createGatewayServer(undefined, undefined, { trustProxyHops: 1, maxClientsPerAddress: 1 });
    const port = await gateway.listen(0);
    const first = new WebSocket(`ws://127.0.0.1:${port}/irc`, {
      origin: `http://127.0.0.1:${port}`,
      headers: { "x-forwarded-for": "198.51.100.10, 203.0.113.50" },
    });
    try {
      await once(first, "open");
      const spoofed = new WebSocket(`ws://127.0.0.1:${port}/irc`, {
        origin: `http://127.0.0.1:${port}`,
        headers: { "x-forwarded-for": "198.51.100.99, 203.0.113.50" },
      });
      expect(await rejectedStatus(spoofed)).toBe(429);
    } finally {
      first.close();
      await once(first, "close");
      await gateway.close();
    }
  });

  it("rate-limits repeated upgrade attempts from one address", async () => {
    const gateway = createGatewayServer(undefined, undefined, {
      maxClientsPerAddress: 3,
      maxUpgradesPerWindow: 2,
      upgradeWindowMs: 60_000,
    });
    const port = await gateway.listen(0);
    try {
      for (let index = 0; index < 2; index += 1) {
        const client = new WebSocket(`ws://127.0.0.1:${port}/irc`, { origin: `http://127.0.0.1:${port}` });
        await once(client, "open");
        client.close();
        await once(client, "close");
      }
      const limited = new WebSocket(`ws://127.0.0.1:${port}/irc`, { origin: `http://127.0.0.1:${port}` });
      expect(await rejectedStatus(limited)).toBe(429);
    } finally {
      await gateway.close();
    }
  });

  it("closes clients that never submit a connection request", async () => {
    const gateway = createGatewayServer(undefined, undefined, { connectDeadlineMs: 20 });
    const port = await gateway.listen(0);
    const client = new WebSocket(`ws://127.0.0.1:${port}/irc`, { origin: `http://127.0.0.1:${port}` });
    try {
      await once(client, "open");
      const [code, reason] = await once(client, "close");
      expect(code).toBe(1008);
      expect(reason.toString()).toBe("Connection setup timed out");
    } finally {
      await gateway.close();
    }
  });
});

describe("IRC room state recovery", () => {
  it("keeps a joined client joined while refreshing the room directory", () => {
    const { bridge, events, writes } = bridgeHarness();
    bridge.activeChannel = "#webcomicchat";
    bridge.joined = true;
    bridge.lastRoomListAt = 0;

    bridge.requestRooms();

    expect(writes).toEqual(["LIST >20\r\n"]);
    expect(events).toEqual([{ type: "rooms", count: 0, reset: true }]);
  });

  it("returns rejected joins to the existing room directory", () => {
    const { bridge, events } = bridgeHarness();
    bridge.activeChannel = "#locked";
    bridge.lastRoomListAt = Date.now();
    bridge.roomResults = [{ channel: "#public", users: 42, topic: "Public room" }];

    bridge.handleIrcLine(":irc.example 474 ComicFan #locked :Cannot join channel (+b)");

    expect(bridge.activeChannel).toBeUndefined();
    expect(events).toContainEqual({ type: "error", message: "Cannot join channel (+b)" });
    expect(events.at(-1)).toMatchObject({ type: "status", state: "browsing" });
  });

  it("adopts a forwarded room before the JOIN reply arrives", () => {
    const { bridge, events } = bridgeHarness();
    bridge.activeChannel = "#old";

    bridge.handleIrcLine(":irc.example 470 ComicFan #old #overflow :Forwarding to another channel");

    expect(bridge.activeChannel).toBe("#overflow");
    expect(events.at(-1)).toMatchObject({ type: "status", state: "joining", channel: "#overflow" });
  });

  it("parts a pending room when the visitor switches again", () => {
    const { bridge, writes } = bridgeHarness();
    bridge.activeChannel = "#first";
    bridge.joined = false;

    bridge.joinChannel("#second");

    expect(writes).toEqual(["PART #first :Switching rooms\r\n", "JOIN #second\r\n"]);
  });

  it("returns to browsing after a kick and tracks a forced nickname", () => {
    const { bridge, events } = bridgeHarness();
    bridge.activeChannel = "#comics";
    bridge.joined = true;
    bridge.lastRoomListAt = Date.now();

    bridge.handleIrcLine(":ComicFan!user@example NICK :ComicFan_2");
    expect(bridge.request.nickname).toBe("ComicFan_2");
    expect(events.at(-1)).toMatchObject({ type: "status", state: "joined", nickname: "ComicFan_2" });

    bridge.handleIrcLine(":operator!staff@example KICK #comics ComicFan_2 :Please cool down");
    expect(bridge.joined).toBe(false);
    expect(bridge.activeChannel).toBeUndefined();
    expect(events).toContainEqual({ type: "error", message: "Removed from #comics: Please cool down" });
    expect(events.at(-1)).toMatchObject({ type: "status", state: "browsing" });
  });
});

describe("whispers", () => {
  function inRoom() {
    const harness = bridgeHarness();
    harness.bridge.activeChannel = "#comics";
    harness.bridge.joined = true;
    harness.bridge.handleIrcLine(":Dan!d@example JOIN #comics");
    harness.events.length = 0;
    harness.writes.length = 0;
    const send = (value: Record<string, unknown>) => harness.bridge.handleBrowserMessage(Buffer.from(JSON.stringify(value)));
    return { ...harness, send };
  }

  it("sends a whisper privately to a room member and echoes it as a whisper", () => {
    const { send, writes, events } = inRoom();
    send({ type: "whisper", to: "Dan", message: "just between us" });
    expect(writes).toEqual(["PRIVMSG Dan :just between us\r\n"]);
    expect(events.at(-1)).toMatchObject({ type: "message", nickname: "ComicFan", self: true, whisper: true, to: ["Dan"], message: "just between us" });
  });

  it("sends a group whisper only to its selected room members", () => {
    const { bridge, send, writes, events } = inRoom();
    bridge.handleIrcLine(":Eve!e@example JOIN #comics");
    writes.length = 0;
    events.length = 0;
    send({ type: "whisper", to: ["Dan", "Eve"], message: "for us only" });
    expect(writes).toEqual([
      "PRIVMSG Dan :for us only\r\n",
      "PRIVMSG Eve :for us only\r\n",
    ]);
    expect(events.at(-1)).toMatchObject({ whisper: true, to: ["Dan", "Eve"] });
  });

  it("won't whisper to someone outside the room, or to yourself", () => {
    const { send, writes, events } = inRoom();
    send({ type: "whisper", to: "Stranger", message: "hi" });
    send({ type: "whisper", to: "ComicFan", message: "hi" });
    expect(writes).toEqual([]);
    expect(events).toContainEqual({ type: "error", operation: "message", message: "Stranger isn't in this room" });
    expect(events).toContainEqual({ type: "error", operation: "message", message: "You can't whisper to yourself" });
  });

  it("shows whispers from room members, and only from them", () => {
    const { bridge, events } = inRoom();
    bridge.handleIrcLine(":Dan!d@example PRIVMSG ComicFan :psst");
    bridge.handleIrcLine(":Stranger!s@example PRIVMSG ComicFan :buy my stuff");
    bridge.handleIrcLine(":Dan!d@example PRIVMSG ComicFan :\u0001VERSION\u0001");
    bridge.handleIrcLine(":Dan!d@example PRIVMSG ComicFan :\u0001ACTION winks\u0001");
    const messages = events.filter((e) => e.type === "message");
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ nickname: "Dan", message: "psst", whisper: true, to: "ComicFan", self: false });
    expect(messages[1]).toMatchObject({ nickname: "Dan", message: "\u0001ACTION winks\u0001", whisper: true });
  });

  it("still delivers ordinary room messages without the whisper flag", () => {
    const { bridge, events } = inRoom();
    bridge.handleIrcLine(":Dan!d@example PRIVMSG #comics :hello all");
    expect(events.at(-1)).toMatchObject({ type: "message", nickname: "Dan", message: "hello all" });
    expect(events.at(-1)).not.toHaveProperty("whisper");
  });

  it("blocks unsafe links before room messages or whispers reach IRC", () => {
    const { send, writes, events } = inRoom();
    send({ type: "say", message: "click https://grabify.link/example" });
    send({ type: "whisper", to: "Dan", message: "click http://127.0.0.1/private" });
    expect(writes).toEqual([]);
    expect(events.filter((event) => event.type === "error")).toEqual([
      { type: "error", operation: "message", message: "That message was blocked because it contains an unsafe link to grabify.link." },
      { type: "error", operation: "message", message: "That message was blocked because it contains an unsafe link to 127.0.0.1." },
    ]);
  });

  it("suppresses unsafe incoming room messages and whispers with a notice", () => {
    const { bridge, events } = inRoom();
    bridge.handleIrcLine(":Dan!d@example PRIVMSG #comics :click https://iplogger.org/example");
    bridge.handleIrcLine(":Dan!d@example PRIVMSG ComicFan :click https://iplogger.org/private");
    expect(events.filter((event) => event.type === "message")).toEqual([]);
    expect(events.filter((event) => event.type === "blocked")).toEqual([
      { type: "blocked", message: "Blocked a message from Dan because it contained an unsafe link to iplogger.org." },
      { type: "blocked", message: "Blocked a message from Dan because it contained an unsafe link to iplogger.org." },
    ]);
  });

  it("shares the five-per-ten-seconds limit with room messages", () => {
    const { send, writes, events } = inRoom();
    for (let i = 0; i < 3; i += 1) send({ type: "say", message: `line ${i}` });
    for (let i = 0; i < 3; i += 1) send({ type: "whisper", to: "Dan", message: `psst ${i}` });
    expect(writes).toHaveLength(5);
    expect(events.at(-1)).toMatchObject({ type: "error", message: expect.stringContaining("Slow down") });
  });
});
