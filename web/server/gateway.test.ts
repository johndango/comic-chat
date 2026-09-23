import { once } from "node:events";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createGatewayServer } from "./gateway";

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
