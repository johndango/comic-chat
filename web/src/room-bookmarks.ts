import { DEFAULT_ROOM_SELECTION, normalizeRoomSelection, type RoomSelection } from "./room-link";

export const ROOM_BOOKMARKS_STORAGE_KEY = "webcomicchat-room-bookmarks-v1";
export const MAX_CUSTOM_ROOM_BOOKMARKS = 20;

export function roomBookmarkKey(selection: RoomSelection): string {
  return `${selection.network}:${selection.channel.toLocaleLowerCase()}`;
}

export function isDefaultRoomBookmark(selection: RoomSelection): boolean {
  return roomBookmarkKey(selection) === roomBookmarkKey(DEFAULT_ROOM_SELECTION);
}

function normalizeBookmarks(values: readonly unknown[]): RoomSelection[] {
  const bookmarks: RoomSelection[] = [{ ...DEFAULT_ROOM_SELECTION }];
  const seen = new Set([roomBookmarkKey(DEFAULT_ROOM_SELECTION)]);
  for (const value of values) {
    if (bookmarks.length > MAX_CUSTOM_ROOM_BOOKMARKS) break;
    if (typeof value !== "object" || value === null) continue;
    const candidate = value as Partial<RoomSelection>;
    const normalized = normalizeRoomSelection(String(candidate.network ?? ""), String(candidate.channel ?? ""));
    if (!normalized) continue;
    const key = roomBookmarkKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    bookmarks.push(normalized);
  }
  return bookmarks;
}

export function parseRoomBookmarks(source: string | null): RoomSelection[] {
  if (!source) return normalizeBookmarks([]);
  try {
    const decoded: unknown = JSON.parse(source);
    return normalizeBookmarks(Array.isArray(decoded) ? decoded : []);
  } catch {
    return normalizeBookmarks([]);
  }
}

export function addRoomBookmark(bookmarks: readonly RoomSelection[], selection: RoomSelection): RoomSelection[] {
  const normalized = normalizeRoomSelection(selection.network, selection.channel);
  if (!normalized) throw new Error("That room cannot be bookmarked");
  const current = normalizeBookmarks(bookmarks);
  if (current.some((bookmark) => roomBookmarkKey(bookmark) === roomBookmarkKey(normalized))) return current;
  if (current.length - 1 >= MAX_CUSTOM_ROOM_BOOKMARKS) {
    throw new Error(`You can save up to ${MAX_CUSTOM_ROOM_BOOKMARKS} custom room bookmarks`);
  }
  return [...current, normalized];
}

export function removeRoomBookmark(bookmarks: readonly RoomSelection[], selection: RoomSelection): RoomSelection[] {
  if (isDefaultRoomBookmark(selection)) return normalizeBookmarks(bookmarks);
  const removedKey = roomBookmarkKey(selection);
  return normalizeBookmarks(bookmarks.filter((bookmark) => roomBookmarkKey(bookmark) !== removedKey));
}

export function serializeRoomBookmarks(bookmarks: readonly RoomSelection[]): string {
  return JSON.stringify(normalizeBookmarks(bookmarks).filter((bookmark) => !isDefaultRoomBookmark(bookmark)));
}
