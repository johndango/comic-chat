import { once } from "node:events";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createGatewayServer } from "./gateway";

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
});
