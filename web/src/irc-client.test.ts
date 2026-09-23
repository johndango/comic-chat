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
    expect(events.at(-1)).toMatchObject({ type: "status", state: "joined" });
  });
});
