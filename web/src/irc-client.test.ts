import { afterEach, describe, expect, it, vi } from "vitest";
import { IrcWebClient, type LiveEvent } from "./irc-client";

class FakeWebSocket {
  static readonly OPEN = 1;
  static readonly instances: FakeWebSocket[] = [];
  readonly sent: string[] = [];
  readonly listeners = new Map<string, Array<(event: { data?: string }) => void>>();
  readyState = 0;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: { data?: string }) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(message: string): void {
    this.sent.push(message);
  }

  close(): void {
    this.readyState = 3;
    this.emit("close");
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit("open");
  }

  receive(event: LiveEvent): void {
    this.emit("message", { data: JSON.stringify(event) });
  }

  private emit(type: string, event: { data?: string } = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

afterEach(() => {
  FakeWebSocket.instances.length = 0;
  vi.unstubAllGlobals();
});

describe("browser IRC client", () => {
  it("uses the same-origin gateway and sends only after joining", () => {
    vi.stubGlobal("window", { location: { protocol: "http:", host: "localhost:5173" } });
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const events: LiveEvent[] = [];
    const client = new IrcWebClient((event) => events.push(event));

    client.connect({ network: "libera", nickname: "ComicFan", channel: "#chat" });
    const socket = FakeWebSocket.instances[0];
    expect(socket.url).toBe("ws://localhost:5173/irc");
    expect(() => client.say("too early")).toThrow("Join");

    socket.open();
    expect(JSON.parse(socket.sent[0])).toEqual({
      type: "connect",
      network: "libera",
      nickname: "ComicFan",
      channel: "#chat",
    });
    socket.receive({ type: "status", state: "joined", message: "Live in #chat" });
    client.say("Hello!");
    expect(JSON.parse(socket.sent[1])).toEqual({ type: "say", message: "Hello!" });
    client.say("waves", true);
    expect(JSON.parse(socket.sent[2])).toEqual({ type: "say", message: "waves", action: true });
    expect(events.at(-1)).toMatchObject({ type: "status", state: "joined" });
  });

  it("can browse and then join a room", () => {
    vi.stubGlobal("window", { location: { protocol: "https:", host: "webcomicchat.com" } });
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const events: LiveEvent[] = [];
    const client = new IrcWebClient((event) => events.push(event));

    client.connect({ network: "oftc", nickname: "RoomFan" });
    const socket = FakeWebSocket.instances[0];
    expect(socket.url).toBe("wss://webcomicchat.com/irc");
    socket.open();
    expect(JSON.parse(socket.sent[0])).toEqual({ type: "connect", network: "oftc", nickname: "RoomFan" });

    socket.receive({ type: "status", state: "browsing", message: "Loading public rooms…" });
    client.join("#comics");
    expect(JSON.parse(socket.sent[1])).toEqual({ type: "join", channel: "#comics" });
    client.listRooms();
    expect(JSON.parse(socket.sent[2])).toEqual({ type: "list" });
  });

  it("sends whispers privately once joined", () => {
    vi.stubGlobal("window", { location: { protocol: "https:", host: "webcomicchat.com" } });
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const client = new IrcWebClient(() => {});
    client.connect({ network: "libera", nickname: "Whisperer", channel: "#comics" });
    const socket = FakeWebSocket.instances.at(-1)!;
    socket.open();
    expect(() => client.whisper(["Dan"], "too early")).toThrow("Join a channel");
    socket.receive({ type: "status", state: "joined", message: "Live in #comics", channel: "#comics" });
    client.whisper(["Dan"], "psst");
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ type: "whisper", to: ["Dan"], message: "psst" });
  });

  it("ignores messages still queued by a socket after disconnect", () => {
    vi.stubGlobal("window", { location: { protocol: "https:", host: "webcomicchat.com" } });
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const events: LiveEvent[] = [];
    const client = new IrcWebClient((event) => events.push(event));
    client.connect({ network: "libera", nickname: "StudioFan", channel: "#comics" });
    const socket = FakeWebSocket.instances.at(-1)!;
    socket.open();
    socket.receive({ type: "status", state: "joined", message: "Live in #comics", channel: "#comics" });

    client.disconnect();
    const eventCount = events.length;
    socket.receive({ type: "message", nickname: "LateUser", message: "too late", self: false, timestamp: 1 });

    expect(events).toHaveLength(eventCount);
    expect(events.at(-1)).toMatchObject({ type: "status", state: "disconnected" });
  });
});
