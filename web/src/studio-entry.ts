import type { LiveState } from "./irc-client";

/** Studio is an offline authoring tool and must never inherit a live transcript. */
export function studioEntryNeedsDisconnect(state: LiveState): boolean {
  return state === "connecting" || state === "browsing" || state === "joining" || state === "joined";
}
