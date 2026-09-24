export type RoomNetwork = "libera" | "oftc";

export interface RoomSelection {
  network: RoomNetwork;
  channel: string;
}

export const DEFAULT_ROOM_SELECTION: Readonly<RoomSelection> = {
  network: "libera",
  channel: "#webcomicchat",
};

const channelPattern = /^#[A-Za-z0-9_+\-]{1,50}$/;

export function normalizeRoomSelection(network: string, rawChannel: string): RoomSelection | undefined {
  if (network !== "libera" && network !== "oftc") return undefined;
  const trimmedChannel = rawChannel.trim();
  const channel = trimmedChannel.startsWith("#")
    ? trimmedChannel
    : trimmedChannel
      ? `#${trimmedChannel}`
      : "";
  if (!channelPattern.test(channel)) return undefined;
  return { network, channel };
}

export function roomSelectionFromUrl(url: URL): RoomSelection | undefined {
  return normalizeRoomSelection(
    url.searchParams.get("network") ?? "libera",
    url.searchParams.get("channel") ?? "",
  );
}

export function createRoomUrl(currentUrl: URL, selection: RoomSelection): string {
  const validated = normalizeRoomSelection(selection.network, selection.channel);
  if (!validated) throw new Error("Cannot create a link for an invalid IRC room");
  const url = new URL(currentUrl);
  url.search = "";
  url.searchParams.set("network", validated.network);
  url.searchParams.set("channel", validated.channel);
  url.hash = "";
  return url.toString();
}

export function createLiberaWebChatUrl(rawChannel: string): string {
  const selection = normalizeRoomSelection("libera", rawChannel) ?? DEFAULT_ROOM_SELECTION;
  const url = new URL("https://web.libera.chat/");
  url.hash = selection.channel;
  return url.toString();
}
