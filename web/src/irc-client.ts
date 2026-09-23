export type LiveState = "offline" | "connecting" | "browsing" | "joining" | "joined" | "disconnected";

export interface LiveStatusEvent {
  type: "status";
  state: LiveState;
  message: string;
  nickname?: string;
  channel?: string;
}

export interface LiveMessageEvent {
  type: "message";
  nickname: string;
  message: string;
  self: boolean;
  timestamp: number;
}

export interface LiveErrorEvent {
  type: "error";
  message: string;
}

export interface LiveRoomEvent {
  type: "room";
  channel: string;
  users: number;
  topic: string;
}

export interface LiveRoomsEvent {
  type: "rooms";
  count: number;
  total?: number;
  reset?: boolean;
}

export interface LiveMembersEvent {
  type: "members";
  members: string[];
}

export type LiveEvent = LiveStatusEvent | LiveMessageEvent | LiveErrorEvent | LiveRoomEvent | LiveRoomsEvent | LiveMembersEvent;

export interface LiveConnection {
  network: "libera" | "oftc";
  nickname: string;
  channel?: string;
}

export class IrcWebClient {
  private socket?: WebSocket;
  private state: LiveState = "offline";

  constructor(private readonly onEvent: (event: LiveEvent) => void) {}

  get joined(): boolean {
    return this.state === "joined";
  }

  get active(): boolean {
    return this.state === "connecting" || this.state === "browsing" || this.state === "joining" || this.state === "joined";
  }

  connect(connection: LiveConnection): void {
    if (this.active) throw new Error("A live connection is already active");
    this.socket?.close(1000, "Starting a new connection");
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/irc`);
    this.socket = socket;
    this.state = "connecting";
    this.onEvent({ type: "status", state: "connecting", message: "Opening local IRC gateway…" });

    socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "connect", ...connection })));
    socket.addEventListener("message", (message) => {
      try {
        const event = JSON.parse(String(message.data)) as LiveEvent;
        if (event.type === "status" && event.state === "offline" && this.state === "connecting") return;
        if (event.type === "status") this.state = event.state;
        this.onEvent(event);
      } catch {
        this.onEvent({ type: "error", message: "Gateway sent an unreadable response" });
      }
    });
    socket.addEventListener("error", () => this.onEvent({ type: "error", message: "Could not reach the local IRC gateway" }));
    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      if (this.state !== "disconnected" && this.state !== "offline") {
        this.state = "disconnected";
        this.onEvent({ type: "status", state: "disconnected", message: "Live chat disconnected" });
      }
    });
  }

  say(message: string, action = false): void {
    if (!this.joined || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Join a channel before sending live messages");
    }
    this.socket.send(JSON.stringify({ type: "say", message, ...(action ? { action: true } : {}) }));
  }

  join(channel: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.active) {
      throw new Error("Connect to IRC before joining a room");
    }
    this.socket.send(JSON.stringify({ type: "join", channel }));
  }

  listRooms(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.active) {
      throw new Error("Connect to IRC before browsing rooms");
    }
    this.socket.send(JSON.stringify({ type: "list" }));
  }

  disconnect(): void {
    if (!this.socket) return;
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: "disconnect" }));
    this.state = "disconnected";
    this.socket.close(1000, "User disconnected");
    this.socket = undefined;
    this.onEvent({ type: "status", state: "disconnected", message: "Live chat disconnected" });
  }
}
